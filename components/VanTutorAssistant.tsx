import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { onValue, push, ref as dbRef, serverTimestamp, set, update } from 'firebase/database';
import 'katex/dist/katex.min.css';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { ChatIcon } from './icons/ChatIcon';
import { SendIcon } from './icons/SendIcon';
import { PlusIcon } from './icons/PlusIcon';
import { XIcon } from './icons/XIcon';
import { PromptInput, PromptInputActions, PromptInputTextarea } from './prompt-kit/prompt-input';
import { PromptSuggestion } from './prompt-kit/prompt-suggestion';

type AssistantSender = 'user' | 'assistant';

interface AssistantMessage {
  id: string;
  sender: AssistantSender;
  text: string;
  timestamp?: number;
}

interface HistoryItem {
  id: string;
  title: string;
  lastUpdatedAt: number;
}

interface VanTutorAssistantProps {
  userProfile: UserProfile;
}

const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;
const ASSISTANT_MODEL = 'gemini-2.5-flash';

const suggestionGroups = [
  {
    label: 'Summary',
    highlight: 'Summarize',
    items: [
      'Summarize this topic for me',
      'Summarize my lecture notes',
      'Summarize the key formulas',
      'Summarize this chapter in simple terms',
    ],
  },
  {
    label: 'Code',
    highlight: 'Help me',
    items: [
      'Help me write React components',
      'Help me debug code',
      'Help me learn Python',
      'Help me learn SQL',
    ],
  },
  {
    label: 'Design',
    highlight: 'Design',
    items: [
      'Design a study plan',
      'Design a revision timetable',
      'Design a simple landing page',
      'Design a clean dashboard layout',
    ],
  },
  {
    label: 'Research',
    highlight: 'Research',
    items: [
      'Research the best study methods',
      'Research how to revise faster',
      'Research the best note-taking techniques',
      'Research the most effective exam strategies',
    ],
  },
];

