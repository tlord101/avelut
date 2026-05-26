import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { ChatIcon } from './icons/ChatIcon';
import { SendIcon } from './icons/SendIcon';
import { PlusIcon } from './icons/PlusIcon';
import { XIcon } from './icons/XIcon';

type AssistantSender = 'user' | 'assistant';

interface AssistantMessage {
  id: string;
  sender: AssistantSender;
  text: string;
}

interface HistoryItem {
  id: number;
  title: string;
}

const apiKey = typeof process !== 'undefined'
  ? (process.env.VANTUTOR_ASSISTANT_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY)
  : undefined;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const ASSISTANT_MODEL = 'gemini-2.5-flash';

const starterHistory: HistoryItem[] = [
  { id: 1, title: 'Calculus III Equations' },
  { id: 2, title: 'Thermodynamics Review' },
];

const quickPrompts = [
  'Explain the chain rule with a worked example.',
  'Solve this integral and show the steps.',
  'Write the equation of a line in LaTeX.',
];

const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const truncateTitle = (text: string) => {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New Chat';
  return cleaned.length > 34 ? `${cleaned.slice(0, 34).trim()}...` : cleaned;
};

const generatePresentableChatTitle = () => {
  const now = new Date();
  const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Study Session • ${date} ${time}`;
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(new Error(`Failed to read attachment: ${reader.error?.message || 'Unknown error'}`));
  reader.readAsDataURL(file);
});

const getHistoryFallbackTitle = (prompt: string, attachment: File | null) => (
  prompt || (attachment ? `Attachment: ${attachment.name}` : 'New Chat')
);
const MOBILE_COMPOSER_BOTTOM_OFFSET_CLASS = 'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0rem))]';

export default function VanTutorAssistant() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(starterHistory);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState('Ready to help with math, science, and study plans.');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const conversationSummary = useMemo(() => {
    if (activeHistoryId) {
      const active = history.find(item => item.id === activeHistoryId);
      if (active) return active.title;
    }
    if (!messages.length) return 'Fresh chat';
    if (history.length > 0) return history[0].title;
    return truncateTitle(messages[messages.length - 1].text);
  }, [activeHistoryId, history, messages]);

  const updateRecentHistory = (title: string) => {
    const nextTitle = truncateTitle(title);
    if (activeHistoryId) {
      setHistory(prev => prev.map(item => item.id === activeHistoryId ? { ...item, title: nextTitle } : item).slice(0, 6));
      return;
    }
    const createdId = Date.now();
    setActiveHistoryId(createdId);
    setHistory(prev => [
      { id: createdId, title: nextTitle },
      ...prev.filter(item => item.title !== nextTitle && item.title !== 'New Chat'),
    ].slice(0, 6));
  };

  const startNewChat = () => {
    const id = Date.now();
    setHistory(prev => [{ id, title: generatePresentableChatTitle() }, ...prev].slice(0, 6));
    setActiveHistoryId(id);
    setMessages([]);
    setInputValue('');
    setAttachment(null);
    setStatusText('Started a new chat.');
    setIsSidebarOpen(false);
    inputRef.current?.focus();
  };

  const handleSend = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const prompt = inputValue.trim();
    if ((!prompt && !attachment) || isSending) return;

    const userMessage: AssistantMessage = {
      id: createMessageId(),
      sender: 'user',
      text: prompt || getHistoryFallbackTitle(prompt, attachment),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputValue('');
    setIsSending(true);
    setStatusText('Thinking...');

    if (!messages.length) updateRecentHistory(getHistoryFallbackTitle(prompt, attachment));

    try {
      if (!ai) {
        setMessages(prev => [
          ...prev,
          {
            id: createMessageId(),
            sender: 'assistant',
            text: 'Gemini is not configured yet. Add an API key to enable assistant replies.',
          },
        ]);
        setStatusText('API key missing.');
        return;
      }

      let attachmentPart:
        | { inlineData: { data: string; mimeType: string } }
        | undefined;

      if (attachment) {
        const data = await fileToBase64(attachment);
        attachmentPart = {
          inlineData: {
            data,
            mimeType: attachment.type || 'application/octet-stream',
          },
        };
      }

      const result = await ai.models.generateContent({
        model: ASSISTANT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'You are VanTutorAssistant, a friendly study companion for university students.',
                  'Answer clearly, encourage the learner, and keep explanations concise but complete.',
                  'When math is involved, use Markdown and LaTeX formatting with inline $...$ and display $$...$$ equations.',
                  'If the question needs calculations, show the steps and final formula neatly.',
                  attachment ? 'An attachment is included. Use it as context.' : '',
                  '',
                  `Conversation so far:\n${nextMessages.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n')}`,
                ].filter(Boolean).join('\n'),
              },
              ...(attachmentPart ? [attachmentPart] : []),
            ],
          },
        ],
      });

      const responseText = (result.text || '').trim() || 'I could not generate a response right now. Please try again.';
      setMessages(prev => [
        ...prev,
        {
          id: createMessageId(),
          sender: 'assistant',
          text: responseText,
        },
      ]);
      setStatusText('Response ready.');
      updateRecentHistory(getHistoryFallbackTitle(prompt, attachment));
      clearAttachment();
    } catch (error) {
      console.error('Gemini assistant error:', error);
      setMessages(prev => [
        ...prev,
        {
          id: createMessageId(),
          sender: 'assistant',
          text: 'Sorry, I ran into a problem generating that reply. Please try again.',
        },
      ]);
      setStatusText('Unable to respond right now.');
    } finally {
      setIsSending(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInputValue(prompt);
    inputRef.current?.focus();
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    setStatusText(`Attachment ready: ${file.name}`);
  };

  const clearAttachment = () => {
    setAttachment(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-emerald-50/40">
      <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-7xl overflow-hidden md:rounded-[2rem] md:border md:border-white/70 md:shadow-[0_20px_80px_rgba(15,23,42,0.08)] bg-white/90 backdrop-blur">
        <aside className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-[88vw] max-w-sm border-r border-slate-200 bg-white p-5 shadow-2xl transition-transform duration-300 md:static md:z-auto md:w-80 md:translate-x-0 md:shadow-none`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">VanTutor</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Assistant history</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-full border border-slate-200 p-2 text-slate-600 md:hidden"
              aria-label="Close assistant history"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={startNewChat}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <PlusIcon className="h-5 w-5" />
            New chat
          </button>

          <div className="space-y-3">
            {history.map(item => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Recent chat</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{item.title}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Math-ready replies</p>
            <p className="mt-1 text-emerald-800">Use $x^2$ inline or $$\\int_0^1 x^2\\, dx$$ for display equations.</p>
          </div>
        </aside>

        {isSidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-slate-950/30 md:hidden"
            aria-label="Close assistant history overlay"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <main className="relative flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-700 md:hidden"
                aria-label="Open assistant history"
              >
                <ChatIcon className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">VanTutorAssistant</p>
                <h1 className="text-lg font-bold text-slate-900 sm:text-2xl">{conversationSummary}</h1>
              </div>
            </div>
            <div className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:block">
              {statusText}
            </div>
          </header>

          <section className="flex-1 overflow-y-auto px-4 py-5 pb-48 sm:px-6 md:pb-6">
            {messages.length === 0 ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 py-16 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-lg">
                  <ChatIcon className="h-10 w-10" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Ask VanTutor anything</h2>
                  <p className="mt-2 max-w-xl text-slate-600">
                    Get step-by-step answers with clean LaTeX for equations, formulas, and proofs.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  {quickPrompts.map(prompt => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handlePromptClick(prompt)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`px-4 py-3 shadow-sm ${
                        message.sender === 'user'
                          ? 'max-w-[76%] rounded-full bg-slate-900 text-white'
                          : 'w-[90%] max-w-[90%] rounded-3xl border border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      {message.sender === 'assistant' ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={{
                            p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed" {...props} />,
                            ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-1 pl-5" {...props} />,
                            ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...props} />,
                            li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                            strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900" {...props} />,
                            pre: ({ node, ...props }) => <pre className="mb-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100" {...props} />,
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="flex justify-start">
                    <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </section>

          {/* 5.5rem aligns this composer directly above the mobile bottom nav bar height. */}
          <footer className={`fixed inset-x-0 ${MOBILE_COMPOSER_BOTTOM_OFFSET_CLASS} z-20 px-4 sm:px-6 md:static md:bottom-auto`}>
            <form onSubmit={handleSend} className="mx-auto max-w-3xl">
              <div className="rounded-full border border-white/70 bg-white/55 px-3 py-2 shadow-[0_10px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-700 transition hover:bg-white"
                    aria-label="Upload attachment"
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    className="hidden"
                    onChange={handleAttachmentChange}
                  />
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Ask a question..."
                    className="h-10 flex-1 rounded-full bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  <button
                    type="submit"
                    disabled={(!inputValue.trim() && !attachment) || isSending}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Send message"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                </div>
                {attachment && (
                  <div className="mt-2 flex items-center justify-between rounded-full bg-white/70 px-3 py-1 text-xs text-slate-600">
                    <span className="truncate">{attachment.name}</span>
                    <button type="button" onClick={clearAttachment} className="ml-2 text-slate-500 hover:text-slate-800" aria-label="Remove attachment">
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </form>
          </footer>
        </main>
      </div>
    </div>
  );
}
