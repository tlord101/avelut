import { db, get, off, onValue, push, ref as dbRef, remove, serverTimestamp, set, update } from '@/lib/backend';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createAvelutAI, getResponseText } from '../utils/inference';
import type { UserProfile, Message, ChatConversation } from '../types';
import { useToast } from '../hooks/useToast';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  getLocalConversations,
  getLocalMessages,
  saveLocalMessage,
  saveLocalConversation,
  renameLocalConversation,
  deleteLocalConversation,
  generateLocalId,
} from '../services/chatStorageService';
import { getCachedAIResponse, setCachedAIResponse } from '../services/aiCacheService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { formatLatexMath } from '../utils/latexFormatter';
import { Avatar } from './Avatar';
import { ConfirmationModal } from './ConfirmationModal';
import { CodeBlock } from './CodeBlock';

export type ChatMode = 'context' | 'fast' | 'deep' | 'exam';

export interface ChatModeOption {
  id: ChatMode;
  label: string;
  description: string;
}

const CHAT_MODES: ChatModeOption[] = [
  { id: 'context', label: 'Context Aware', description: 'Uses courses & progress context' },
  { id: 'fast', label: 'Fast', description: 'Short & concise answers' },
  { id: 'deep', label: 'Deep', description: 'Step-by-step detailed explanations' },
  { id: 'exam', label: 'Exam Mode', description: 'Practice exam question style' },
];

