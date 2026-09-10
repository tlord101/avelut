import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { motion, AnimatePresence } from 'framer-motion';
import { formatLatexMath } from '../utils/latexFormatter';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost, hasLiveTutorialAccess } from '../utils/usage';
import { readCachedJson, writeCachedJson, clearCachedKey } from '../utils/cache';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { XIcon } from './icons/XIcon';
import { TypingIndicator } from './TypingIndicator';
import type { Course, Topic, UserProfile } from '../types';

const PlusIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CameraOutlineIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const PhotoOutlineIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const FolderOutlineIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

export interface CourseChatTutorMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    isImage: boolean;
  }>;
}

export interface CourseChatTutorProps {
  course: Course;
  topic: Topic;
  userProfile: UserProfile;
  onBack: () => void;
  onOpenVoiceTutorial: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

export const CourseChatTutor: React.FC<CourseChatTutorProps> = ({
  course,
  topic,
  userProfile,
  onBack,
  onOpenVoiceTutorial,
  setCustomHeaderConfig,
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();

  const cacheKey = `avelut_course_chat_${userProfile?.uid || 'anon'}_${course.course_id}_${topic.topic_id}`;

  const [messages, setMessages] = useState<CourseChatTutorMessage[]>(() => {
    return readCachedJson<CourseChatTutorMessage[]>(cacheKey, []);
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [expandedUserMessageIds, setExpandedUserMessageIds] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitCost, setLimitCost] = useState(1);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputElementRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Check live tutorial access
  const liveAccess = hasLiveTutorialAccess(userProfile);



  const handleTriggerLiveTutorial = useCallback(() => {
    if (!liveAccess.allowed) {
      setLimitCost(450);
      setShowLimitModal(true);
      return;
    }
    onOpenVoiceTutorial();
  }, [liveAccess.allowed, onOpenVoiceTutorial]);

  // Configure Main App Header for Course Chat Tutor
  useEffect(() => {
    if (setCustomHeaderConfig) {
      setCustomHeaderConfig({
        hideBottomNav: true,
        hideTitle: true,
        hideDefaultRightActions: true,
        leftActions: (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[calc(100vw-110px)] sm:max-w-none">
            {/* Back Arrow Button — Off-white styling */}
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-[#E3E9F1] dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-[#0F172A] dark:text-white text-xs sm:text-sm font-bold active:scale-95 cursor-pointer transition-all shrink-0 shadow-2xs"
              aria-label="Back to study guide"
              title="Back"
            >
              <i className="bi bi-arrow-left text-sm font-bold text-[#0066FF]"></i>
              <span className="hidden sm:inline">Back</span>
            </button>

            {/* Live Tutorial Button — Enlarged with high visibility & padlock gating */}
            <button
              onClick={handleTriggerLiveTutorial}
              className="flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-2xl border border-[#0066FF]/30 hover:border-[#0066FF] bg-white dark:bg-slate-900 hover:bg-brand-50/40 dark:hover:bg-slate-800 text-[#0F172A] dark:text-white text-xs sm:text-sm font-extrabold active:scale-95 cursor-pointer transition-all shrink-0 shadow-2xs group"
              title={liveAccess.allowed ? "Launch Live Voice & Whiteboard Tutorial" : "Live Tutorial Locked (Weekly/Monthly Plan or ₦450/topic)"}
            >
              <div className="w-5 h-5 rounded-full bg-[#0066FF]/10 flex items-center justify-center text-[#0066FF] shrink-0">
                <i className="bi bi-broadcast text-xs font-bold animate-pulse"></i>
              </div>
              <span className="whitespace-nowrap font-black tracking-tight text-[#0F172A] dark:text-white">Live Tutorial</span>
              {!liveAccess.allowed && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F3F3F3] dark:bg-[#1C1C1C] text-[#525252] dark:text-[#A3A3A3] text-[10px] font-extrabold border border-[#E6E6E6] dark:border-[#2A2A2A]">
                  <i className="bi bi-lock-fill text-[10px]"></i>
                  <span className="hidden sm:inline">₦450</span>
                </span>
              )}
            </button>

            {/* Topic & Course Info */}
            <div className="min-w-0 flex flex-col justify-center ml-1">
              <span className="text-[10px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider block truncate">
                {course.course_code || course.course_name}
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate max-w-[110px] sm:max-w-[220px] md:max-w-[320px]">
                {topic.topic_name}
              </h2>
            </div>
          </div>
        ),
        className: 'bg-[#F6F6F3]/95 dark:bg-[#0A0A0A]/95 border-b border-[#E3E9F1] dark:border-slate-800 backdrop-blur-md',
      });
    }
    return () => {
      if (setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [setCustomHeaderConfig, onBack, handleTriggerLiveTutorial, course, topic, liveAccess.allowed]);

  const toggleUserMessageExpand = (id: string) => {
    setExpandedUserMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  // WhatsApp-style instant bottom anchor on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom('instant' as ScrollBehavior);
    }, 40);
    return () => clearTimeout(timer);
  }, [scrollToBottom]);

  // Keep scrolled to bottom during streaming and on message updates
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom('smooth');
    }
  }, [messages, scrollToBottom]);

