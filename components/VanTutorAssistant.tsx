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

const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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

export default function VanTutorAssistant() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(starterHistory);
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState('Ready to help with math, science, and study plans.');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const conversationSummary = useMemo(() => {
    if (!messages.length) return 'Fresh chat';
    if (history.length > 0) return history[0].title;
    return truncateTitle(messages[messages.length - 1].text);
  }, [history, messages]);

  const updateRecentHistory = (title: string) => {
    const nextTitle = truncateTitle(title);
    setHistory(prev => [
      { id: Date.now(), title: nextTitle },
      ...prev.filter(item => item.title !== nextTitle && item.title !== 'New Chat'),
    ].slice(0, 6));
  };

  const startNewChat = () => {
    setMessages([]);
    setInputValue('');
    setStatusText('Started a new chat.');
    setIsSidebarOpen(false);
    inputRef.current?.focus();
  };

  const handleSend = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const prompt = inputValue.trim();
    if (!prompt || isSending) return;

    const userMessage: AssistantMessage = {
      id: createMessageId(),
      sender: 'user',
      text: prompt,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputValue('');
    setIsSending(true);
    setStatusText('Thinking...');

    if (!messages.length) updateRecentHistory(prompt);

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

      const result = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{
              text: [
                'You are VanTutorAssistant, a friendly study companion for university students.',
                'Answer clearly, encourage the learner, and keep explanations concise but complete.',
                'When math is involved, use Markdown and LaTeX formatting with inline $...$ and display $$...$$ equations.',
                'If the question needs calculations, show the steps and final formula neatly.',
                '',
                `Conversation so far:\n${nextMessages.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n')}`,
              ].join('\n'),
            }],
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
      updateRecentHistory(prompt);
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

          <section className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
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
                      className={`max-w-[85%] rounded-3xl px-4 py-3 shadow-sm sm:max-w-[75%] ${
                        message.sender === 'user'
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 bg-white text-slate-800'
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

          <footer className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
            <form onSubmit={handleSend} className="mx-auto max-w-4xl">
              <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={3}
                  placeholder="Ask a question, paste a formula, or request a worked solution..."
                  className="w-full resize-none bg-transparent px-1 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">Press Enter to send, Shift+Enter for a new line.</p>
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isSending}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SendIcon className="h-4 w-4" />
                    Send
                  </button>
                </div>
              </div>
            </form>
          </footer>
        </main>
      </div>
    </div>
  );
}