const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// --- REDESIGNED INPUT COMPOSER (Pill layout matching exact screenshot design) ---
const GrokChatComposer: React.FC<{
  input: string;
  setInput: (val: string) => void;
  isLoading: boolean;
  selectedMode: ChatMode;
  onSelectMode: (mode: ChatMode) => void;
  voiceStatus: 'idle' | 'listening' | 'processing';
  onToggleVoice: () => void;
  onAttach: () => void;
  onSend: () => void;
}> = ({
  input,
  setInput,
  isLoading,
  voiceStatus,
  onToggleVoice,
  onAttach,
  onSend,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
    onAttach?.();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setInput(input ? `${input} [Attached: ${file.name}]` : `[Attached: ${file.name}]\n`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const hasText = Boolean(input.trim());

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 pb-3 sm:pb-5 pt-2 relative">
      <div className="relative flex flex-col bg-[#f4f4f5] dark:bg-[#212124] rounded-[28px] border border-neutral-200/70 dark:border-white/5 transition-all focus-within:ring-1 focus-within:ring-black/10 dark:focus-within:ring-white/10 shadow-sm">
        {/* Hidden File Input for Attach */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Top: Text input / textarea */}
        <div className="px-4 pt-3.5 pb-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything"
            rows={1}
            className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 text-[15px] sm:text-base resize-none max-h-36 py-0 leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
        </div>

        {/* Bottom Row: + button on left, Mic + Blue action button on right */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          {/* Left: + (plus) button */}
          <button
            type="button"
            onClick={handleAttachClick}
            className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/10 transition-colors"
            title="Attach file"
            aria-label="Attach file"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          {/* Right: Mic + Blue circle action button */}
          <div className="flex items-center gap-2">
            {/* Microphone Icon Button */}
            <button
              type="button"
              onClick={onToggleVoice}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                voiceStatus !== 'idle'
                  ? 'text-red-500 bg-red-500/10 dark:bg-red-500/20 animate-pulse'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/10'
              }`}
              title="Voice input"
              aria-label="Voice input"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>

            {/* Blue Circular Action Button */}
            <button
              type="button"
              onClick={hasText ? onSend : onToggleVoice}
              disabled={isLoading}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-95 text-white flex items-center justify-center shrink-0 shadow-sm transition-all"
              title={hasText ? 'Send message' : 'Voice mode'}
              aria-label={hasText ? 'Send message' : 'Voice mode'}
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : hasText ? (
                /* Send up-arrow */
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              ) : (
                /* Exact 4-bar waveform icon matching screenshot */
                <svg className={`w-5 h-5 fill-current ${voiceStatus === 'listening' ? 'animate-pulse' : ''}`} viewBox="0 0 24 24">
                  <rect x="5.5" y="9" width="2" height="6" rx="1" />
                  <rect x="9.5" y="6" width="2" height="12" rx="1" />
                  <rect x="13.5" y="4" width="2" height="16" rx="1" />
                  <rect x="17.5" y="8" width="2" height="8" rx="1" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- CHAT INTERFACE ---
interface ChatProps {
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
  onOpenMenu?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string | null) => void;
}

export const Chat: React.FC<ChatProps> = ({ 
  userProfile, 
  onNavigate, 
  onOpenMenu, 
  setCustomHeaderConfig,
  activeConversationId: propActiveConversationId,
  onSelectConversation,
}) => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(propActiveConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('context');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [courseContext, setCourseContext] = useState<string>('');
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; confirmText?: string }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [isDeleting, setIsDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();
  const { settings: appSettings } = useAppSettings();

  const aiModel = getFeatureModel('chat_interaction', appSettings);
  const ai = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  useEffect(() => {
    if (propActiveConversationId !== undefined) {
      if (propActiveConversationId === null && isLoadingRef.current) {
        return;
      }
      setActiveConversationId(propActiveConversationId);
    }
  }, [propActiveConversationId]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    onSelectConversation?.(null);
  }, [onSelectConversation]);

  const handleClearCurrentChat = useCallback(() => {
    if (messages.length === 0) return;
    setModalState({
      isOpen: true,
      title: 'Clear Messages',
      message: 'Are you sure you want to clear all messages in this conversation? This cannot be undone.',
      confirmText: 'Clear',
      onConfirm: async () => {
        setMessages([]);
        if (activeConversationId) {
          try {
            await remove(dbRef(db, `chat_messages/${activeConversationId}`));
          } catch (e) {
            console.error('Error clearing messages in db:', e);
          }
        }
        setModalState((s) => ({ ...s, isOpen: false }));
        addToast('Messages cleared', 'info');
      },
    });
  }, [messages.length, activeConversationId, addToast]);

  const handleDeleteCurrentChat = useCallback(() => {
    if (!activeConversationId) return;
    setModalState({
      isOpen: true,
      title: 'Delete Conversation',
      message: 'Are you sure you want to delete this conversation? All chat history for this topic will be permanently removed.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await deleteLocalConversation(activeConversationId);
          await remove(dbRef(db, `chat_conversations/${userProfile.uid}/${activeConversationId}`));
          await remove(dbRef(db, `chat_messages/${activeConversationId}`));
          setActiveConversationId(null);
          setMessages([]);
          onSelectConversation?.(null);
          addToast('Conversation deleted', 'info');
        } catch (e) {
          console.error('Error deleting conversation:', e);
          addToast('Failed to delete conversation', 'error');
        } finally {
          setIsDeleting(false);
          setModalState((s) => ({ ...s, isOpen: false }));
        }
      },
    });
  }, [activeConversationId, userProfile.uid, onSelectConversation, addToast]);

  // Dynamically configure main App Header for Avelut AI
  useEffect(() => {
    if (!setCustomHeaderConfig) return;
    setCustomHeaderConfig({
      hideTitle: true,
      title: null,
      hideDefaultRightActions: true,
      hideProfileAvatar: true,
      className: 'absolute top-0 left-0 right-0 z-40 flex items-center justify-between bg-transparent border-none px-4 sm:px-6 md:px-8 pt-[max(0.875rem,env(safe-area-inset-top))] pb-3 pointer-events-none [&>*]:pointer-events-auto',
      onNewChat: handleNewChat,
      onClearChat: handleClearCurrentChat,
      onDeleteChat: handleDeleteCurrentChat,
      hasActiveChat: Boolean(activeConversationId),
      hasMessages: messages.length > 0,
    });
    return () => {
      setCustomHeaderConfig(null);
    };
  }, [
    setCustomHeaderConfig,
    handleNewChat,
    handleDeleteCurrentChat,
    handleClearCurrentChat,
    activeConversationId,
    messages.length,
  ]);

  // Load user conversations
  useEffect(() => {
    let isMounted = true;
    getLocalConversations(userProfile.uid).then((localConvos) => {
      if (isMounted && localConvos.length > 0) {
        setConversations(
          localConvos.map((c) => ({
            id: c.id,
            user_id: c.user_id || userProfile.uid,
            title: c.title || 'New Chat',
            created_at: c.created_at || 0,
            last_updated_at: c.last_updated_at || c.created_at || 0,
          }))
        );
      }
    }).catch(() => {});

    const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
    const unsubscribe = onValue(conversationsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data: any[] = [];
        snapshot.forEach((child) => {
          data.push({ id: child.key, ...child.val() });
        });
        const sorted = data.sort((a, b) => b.last_updated_at - a.last_updated_at);
        if (isMounted) setConversations(sorted as ChatConversation[]);
      } else {
        getLocalConversations(userProfile.uid).then((localConvos) => {
          if (isMounted && localConvos.length > 0) {
            setConversations(
              localConvos.map((c) => ({
                id: c.id,
                user_id: c.user_id || userProfile.uid,
                title: c.title || 'New Chat',
                created_at: c.created_at || 0,
                last_updated_at: c.last_updated_at || c.created_at || 0,
              }))
            );
          } else if (isMounted) {
            setConversations([]);
          }
        }).catch(() => {});
      }
    });

    return () => {
      isMounted = false;
      off(conversationsRef);
    };
  }, [userProfile.uid]);

  // Fetch student course context for grounding
  useEffect(() => {
    const fetchCourseContext = async () => {
      try {
        const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
        const progressSnap = await get(progressRef);
        let contextText = `STUDENT LEVEL: ${userProfile.level}\nDEPARTMENT: ${userProfile.department_id}\n\n`;

        if (progressSnap.exists()) {
          contextText += 'STUDENT PROGRESS DATA:\n';
          const progressData = progressSnap.val();
          Object.keys(progressData).forEach((courseId) => {
            const courses = progressData[courseId];
            contextText += `- ${courseId}: ${Object.keys(courses).filter((k) => courses[k].status === 'completed').join(', ')}\n`;
          });
        }

        setCourseContext(contextText);
      } catch (err) {
        console.error('Error fetching course context:', err);
      }
    };
    fetchCourseContext();
  }, [userProfile.uid, userProfile.department_id, userProfile.level]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConversationId) {
      if (!isLoadingRef.current) {
        setMessages([]);
      }
      return;
    }

    let isMounted = true;
    getLocalMessages(activeConversationId).then((localMsgs) => {
      if (isMounted && localMsgs.length > 0) {
        setMessages((current) => {
          const localFormatted: Message[] = localMsgs.map((m) => ({
            id: m.id,
            text: m.text,
            sender: (m.sender === 'user' ? 'user' : 'bot') as 'user' | 'bot',
            timestamp: m.timestamp,
          }));
          const existingIds = new Set(localFormatted.map((m) => m.id));
          const existingTexts = new Set(localFormatted.map((m) => `${m.sender}:${m.text}`));
          const uniqueCurrent = current.filter(
            (m) => !existingIds.has(m.id) && !existingTexts.has(`${m.sender}:${m.text}`)
          );
          return [...localFormatted, ...uniqueCurrent].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    }).catch(() => {});

    const messagesRef = dbRef(db, `chat_messages/${activeConversationId}`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data: any[] = [];
        snapshot.forEach((child) => {
          data.push({ id: child.key, ...child.val() });
        });
        const sorted = data.sort((a, b) => a.timestamp - b.timestamp);
        if (isMounted) {
          setMessages((current) => {
            const dbTexts = new Set(sorted.map((m: any) => `${m.sender === 'user' ? 'user' : 'bot'}:${m.text}`));
            const dbIds = new Set(sorted.map((m: any) => m.id));
            const inFlight = current.filter(
              (m) => !dbIds.has(m.id) && !dbTexts.has(`${m.sender}:${m.text}`)
            );
            return [...sorted, ...inFlight].sort((a, b) => a.timestamp - b.timestamp) as Message[];
          });
        }
      } else {
        if (isMounted && !isLoadingRef.current) {
          setMessages([]);
        }
      }
    });

    return () => {
      isMounted = false;
      off(messagesRef);
    };
  }, [activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || isLoading) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitModal(true);
      return;
    }

    const currentInput = textToSend;
    setInput('');
    setIsLoading(true);

    try {
      let currentConvoId = activeConversationId;
      const now = Date.now();

      const isNewConvo = !currentConvoId;
      if (!currentConvoId) {
        currentConvoId = generateLocalId('conv');
        const initialTitle = currentInput.slice(0, 30);
        void saveLocalConversation({
          id: currentConvoId,
          user_id: userProfile.uid,
          title: initialTitle,
          created_at: now,
          last_updated_at: now,
        });

        const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}/${currentConvoId}`);
        await set(conversationsRef, {
          title: initialTitle,
          created_at: now,
          last_updated_at: now,
        });
        setActiveConversationId(currentConvoId);
        onSelectConversation?.(currentConvoId);
      }

      if (isNewConvo && ai && currentConvoId) {
        const convoIdForTitle = currentConvoId;
        (async () => {
          try {
            const titleResult = await ai.models.generateContent({
              model: aiModel,
              contents: [{
                role: 'user',
                parts: [{
                  text: `Summarize the following user prompt into a short, concise chat title of 3 to 6 words. Do not use quotes, punctuation, or preamble. Return ONLY the title.\n\nUser prompt: "${currentInput.slice(0, 300)}"`
                }]
              }],
              config: { temperature: 0.3 }
            });
            const generatedTitle = getResponseText(titleResult).trim().replace(/^["']|["']$/g, '');
            if (generatedTitle && generatedTitle.length > 0) {
              void renameLocalConversation(convoIdForTitle, generatedTitle);
              void update(dbRef(db, `chat_conversations/${userProfile.uid}/${convoIdForTitle}`), { title: generatedTitle });
            }
          } catch (e) {
            console.warn('Failed to auto-generate chat title:', e);
          }
        })();
      }

      const userMsgId = generateLocalId('msg');
      void saveLocalMessage({
        id: userMsgId,
        conversation_id: currentConvoId,
        user_id: userProfile.uid,
        sender: 'user',
        text: currentInput,
        timestamp: now,
      });

      const aiMsgId = generateLocalId('msg');

      // Append user message (typing indicator is handled cleanly by single isLoading state)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== aiMsgId),
        { id: userMsgId, text: currentInput, sender: 'user', timestamp: now },
      ]);

      const updateOrAppendAiMessage = (text: string) => {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === aiMsgId);
          if (exists) {
            return prev.map((m) => (m.id === aiMsgId ? { ...m, text } : m));
          } else {
            return [...prev, { id: aiMsgId, text, sender: 'bot', timestamp: now + 1 }];
          }
        });
      };

      const messagesRef = dbRef(db, `chat_messages/${currentConvoId}`);
      try {
        push(messagesRef, {
          text: currentInput,
          sender: 'user',
          timestamp: serverTimestamp(),
        });
      } catch (e) {
        console.error(e);
      }

      update(dbRef(db, `chat_conversations/${userProfile.uid}/${currentConvoId}`), { last_updated_at: Date.now() });

      // Build clean, responsive system instruction for Avelut AI
      const baseSystemInstruction = [
        'You are Avelut, a smart, versatile, helpful, and friendly conversational AI assistant.',
        'You can assist with any topic: everyday casual chat, writing, coding, math, science, and general learning.',
        'Guidelines:',
        '- Keep responses natural, direct, human-like, and clear. Avoid robotic formal speeches, scripted intros, or repeating "I am Avelut, how can I help you?".',
        '- For simple greetings or casual small talk (e.g., "hi", "hello", "hey", "what\'s up"), reply warmly, naturally, and directly.',
        '- When formatting equations or mathematical expressions, use standard LaTeX ($...$ for inline, $$...$$ for blocks).',
      ].join('\n');

      let modeInstruction = '';
      if (selectedMode === 'fast') {
        modeInstruction = '\nProvide a brief, direct, and concise response.';
      } else if (selectedMode === 'deep') {
        modeInstruction = '\nProvide a detailed, step-by-step thorough explanation with clear examples.';
      } else if (selectedMode === 'exam') {
        modeInstruction = '\nFormat response as practice exam questions with explanations and key takeaways.';
      }

      let optionalContext = '';
      if (selectedMode === 'context' && userProfile.department_id) {
        optionalContext = `\n[Student Background Context - Department: ${userProfile.department_id}, Level: ${userProfile.level || ''}]`;
      }

      const fullSystemInstruction = `${baseSystemInstruction}${modeInstruction}${optionalContext}`;

      // Build conversation history for multi-turn context (last 10 non-empty messages)
      const historyContents = messages
        .filter((m) => m.text && m.text.trim())
        .slice(-10)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          parts: [{ text: m.text }],
        }));

      historyContents.push({
        role: 'user',
        parts: [{ text: currentInput }],
      });

      const aiParams = {
        model: aiModel,
        contents: historyContents,
        config: {
          systemInstruction: fullSystemInstruction,
          temperature: 0.7,
        },
      };

      const cachedReply = await getCachedAIResponse(currentInput, aiModel, selectedMode);
      let responseText = cachedReply || '';

      if (responseText) {
        updateOrAppendAiMessage(responseText);
      } else {
        if (!ai) {
          addToast('Avelut AI is not configured in settings.', 'error');
          setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
          return;
        }

        try {
          const responseStream = await ai.models.generateContentStream(aiParams);

          for await (const chunk of responseStream) {
            const chunkText = getResponseText(chunk);
            responseText += chunkText;
            updateOrAppendAiMessage(responseText);
          }
        } catch (streamErr: any) {
          console.warn('Streaming failed or not supported, falling back to generateContent:', streamErr);
          const aiResult = await attemptApiCall(async () => {
            const result = await ai.models.generateContent(aiParams);
            const resText = getResponseText(result);
            if (!resText) throw new Error('Avelut AI returned an empty response.');
            return resText;
          });

          if (!aiResult.success) {
            addToast(aiResult.message, 'error');
            setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
            return;
          }

          responseText = (aiResult.data || '').trim();
          updateOrAppendAiMessage(responseText);
        }

        if (responseText) {
          void setCachedAIResponse(currentInput, aiModel, selectedMode, responseText);
        }
      }

      if (!responseText.trim()) {
        responseText = 'I apologize, but I could not generate a response. Please try again.';
        updateOrAppendAiMessage(responseText);
      }

      void saveLocalMessage({
        id: aiMsgId,
        conversation_id: currentConvoId,
        user_id: userProfile.uid,
        sender: 'assistant',
        text: responseText,
        timestamp: Date.now(),
      });

      try {
        push(messagesRef, {
          text: responseText,
          sender: 'ai',
          timestamp: serverTimestamp(),
        });
      } catch (e) {
        console.error(e);
      }

      void deductAICredits(userProfile.uid, cost, 'AI Chat Assistant', appSettings);
    } catch (err) {
      console.error('Error in chat:', err);
      addToast('An error occurred while sending your message.', 'error');
      setMessages((prev) => prev.filter((m) => m.text !== ''));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoice = () => {
    if (voiceStatus === 'idle') {
      setVoiceStatus('listening');
      setTimeout(() => setVoiceStatus('idle'), 4000);
    } else {
      setVoiceStatus('idle');
    }
  };

  const [likedMessages, setLikedMessages] = useState<Record<string, 'up' | 'down'>>({});

  const handleToggleLike = (msgId: string, rating: 'up' | 'down') => {
    setLikedMessages((prev) => {
      const current = prev[msgId];
      if (current === rating) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      return { ...prev, [msgId]: rating };
    });
    addToast(rating === 'up' ? 'Feedback submitted (Thumbs up)' : 'Feedback submitted (Thumbs down)', 'info');
  };

  const handleCopyMessage = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      addToast('Copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy text', 'error');
    });
  };

  const handleShareMessage = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch (e) {
        // Ignored if cancelled
      }
    } else {
      handleCopyMessage(text);
    }
  };

  const handleRegenerateMessage = (msgIndex: number) => {
    // Find the nearest preceding user message
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        void handleSendMessage(messages[i].text);
        break;
      }
    }
  };

  const TypingIndicator: React.FC = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        .dot {
          fill: #555555;
          animation: shine 1.8s infinite linear;
        }

        .c0 { animation-delay: 0s; }
        .c1 { animation-delay: 0.2s; }
        .c2 { animation-delay: 0.4s; }

        @keyframes shine {
          0%, 100% {
            fill: #555555;
            opacity: 0.3;
          }
          30%, 50% {
            fill: #888888;
            opacity: 1;
          }
        }
      `}</style>
      <circle className="dot c0" cx="6" cy="6" r="1.5" />
      <circle className="dot c0" cx="6" cy="12" r="1.5" />
      <circle className="dot c0" cx="6" cy="18" r="1.5" />
      <circle className="dot c1" cx="12" cy="6" r="1.5" />
      <circle className="dot c1" cx="12" cy="12" r="1.5" />
      <circle className="dot c1" cx="12" cy="18" r="1.5" />
      <circle className="dot c2" cx="18" cy="6" r="1.5" />
      <circle className="dot c2" cx="18" cy="12" r="1.5" />
      <circle className="dot c2" cx="18" cy="18" r="1.5" />
    </svg>
  );

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-white dark:bg-black overflow-hidden text-neutral-900 dark:text-white">
      {/* MESSAGES / EMPTY STATE AREA */}
      <div className="flex-1 overflow-y-auto px-4 pt-[calc(max(0.875rem,env(safe-area-inset-top))+3.5rem)] pb-6 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {messages.length === 0 && !isLoading ? (
          <div className="flex-1 h-full min-h-[40vh]" />
        ) : (
          <div className="w-full max-w-3xl mx-auto space-y-8">
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'user' ? (
                  /* Gemini User messages: Simple rounded pill bubble only, NO avatar, NO label, NO timestamp */
                  <div className="max-w-[85%] sm:max-w-[75%]">
                    <div className="px-5 py-3 rounded-full text-[15px] sm:text-[16px] leading-relaxed bg-[#f0f0f0] dark:bg-[#2f2f2f] text-neutral-900 dark:text-white inline-block text-left break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  /* Gemini AI responses: Plain text (no bubble, no logo, no name, no timestamp) + Action Icon Row */
                  <div className="w-full bg-transparent border-0 shadow-none p-0 min-w-0">
                    <div className="w-full font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em] font-normal text-neutral-900 dark:text-neutral-100 prose prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-[1.75] prose-headings:my-4 prose-headings:font-bold prose-headings:tracking-tight prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0">
                      {!msg.text ? (
                        <div className="py-1">
                          <TypingIndicator />
                        </div>
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={{
                            code({ node, inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              const codeString = String(children || '').replace(/\n$/, '');
                              
                              if (!inline && (match || codeString.includes('\n'))) {
                                return (
                                  <CodeBlock
                                    language={match ? match[1] : 'code'}
                                    value={codeString}
                                  />
                                );
                              }
                              return (
                                <code
                                  className="bg-neutral-100 dark:bg-neutral-800 text-[#0066FF] dark:text-[#38bdf8] font-mono px-1.5 py-0.5 rounded text-[13px] font-medium"
                                  {...props}
                                >
                                  {children}
                                </code>
                              );
                            },
                            pre({ children }) {
                              return <>{children}</>;
                            },
                          }}
                        >
                          {formatLatexMath(msg.text)}
                        </ReactMarkdown>
                      )}
                    </div>

                    {/* Gemini Action Icon Row under AI responses */}
                    {msg.text && (
                      <div className="flex items-center gap-1 mt-3 text-neutral-500 dark:text-neutral-400 select-none">
                        {/* Thumbs Up */}
                        <button
                          type="button"
                          onClick={() => handleToggleLike(msg.id, 'up')}
                          className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                            likedMessages[msg.id] === 'up' ? 'text-blue-600 dark:text-blue-400' : ''
                          }`}
                          title="Good response"
                          aria-label="Good response"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422-.068.85-.31 1.196l-2.483 3.548c-.412.589-1.082.941-1.796.941H12.75a3 3 0 01-2.006-.764l-2.073-1.866a3 3 0 00-2.006-.764H5.25a.75.75 0 01-.75-.75V11.25c0-.414.336-.75.75-.75h1.383z" />
                          </svg>
                        </button>

                        {/* Thumbs Down */}
                        <button
                          type="button"
                          onClick={() => handleToggleLike(msg.id, 'down')}
                          className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                            likedMessages[msg.id] === 'down' ? 'text-red-600 dark:text-red-400' : ''
                          }`}
                          title="Bad response"
                          aria-label="Bad response"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.367 13.5c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672V21a.75.75 0 01-.75.75A2.25 2.25 0 017.5 19.5c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H4.372c-1.026 0-1.945-.694-2.054-1.715a2.235 2.235 0 01.31-1.196l2.483-3.548c.412-.589 1.082-.941 1.796-.941h4.343a3 3 0 012.006.764l2.073 1.866c.57.513 1.298.764 2.006.764h1.383c.414 0 .75.336.75.75v5.25c0 .414-.336.75-.75.75h-1.383z" />
                          </svg>
                        </button>

                        {/* Regenerate */}
                        <button
                          type="button"
                          onClick={() => handleRegenerateMessage(index)}
                          className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Regenerate response"
                          aria-label="Regenerate response"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M20.985 8.358a9.003 9.003 0 00-15.357-2m15.357 2H16.023m-4.956 9.349H6.075v.001m-4.993-1.01a9.003 9.003 0 0015.357 2m-15.357-2H6.075" />
                          </svg>
                        </button>

                        {/* Copy */}
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.text)}
                          className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Copy text"
                          aria-label="Copy text"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25c0-.621.504-1.125 1.125-1.125h6.75c.621 0 1.125.504 1.125 1.125v9.25c0 .621-.504 1.125-1.125 1.125z" />
                          </svg>
                        </button>

                        {/* Share */}
                        <button
                          type="button"
                          onClick={() => handleShareMessage(msg.text)}
                          className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="Share"
                          aria-label="Share"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                          </svg>
                        </button>

                        {/* More (⋯) */}
                        <button
                          type="button"
                          onClick={() => addToast('More options', 'info')}
                          className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                          title="More options"
                          aria-label="More options"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (messages.length === 0 || messages[messages.length - 1]?.sender === 'user') && (
              <div className="flex justify-start w-full">
                <div className="py-1">
                  <TypingIndicator />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </div>

      {/* INPUT BAR (Grok-style) */}
      <GrokChatComposer
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        voiceStatus={voiceStatus}
        onToggleVoice={toggleVoice}
        onAttach={() => {}}
        onSend={() => handleSendMessage()}
      />

      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={getFeatureCost('chat_interaction', appSettings)}
        balance={userProfile?.ai_credits_balance ?? 0}
        addToast={addToast}
      />

      <ConfirmationModal
        {...modalState}
        onCancel={() => setModalState((s) => ({ ...s, isOpen: false }))}
        isConfirming={isDeleting}
      />
    </div>
  );
};