  // Auto-initiate first Socratic bite-sized step if chat is empty
  useEffect(() => {
    if (messages.length === 0 && !isSending) {
      void initFirstBiteSizedStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initFirstBiteSizedStep = async () => {
    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });
    if (!ai) return;

    setIsSending(true);
    const starterAiMsgId = `msg_ai_${Date.now()}`;
    const initialPlaceholder: CourseChatTutorMessage = {
      id: starterAiMsgId,
      sender: 'assistant',
      text: '',
      timestamp: Date.now(),
    };
    setMessages([initialPlaceholder]);
    setStreamingMsgId(starterAiMsgId);

    const socraticSystemPrompt = [
      `You are AVELUT Socratic Course Tutor for "${course.course_name}" (${course.course_code || ''}).`,
      `TOPIC: "${topic.topic_name}"`,
      `TOPIC OVERVIEW: "${topic.topic_context || topic.start_point || 'Core principles of ' + topic.topic_name}"`,
      '',
      'TASK: Begin the first bite-sized step of teaching this topic to the student.',
      'MANDATORY TEACHING CONSTRAINTS:',
      '1. STRICTLY BITE-SIZED: Keep total response under 80-110 words. Teach only ONE introductory micro-concept. Never dump paragraphs of text.',
      '2. INTERACTIVE CHECK: Conclude with 1 simple, engaging check question or thought prompt to test the student before proceeding.',
      '3. TYPOGRAPHIC HIERARCHY (Strictly Follow):',
      '   - Use a clear ### Subheading for the concept title.',
      '   - Use **bold** for key concepts, essential terms, and definitions.',
      '   - Use *italics* for emphasis or subtle terminology.',
      '   - Use clean bullet points (- ) when listing items (max 2 bullets).',
      '   - Format all math, formulas, and symbols with LaTeX ($...$ inline, $$...$$ block).',
      '4. ANALOGY: Use an intuitive everyday Nigerian analogy (e.g. POS charges, Danfo bus speeds, NEPA power vs. generator, market prices).',
      '5. Provide your response directly. Do not use emojis or internal reasoning monologues.',
    ].join('\n');

    const aiParams = {
      model: 'qwen/qwen3.7-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: `Hello! I am ready to learn "${topic.topic_name}" for ${course.course_name}. Please begin our first step.` }],
        },
      ],
      config: {
        systemInstruction: socraticSystemPrompt,
        temperature: 0.35,
        maxOutputTokens: 400,
      },
    };

    let streamedText = '';
    try {
      const responseStream = await ai.models.generateContentStream(aiParams);
      for await (const chunk of responseStream) {
        const chunkText = getResponseText(chunk);
        if (chunkText) {
          streamedText += chunkText;
          setMessages((prev) =>
            prev.map((m) => (m.id === starterAiMsgId ? { ...m, text: streamedText } : m))
          );
        }
      }
    } catch (err) {
      console.warn('[CourseChatTutor] Starter stream error, falling back:', err);
      const fallbackResult = await attemptApiCall(async () => {
        const res = await ai.models.generateContent(aiParams);
        return getResponseText(res);
      });
      if (fallbackResult.success && fallbackResult.data) {
        streamedText = fallbackResult.data.trim();
      }
    }