const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const truncateTitle = (text: string) => {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New Chat';
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trim()}...` : cleaned;
};

const normalizeTitle = (text: string) => {
  const cleaned = text
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateTitle(cleaned || 'New Chat');
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

const mapSender = (sender: string | undefined): AssistantSender => {
  if (sender === 'user') return 'user';
  if (sender === 'assistant' || sender === 'ai' || sender === 'bot') return 'assistant';
  if (sender) console.warn('Unexpected chat sender value:', { sender, context: 'message mapping' });
  return 'assistant';
};

const MOBILE_COMPOSER_BOTTOM_OFFSET_CLASS = 'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0rem))]';

export default function VanTutorAssistant({ userProfile }: VanTutorAssistantProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [statusText, setStatusText] = useState('Ready to help with math, science, and study plans.');
  const [activeCategory, setActiveCategory] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    setIsHistoryLoading(true);
    const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);

    const unsubscribe = onValue(conversationsRef, snapshot => {
      if (!snapshot.exists()) {
        setHistory([]);
        setActiveHistoryId(null);
        setIsHistoryLoading(false);
        return;
      }

      const nextHistory: HistoryItem[] = [];
      snapshot.forEach(child => {
        const value = child.val() || {};
        nextHistory.push({
          id: child.key || '',
          title: normalizeTitle(value.title || 'New Chat'),
          lastUpdatedAt: Number(value.last_updated_at || value.created_at || 0),
        });
      });

      nextHistory.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
      setHistory(nextHistory);
      setIsHistoryLoading(false);
      setActiveHistoryId(current => current && nextHistory.some(item => item.id === current) ? current : null);
    });

    return unsubscribe;
  }, [userProfile.uid]);

  useEffect(() => {
    if (!activeHistoryId) {
      setMessages([]);
      return;
    }

    const messagesRef = dbRef(db, `chat_messages/${activeHistoryId}`);
    const unsubscribe = onValue(messagesRef, snapshot => {
      if (!snapshot.exists()) {
        setMessages([]);
        return;
      }

      const nextMessages: AssistantMessage[] = [];
      snapshot.forEach(child => {
        const value = child.val() || {};
        nextMessages.push({
          id: child.key || createMessageId(),
          sender: mapSender(value.sender),
          text: value.text || '',
          timestamp: Number(value.timestamp || 0),
        });
      });

      nextMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      setMessages(nextMessages);
    });

    return unsubscribe;
  }, [activeHistoryId]);

  const conversationSummary = useMemo(() => {
    if (activeHistoryId) {
      const active = history.find(item => item.id === activeHistoryId);
      if (active) return active.title;
    }

    return messages.length > 0 ? 'Current chat' : 'New chat';
  }, [activeHistoryId, history, messages.length]);

  const activeCategoryData = useMemo(
    () => suggestionGroups.find(group => group.label === activeCategory),
    [activeCategory]
  );

  const showCategorySuggestions = activeCategory !== '';

  const clearAttachment = () => {
    setAttachment(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const startNewChat = () => {
    setActiveHistoryId(null);
    setMessages([]);
    setInputValue('');
    setActiveCategory('');
    clearAttachment();
    setStatusText('Started a new chat.');
    setIsSidebarOpen(false);
  };

  const generateChatTitle = async (prompt: string, responseText: string) => {
    const fallbackTitle = normalizeTitle(prompt);

    if (!ai) return fallbackTitle;

    try {
      const result = await ai.models.generateContent({
        model: ASSISTANT_MODEL,
        contents: [{
          role: 'user',
          parts: [{
            text: [
              'Create a short, simple, readable chat title for this tutoring conversation.',
              'Rules: maximum 6 words, no markdown, no quotes, no emojis, no trailing punctuation unless needed.',
              `Student message: ${prompt}`,
              `Assistant reply: ${responseText}`,
            ].join('\n'),
          }],
        }],
      });

      return normalizeTitle((result.text || '').split('\n')[0] || fallbackTitle);
    } catch (error) {
      console.error('Failed to generate chat title:', error);
      return fallbackTitle;
    }
  };

  const handleSend = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const prompt = inputValue.trim();
    if ((!prompt && !attachment) || isSending) return;

    const userText = prompt || getHistoryFallbackTitle(prompt, attachment);
    const previousMessages = messages;
    const userMessage: AssistantMessage = {
      id: createMessageId(),
      sender: 'user',
      text: userText,
      timestamp: Date.now(),
    };

    const nextMessages = [...messages, userMessage];
    const isNewConversation = !activeHistoryId;
    const activeConversation = history.find(item => item.id === activeHistoryId);
    const shouldGenerateTitle = isNewConversation || !activeConversation || activeConversation.title === 'New Chat';

    setMessages(nextMessages);
    setInputValue('');
    setIsSending(true);
    setStatusText('Thinking...');

    try {
      if (!ai) {
        setMessages(prev => [
          ...prev,
          {
            id: createMessageId(),
            sender: 'assistant',
            text: 'Gemini is not configured yet. Add the app GEMINI_API_KEY to the .env to enable assistant replies.',
          },
        ]);
        setStatusText('API key missing.');
        return;
      }

      let conversationId = activeHistoryId;
      const now = Date.now();

      if (!conversationId) {
        const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
        const newConversationRef = push(conversationsRef);
        conversationId = newConversationRef.key;

        if (!conversationId) {
          throw new Error('Failed to create conversation: Firebase push() returned no key. Check database permissions and connection.');
        }

        await set(newConversationRef, {
          title: 'New Chat',
          created_at: now,
          last_updated_at: now,
        });
        setActiveHistoryId(conversationId);
      }

      const messagesRef = dbRef(db, `chat_messages/${conversationId}`);
      await push(messagesRef, {
        text: userText,
        sender: 'user',
        timestamp: serverTimestamp(),
      });

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
      const assistantMessage: AssistantMessage = {
        id: createMessageId(),
        sender: 'assistant',
        text: responseText,
        timestamp: Date.now(),
      };

      await push(messagesRef, {
        text: responseText,
        sender: 'assistant',
        timestamp: serverTimestamp(),
      });

      const updates: { title?: string; last_updated_at: number } = {
        last_updated_at: 0,
      };

      if (shouldGenerateTitle) {
        updates.title = await generateChatTitle(userText, responseText);
      }

      updates.last_updated_at = Date.now();
      await update(dbRef(db, `chat_conversations/${userProfile.uid}/${conversationId}`), updates);

      setMessages([...nextMessages, assistantMessage]);
      setStatusText('Response ready.');
      clearAttachment();
    } catch (error) {
      console.error('Gemini assistant error:', error);
      setMessages([
        ...previousMessages,
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
    setActiveCategory('');
  };

  const handlePromptInputValueChange = (value: string) => {
    setInputValue(value);
    if (value.trim() === '') {
      setActiveCategory('');
      return;
    }
    if (activeCategory && !activeCategoryData?.items.includes(value)) {
      setActiveCategory('');
    }
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    setStatusText(`Attachment ready: ${file.name}`);
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-emerald-50/40">
      <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-7xl overflow-hidden bg-white/90 backdrop-blur md:rounded-[2rem] md:border md:border-white/70 md:shadow-[0_20px_80px_rgba(15,23,42,0.08)]">
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
            {isHistoryLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Loading chat history...
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Your saved chats will appear here.
              </div>
            ) : (
              history.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveHistoryId(item.id);
                    setIsSidebarOpen(false);
                    setStatusText(`Opened ${item.title}.`);
                  }}
                  className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${activeHistoryId === item.id ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Recent chat</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{item.title}</p>
                </button>
              ))
            )}
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

          <footer className={`fixed inset-x-0 ${MOBILE_COMPOSER_BOTTOM_OFFSET_CLASS} z-40 px-4 sm:px-6 md:static md:bottom-auto transition-all duration-300 ${isSidebarOpen ? 'pointer-events-none translate-y-6 opacity-0 md:pointer-events-auto md:translate-y-0 md:opacity-100' : ''}`}>
            <div className="mx-auto max-w-4xl space-y-3">
              <div className="flex flex-wrap gap-2">
                {showCategorySuggestions ? (
                  activeCategoryData?.items.map((suggestion) => (
                    <PromptSuggestion
                      key={suggestion}
                      highlight={activeCategoryData.highlight}
                      onClick={() => handlePromptClick(suggestion)}
                    >
                      {suggestion}
                    </PromptSuggestion>
                  ))
                ) : (
                  suggestionGroups.map((suggestion) => (
                    <PromptSuggestion
                      key={suggestion.label}
                      onClick={() => {
                        setActiveCategory(suggestion.label);
                        setInputValue('');
                      }}
                      className="capitalize"
                    >
                      {suggestion.label}
                    </PromptSuggestion>
                  ))
                )}
              </div>

              <PromptInput
                className="!border-0 !bg-transparent !p-0 !shadow-none rounded-[28px]"
                style={{ background: 'linear-gradient(90deg, #ff4d4d, #ffb84d, #4dff88, #4dd2ff, #b84dff)' }}
                value={inputValue}
                onValueChange={handlePromptInputValueChange}
                onSubmit={() => { void handleSend(); }}
              >
                <div className="rounded-[27px] bg-white/95 backdrop-blur-xl border border-white/70 px-4 py-4 md:py-[18px] shadow-[0_10px_40px_rgba(15,23,42,0.12)]">
                  <div className="flex items-end gap-3">
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-700 transition hover:bg-white"
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
                    <div className="flex-1">
                      <PromptInputTextarea
                        placeholder="Ask anything..."
                        className="min-h-[44px] pt-3 pl-4 pr-4 text-base leading-[1.3] sm:text-base md:text-base"
                      />
                      {attachment && (
                        <div className="mt-2 flex items-center justify-between rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600">
                          <span className="truncate">{attachment.name}</span>
                          <button type="button" onClick={clearAttachment} className="ml-2 text-slate-500 hover:text-slate-800" aria-label="Remove attachment">
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <PromptInputActions className="mb-1.5 flex items-end justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { void handleSend(); }}
                        disabled={(!inputValue.trim() && !attachment) || isSending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Send message"
                      >
                        <SendIcon className="h-4 w-4" />
                      </button>
                    </PromptInputActions>
                  </div>
                </div>
              </PromptInput>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