    if (!streamedText.trim()) {
      streamedText = `Welcome to **${topic.topic_name}** for ${course.course_name}!\n\nLet's master this topic step by step. Ready to begin?`;
    }

    setMessages((prev) => {
      const updated = prev.map((m) => (m.id === starterAiMsgId ? { ...m, text: streamedText } : m));
      writeCachedJson(cacheKey, updated, userProfile?.uid);
      return updated;
    });
    setIsSending(false);
    setStreamingMsgId(null);
  };

  const handleClearChat = async () => {
    if (window.confirm(`Clear conversation for ${topic.topic_name}?`)) {
      setMessages([]);
      clearCachedKey(cacheKey);
      addToast('Conversation cleared.', 'info');
      void initFirstBiteSizedStep();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputValue).trim();
    if (!textToSend && attachments.length === 0) return;
    if (isSending) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitModal(true);
      return;
    }

    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });
    if (!ai) {
      addToast('AI service is not configured.', 'error');
      return;
    }

    // Process attachments
    const attachedData: Array<{ id: string; name: string; url: string; isImage: boolean }> = [];
    const inlineParts: any[] = [];

    for (const file of attachments) {
      const isImg = file.type.startsWith('image/');
      const dataUrl = await fileToDataUrl(file);
      attachedData.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        url: dataUrl,
        isImage: isImg,
      });

      if (isImg) {
        const base64Data = dataUrl.split(',')[1];
        inlineParts.push({
          inlineData: {
            data: base64Data,
            mimeType: file.type || 'image/jpeg',
          },
        });
      }
    }

    const now = Date.now();
    const userMsgId = `msg_user_${now}`;
    const aiMsgId = `msg_ai_${now + 1}`;

    const userMessage: CourseChatTutorMessage = {
      id: userMsgId,
      sender: 'user',
      text: textToSend,
      timestamp: now,
      attachments: attachedData.length > 0 ? attachedData : undefined,
    };

    const aiPlaceholderMsg: CourseChatTutorMessage = {
      id: aiMsgId,
      sender: 'assistant',
      text: '',
      timestamp: now + 1,
    };

    // Optimistically update messages with both user message and thinking tutor placeholder
    const nextMessages = [...messages, userMessage, aiPlaceholderMsg];
    setMessages(nextMessages);
    setInputValue('');
    setAttachments([]);
    setShowAttachmentMenu(false);
    setIsSending(true);
    setStreamingMsgId(aiMsgId);

    if (inputElementRef.current) {
      inputElementRef.current.style.height = 'auto';
    }

    const socraticSystemPrompt = [
      `You are AVELUT Socratic Course Tutor for "${course.course_name}" (${course.course_code || ''}).`,
      `TOPIC: "${topic.topic_name}"`,
      `TOPIC OVERVIEW: "${topic.topic_context || topic.start_point || 'Core principles of ' + topic.topic_name}"`,
      '',
      'CRITICAL SOCRATIC TEACHING RULES:',
      '1. STRICTLY BITE-SIZED: Teach in small, digestible bits. Never dump long textbook text walls or multi-paragraph lectures. Target 80-120 words per response (max 150 words only if working through a calculation step).',
      '2. INTERACTIVE TEACHING LOOP: Teach ONE micro-step at a time, then ALWAYS end with 1 quick check question, challenge, or thought experiment to keep the student actively responding before moving forward.',
      '3. TYPOGRAPHIC HIERARCHY (Strictly Observe):',
      '   - Use ### Subheadings to organize sections or concept names.',
      '   - Use **bold** for crucial terms, definitions, and core rules.',
      '   - Use *italics* for emphasis, technical jargon, or variable names in text.',
      '   - Use concise bullet points (- ) when listing items.',
      '   - Format all math, equations, and variables with LaTeX ($...$ inline or $$...$$ block).',
      '4. PRACTICAL EXAMPLES: Use relatable Nigerian real-world scenarios when illustrating ideas (e.g. POS transactions, Danfo speeds, NEPA light vs. generator, market trade, boiling kettle/jollof rice).',
      '5. DIRECT RESPONSE: Provide your response directly without meta commentary, internal monologues, or emojis.',
    ].join('\n');

    // Build multi-turn history from previous messages (last 8 completed messages)
    const historyContents = messages
      .filter((m) => m.text && m.text.trim())
      .slice(-8)
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        parts: [{ text: m.text }],
      }));

    const latestUserParts: any[] = [...inlineParts];
    if (textToSend) {
      latestUserParts.push({ text: textToSend });
    } else if (latestUserParts.length === 0) {
      latestUserParts.push({ text: '(Student requested clarification on this topic)' });
    }

    historyContents.push({
      role: 'user',
      parts: latestUserParts,
    });

    const aiParams = {
      model: 'qwen/qwen3.7-flash',
      contents: historyContents,
      config: {
        systemInstruction: socraticSystemPrompt,
        temperature: 0.35,
        maxOutputTokens: 450,
      },
    };

    let streamedText = '';
    try {
      const responseStream = await ai.models.generateContentStream(aiParams);

      for await (const chunk of responseStream) {
        const chunkText = getResponseText(chunk);
        if (chunkText) {
          streamedText += chunkText;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText } : m))
          );
        }
      }
    } catch (streamErr: any) {
      console.warn('[CourseChatTutor] Stream failed or interrupted, falling back to generateContent:', streamErr);
      const fallbackResult = await attemptApiCall(async () => {
        const result = await ai.models.generateContent(aiParams);
        const resText = getResponseText(result);
        if (!resText) throw new Error('Course Tutor returned an empty response.');
        return resText;
      });

      if (fallbackResult.success && fallbackResult.data) {
        streamedText = fallbackResult.data.trim();
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText } : m))
        );
      } else {
        const errMsg = fallbackResult.message || streamErr?.message || 'Could not reach tutor server';
        streamedText = `I apologize, but I had trouble processing your question (${errMsg}). Please check your connection and send your question again.`;
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText } : m))
        );
      }
    }

    // Safety check: if stream ended with empty text (e.g. reasoning model consumed without content)
    if (!streamedText.trim()) {
      console.warn('[CourseChatTutor] Empty stream text, executing non-streaming fallback...');
      const fallbackResult = await attemptApiCall(async () => {
        const result = await ai.models.generateContent(aiParams);
        const resText = getResponseText(result);
        if (!resText) throw new Error('Course Tutor returned an empty response.');
        return resText;
      });

      if (fallbackResult.success && fallbackResult.data) {
        streamedText = fallbackResult.data.trim();
      } else {
        streamedText = `Let's take a look at ${topic.topic_name}. What specific concept or step would you like to explore next?`;
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText } : m))
      );
    }

    // Persist and deduct credits
    setMessages((prev) => {
      const final = prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText } : m));
      writeCachedJson(cacheKey, final, userProfile?.uid);
      return final;
    });

    if (streamedText.trim() && userProfile?.uid) {
      await deductAICredits(userProfile.uid, cost, 'Course Chat Tutor', appSettings).catch(console.warn);
    }

    setIsSending(false);
    setStreamingMsgId(null);
  };

  const handleSend = handleSendMessage;

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArr = Array.from(e.target.files);
      setAttachments((prev) => [...prev, ...filesArr]);
      setShowAttachmentMenu(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Helper to render streaming text with active trailing sentence glowing in deep blue
  const renderStreamingContent = (text: string) => {
    const lastPunctuationIdx = Math.max(
      text.lastIndexOf('\n'),
      text.lastIndexOf('. '),
      text.lastIndexOf('? '),
      text.lastIndexOf('! ')
    );

    if (lastPunctuationIdx !== -1 && lastPunctuationIdx < text.length - 1) {
      const completedPart = text.slice(0, lastPunctuationIdx + (text[lastPunctuationIdx] === '\n' ? 1 : 2));
      const activePart = text.slice(lastPunctuationIdx + (text[lastPunctuationIdx] === '\n' ? 1 : 2));

      return (
        <div className="space-y-1 font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em]">
          {completedPart && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents(false)}
            >
              {formatLatexMath(completedPart)}
            </ReactMarkdown>
          )}
          {activePart && (
            <div className="inline-block text-[#002D62] dark:text-[#60A5FA] font-medium tracking-normal animate-fade-in transition-all duration-300">
              <span>{activePart}</span>
              <span className="inline-block w-2 h-4 sm:w-2.5 sm:h-5 ml-1 bg-[#0066FF] rounded-xs animate-pulse align-middle" />
            </div>
          )}
        </div>
      );
    }

    const hasCompletedPart = text.length > 0;
    const completedPart = text;

    return (
      <div className="space-y-1 font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em]">
        {hasCompletedPart && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents(false)}
          >
            {formatLatexMath(completedPart)}
          </ReactMarkdown>
        )}
      </div>
    );
  };

  const markdownComponents = (isUser: boolean) => ({
    h1: ({ node, ...props }: any) => (
      <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-white mt-4 mb-2 tracking-tight" {...props} />
    ),
    h2: ({ node, ...props }: any) => (
      <h2 className="text-lg sm:text-xl font-bold text-[#0F172A] dark:text-white mt-3.5 mb-1.5 tracking-tight border-b border-[#E3E9F1] dark:border-slate-800 pb-1" {...props} />
    ),
    h3: ({ node, ...props }: any) => (
      <h3 className="text-base sm:text-lg font-semibold text-[#0066FF] dark:text-[#60A5FA] mt-3 mb-1" {...props} />
    ),
    h4: ({ node, ...props }: any) => (
      <h4 className="text-sm sm:text-base font-semibold text-[#0F172A] dark:text-white mt-2.5 mb-1" {...props} />
    ),
    p: ({ node, ...props }: any) => <p className="mb-3 last:mb-0 leading-[1.75]" {...props} />,
    strong: ({ node, ...props }: any) => (
      <strong className={isUser ? 'font-black text-white' : 'font-black text-[#0F172A] dark:text-white'} {...props} />
    ),
    em: ({ node, ...props }: any) => (
      <em className={isUser ? 'italic text-white/90' : 'italic text-[#334155] dark:text-slate-300'} {...props} />
    ),
    code: ({ node, inline, ...props }: any) =>
      inline ? (
        <code className={`px-1.5 py-0.5 rounded-md font-mono text-xs ${isUser ? 'bg-white/20 text-white' : 'bg-brand-50 dark:bg-brand-950/50 text-[#0066FF] dark:text-brand-300 border border-brand-100 dark:border-brand-900/50'}`} {...props} />
      ) : (
        <code className="block overflow-x-auto rounded-2xl bg-[#0F172A] dark:bg-[#0A0A0A] text-slate-100 p-4 text-xs font-mono my-2.5 border border-slate-700/60" {...props} />
      ),
    blockquote: ({ node, ...props }: any) => (
      <blockquote className={`border-l-4 p-3 rounded-r-xl my-2.5 text-xs sm:text-sm leading-relaxed ${isUser ? 'border-brand-300 bg-white/10 text-white' : 'border-[#0066FF] bg-brand-50/70 dark:bg-brand-950/40 text-slate-800 dark:text-slate-200'}`} {...props} />
    ),
    ul: ({ node, ...props }: any) => <ul className="mb-3 last:mb-0 list-disc pl-5 space-y-1.5 marker:text-[#0066FF] leading-[1.7]" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="mb-3 last:mb-0 list-decimal pl-5 space-y-1.5 marker:text-[#0066FF] font-medium leading-[1.7]" {...props} />,
    li: ({ node, ...props }: any) => <li className="leading-[1.75]" {...props} />,
    a: ({ node, ...props }: any) => <a className={`${isUser ? 'text-brand-200 underline' : 'text-[#0066FF] underline hover:text-[#002D62]'}`} target="_blank" rel="noopener noreferrer" {...props} />,
    table: ({ node, ...props }: any) => (
      <div className="w-full my-3.5 overflow-x-auto [scrollbar-width:thin] rounded-2xl border border-[#E3E9F1] dark:border-slate-800 shadow-2xs">
        <table className="min-w-full border-collapse text-xs sm:text-sm text-left" {...props} />
      </div>
    ),
    thead: ({ node, ...props }: any) => (
      <thead className="bg-[#F1F5F9] dark:bg-slate-800/90 text-[#002D62] dark:text-[#60A5FA] border-b border-[#E3E9F1] dark:border-slate-700 font-bold" {...props} />
    ),
    th: ({ node, ...props }: any) => (
      <th className="p-3 font-bold border-r last:border-r-0 border-[#E3E9F1] dark:border-slate-700 whitespace-nowrap" {...props} />
    ),
    td: ({ node, ...props }: any) => (
      <td className="p-3 border-t border-r last:border-r-0 border-[#E3E9F1] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200" {...props} />
    ),
  });

  return (
    <div className="w-full h-full flex flex-col bg-[#F6F6F3] dark:bg-[#0A0A0A] overflow-hidden select-none relative">
      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleFileSelection} multiple className="hidden" />
      <input type="file" ref={cameraInputRef} onChange={handleFileSelection} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={photoInputRef} onChange={handleFileSelection} accept="image/*" multiple className="hidden" />

      {/* ── Scrollable Messages Area (WhatsApp-Style Bottom-Up Layout) ── */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="max-w-4xl mx-auto w-full min-h-full flex flex-col justify-end py-3 sm:py-4 space-y-4">
          {messages.map((message) => {
            const isUser = message.sender === 'user';
            const isLongUserMsg = isUser && (message.text.length > 220 || (message.text.match(/\n/g) || []).length >= 4);
            const isExpanded = expandedUserMessageIds.has(message.id);
            const isCurrentlyStreaming = streamingMsgId === message.id;

            return (
              <div
                key={message.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} w-full animate-fade-in`}
              >
                {!isUser && (
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <div className="w-6 h-6 rounded-full bg-[#0066FF]/10 dark:bg-brand-900/40 flex items-center justify-center p-0.5 shrink-0 border border-[#0066FF]/20">
                      <img src="/logo_icon.png" alt="Avelut Tutor" className="w-full h-full object-contain" />
                    </div>
                    <span className="text-[12px] font-bold text-[#002D62] dark:text-[#60A5FA]">
                      Course Tutor
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {topic.topic_name}
                    </span>
                  </div>
                )}

                <div
                  className={`p-4 sm:p-5 rounded-2xl leading-relaxed text-sm ${
                    isUser
                      ? 'min-w-[33%] max-w-[85%] sm:max-w-[76%] rounded-3xl bg-[#002D62] text-white shadow-xs rounded-tr-none'
                      : 'w-full text-slate-800 dark:text-slate-100 bg-transparent px-1 sm:px-2 py-1'
                  }`}
                >
                  {/* User Attachments */}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mb-3">
                      {message.attachments.length === 1 && message.attachments[0].isImage ? (
                        <a
                          href={message.attachments[0].url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block overflow-hidden rounded-3xl border border-transparent bg-transparent transition-transform hover:scale-[1.01]"
                        >
                          <img
                            src={message.attachments[0].url}
                            alt={message.attachments[0].name}
                            className="max-h-64 sm:max-h-80 w-auto rounded-3xl object-cover border border-transparent shadow-xs"
                          />
                        </a>
                      ) : (
                        <div className={`grid gap-2 ${message.attachments.some(item => item.isImage) ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                          {message.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="overflow-hidden rounded-2xl border border-transparent bg-transparent text-slate-900 dark:text-white"
                            >
                              {att.isImage ? (
                                <img src={att.url} alt={att.name} className="max-h-56 w-full object-cover rounded-2xl border border-transparent" />
                              ) : (
                                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/10 dark:bg-black/20 border border-white/10">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-[10px] font-black uppercase text-white">
                                    DOC
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-white">{att.name}</p>
                                    <p className="text-[10px] uppercase tracking-[0.2em] opacity-70 text-brand-200">Open attachment</p>
                                  </div>
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {isUser ? (
                    <div>
                      <div className={`relative ${isLongUserMsg && !isExpanded ? 'max-h-[125px] overflow-hidden' : ''}`}>
                        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                        {isLongUserMsg && !isExpanded && (
                          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#002D62] via-[#002D62]/85 to-transparent pointer-events-none" />
                        )}
                      </div>

                      {isLongUserMsg && (
                        <div className="mt-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleUserMessageExpand(message.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 text-white rounded-full text-xs font-bold transition shadow-[0_3px_10px_rgba(0,0,0,0.3)] active:scale-95 cursor-pointer border border-white/25 backdrop-blur-xs"
                          >
                            <span>{isExpanded ? 'Show less' : 'Read full message'}</span>
                            <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-xs drop-shadow-md`}></i>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : !message.text ? (
                    <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-800 shadow-2xs w-fit animate-fade-in">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0066FF] animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0066FF] animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0066FF] animate-bounce" />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold text-[#64748B] dark:text-slate-400">
                        Course Tutor is preparing your lesson...
                      </span>
                    </div>
                  ) : isCurrentlyStreaming ? (
                    <div className="w-full font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em] font-normal text-[#24292F] dark:text-[#E2E8F0]">
                      {renderStreamingContent(message.text)}
                    </div>
                  ) : (
                    <div className="w-full font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em] font-normal text-[#24292F] dark:text-[#E2E8F0]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={markdownComponents(false)}
                      >
                        {formatLatexMath(message.text)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Fullscreen Bottom Input Bar (Bottom Nav is Hidden) ── */}
      <footer className="shrink-0 px-3 sm:px-6 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] bg-[#F6F6F3]/90 dark:bg-[#0A0A0A]/90 backdrop-blur-md z-20">
        <div className="max-w-4xl mx-auto w-full space-y-2">
          
          {/* Multi-Image Attachment Preview Chips */}
          {attachments.length > 0 && (
            <div className="w-full flex items-center gap-2 overflow-x-auto py-1 px-1 no-scrollbar animate-fade-in">
              {attachments.map((file, idx) => {
                const isImg = file.type.startsWith('image/');
                return (
                  <div
                    key={`${file.name}-${idx}`}
                    className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-[#111111] border border-transparent shadow-xs px-3 py-1 text-xs text-slate-800 dark:text-slate-200 shrink-0"
                  >
                    {isImg ? (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-5 h-5 rounded-full object-cover shrink-0 border border-transparent"
                      />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center text-[10px] font-bold shrink-0">
                        DOC
                      </span>
                    )}
                    <span className="max-w-[120px] truncate font-medium text-[11px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="text-slate-400 hover:text-rose-500 transition-colors p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                      title="Remove attachment"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fluid Spring Morphing Pill Container (From Avelut AI) */}
          <div className="relative w-full bg-white dark:bg-[#111111] rounded-full flex items-center justify-between pl-3 pr-2 py-1.5 min-h-[54px] sm:min-h-[56px] border border-[#E3E9F1] dark:border-slate-800 shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
            
            {/* Left: Plus Menu Button */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                disabled={isSending}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-40 cursor-pointer ${showAttachmentMenu ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                title="Add photo or document"
              >
                <PlusIcon />
              </button>

              {/* Plus Popup Menu */}
              {showAttachmentMenu && (
                <div className="absolute bottom-14 left-0 w-56 bg-white/95 dark:bg-[#111111]/95 backdrop-blur-xl border border-[#E3E9F1] dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 z-50 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      cameraInputRef.current?.click();
                      setShowAttachmentMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <CameraOutlineIcon className="w-5 h-5 text-slate-700 dark:text-slate-200" />
                    <span>Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      photoInputRef.current?.click();
                      setShowAttachmentMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <PhotoOutlineIcon className="w-5 h-5 text-slate-700 dark:text-slate-200" />
                    <span>Photos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setShowAttachmentMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <FolderOutlineIcon className="w-5 h-5 text-slate-700 dark:text-slate-200" />
                    <span>Files</span>
                  </button>
                </div>
              )}
            </div>

            {/* Center: Auto-Expanding Textarea */}
            <div className="flex-1 mx-2 relative flex items-center min-h-[40px]">
              <textarea
                ref={inputElementRef}
                rows={1}
                value={inputValue}
                onChange={handleTextChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Ask about ${topic.topic_name}...`}
                className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-[15px] sm:text-[16px] font-normal leading-relaxed focus:outline-none resize-none py-2 px-1 max-h-[140px] overflow-y-auto"
                style={{ height: 'auto' }}
              />
            </div>

            {/* Right: Send Button */}
            <button
              onClick={() => void handleSend()}
              disabled={(!inputValue.trim() && attachments.length === 0) || isSending}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#0066FF] hover:bg-[#0052cc] disabled:opacity-30 text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Send message"
            >
              <i className="bi bi-arrow-up text-sm sm:text-base font-bold"></i>
            </button>
          </div>
        </div>
      </footer>

      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={limitCost}
        balance={userProfile?.ai_credits_balance ?? 0}
        addToast={addToast}
      />
    </div>
  );
};

export default CourseChatTutor;
