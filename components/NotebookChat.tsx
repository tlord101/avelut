import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { formatLatexMath } from '../utils/latexFormatter';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../utils/usage';
import { getChapterGeneration, saveChapterGeneration, deleteChapterGeneration, getChapterContent } from '../services/notebookStorageService';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import type { UserProfile } from '../types';
import type { Notebook, NotebookChapter } from '../services/notebookStorageService';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface NotebookChatProps {
  notebook: Notebook;
  chapter: NotebookChapter;
  chapterContent: string;
  userProfile: UserProfile;
  onBack: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

export const NotebookChat: React.FC<NotebookChatProps> = ({
  notebook,
  chapter,
  chapterContent,
  userProfile,
  onBack,
  setCustomHeaderConfig,
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();

  const [activeContent, setActiveContent] = useState<string>(chapterContent || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitCost, setLimitCost] = useState(1);

  // Self-load chapter content if missing or passed empty due to race condition
  useEffect(() => {
    if (chapterContent && chapterContent.trim().length > 0) {
      setActiveContent(chapterContent);
    } else {
      getChapterContent(notebook.id, chapter.id, { startPage: chapter.startPage, endPage: chapter.endPage })
        .then((content) => {
          if (content && content.trim().length > 0) {
            setActiveContent(content);
          }
        })
        .catch((err) => console.warn('[NotebookChat] Error loading chapter content:', err));
    }
  }, [notebook.id, chapter.id, chapter.startPage, chapter.endPage, chapterContent]);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleMessageExpand = (id: string) => {
    setExpandedMessageIds((prev) => {
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

  // Restore saved chapter conversation thread from SQLite on mount
  useEffect(() => {
    let isMounted = true;
    getChapterGeneration<ChatMessage[]>(notebook.id, chapter.id, 'chat')
      .then((saved) => {
        if (isMounted && saved && Array.isArray(saved) && saved.length > 0) {
          setMessages(saved);
          setTimeout(() => scrollToBottom('instant' as ScrollBehavior), 30);
        }
      })
      .catch((err) => console.warn('[NotebookChat] Error restoring chat history:', err));
    return () => {
      isMounted = false;
    };
  }, [notebook.id, chapter.id, scrollToBottom]);

  // Keep scrolled to bottom during live streaming or on new messages
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom('smooth');
    }
  }, [messages, isLoading, scrollToBottom]);

  const handleClearHistory = useCallback(async () => {
    if (window.confirm('Clear conversation history for this chapter?')) {
      setMessages([]);
      await deleteChapterGeneration(notebook.id, chapter.id, 'chat');
      addToast('Conversation history cleared.', 'info');
    }
  }, [notebook.id, chapter.id, addToast]);

  // ── Configure Main App Header for Notebook Chat ──
  useEffect(() => {
    if (setCustomHeaderConfig) {
      setCustomHeaderConfig({
        hideBottomNav: true,
        leftActions: (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[calc(100vw-110px)] sm:max-w-none">
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-full bg-white dark:bg-[#141414] hover:bg-slate-50 dark:hover:bg-[#1C1C1C] border border-[#E3E9F1] dark:border-[#2A2A2A] flex items-center justify-center text-[#0F172A] dark:text-white transition-all cursor-pointer shrink-0 shadow-2xs active:scale-95"
              aria-label="Back to chapters"
              title="Back"
            >
              <i className="bi bi-arrow-left text-base font-bold text-[#2563EB] dark:text-[#3B82F6]"></i>
            </button>
            <div className="min-w-0 flex flex-col justify-center">
              <span className="text-[10px] font-bold text-[#64748B] dark:text-[#A3A3A3] uppercase tracking-wider block truncate">
                {notebook.title}
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate max-w-[140px] sm:max-w-[280px] md:max-w-[400px]">
                {chapter.title}
              </h2>
            </div>
          </div>
        ),
        rightActions: messages.length > 0 ? (
          <button
            type="button"
            onClick={handleClearHistory}
            className="w-9 h-9 rounded-xl bg-white dark:bg-[#141414] hover:bg-[#F3F3F3] dark:hover:bg-[#1C1C1C] border border-[#E3E9F1] dark:border-[#2A2A2A] hover:border-[#D0D0D0] dark:hover:border-[#3A3A3A] flex items-center justify-center text-[#64748B] dark:text-[#A3A3A3] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA] transition-all cursor-pointer shadow-2xs"
            title="Clear Conversation History"
            aria-label="Clear Conversation History"
          >
            <i className="bi bi-trash text-sm"></i>
          </button>
        ) : null,
        className: 'bg-[#F6F6F3]/95 dark:bg-[#141414]/95 border-b border-[#E3E9F1] dark:border-[#2A2A2A] backdrop-blur-md',
      });
    }

    return () => {
      if (setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [setCustomHeaderConfig, onBack, notebook.title, chapter.title, messages.length, handleClearHistory]);

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || inputText).trim();
    if (!messageText || isLoading) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitModal(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text: messageText,
      timestamp: Date.now(),
    };

    const nextMessagesWithUser = [...messages, userMsg];
    setMessages(nextMessagesWithUser);
    setInputText('');
    setIsLoading(true);

    try {
      const ai = createAvelutAI(appSettings, userProfile, {
        endpointPreference: 'openai_compatible_first',
        feature: 'study_guide_chat',
      });
      if (!ai) throw new Error('AI is not configured. Please check App Controls.');

      let excerptToUse = (activeContent || chapterContent || '').trim();
      if (!excerptToUse) {
        try {
          excerptToUse = await getChapterContent(notebook.id, chapter.id, {
            startPage: chapter.startPage,
            endPage: chapter.endPage,
          });
          if (excerptToUse) setActiveContent(excerptToUse);
        } catch {}
      }

      const isGroundingAvailable = excerptToUse.length > 0;

      const prompt = `You are an expert, precise, and encouraging academic tutor helping a student understand their textbook material: "${chapter.title}" from "${notebook.title}".

CRITICAL TUTORING & BITE-SIZED TEACHING RULES:
1. STRICTLY BITE-SIZED: Keep explanations brief, clear, and digestible (target 80-120 words per response). Do NOT dump long textbook passages or multi-page walls of text. Teach in bits.
2. INTERACTIVE TEACHING LOOP: Teach ONE key idea or micro-concept at a time. ALWAYS conclude your response with 1 quick check question, challenge, or thought prompt to test the student's understanding before proceeding.
3. TYPOGRAPHIC HIERARCHY (Strictly Observe):
   - Use ### Subheadings for the concept or section title.
   - Use **bold** for key concepts, essential definitions, and core principles.
   - Use *italics* for emphasis or specialized terminology.
   - Use clean bullet points (- ) when listing 2-3 points.
   - Format all math, formulas, and variables using LaTeX ($...$ inline or $$...$$ block).
${isGroundingAvailable
  ? `4. TEXTBOOK GROUNDING: Base your explanations, definitions, and examples strictly on the TEXTBOOK EXCERPT below. Stick closely to the author's terms, equations, and notations.`
  : `4. ACADEMIC PRINCIPLES: Explain the core concepts of "${chapter.title}" accurately and step-by-step.`
}
5. GREETINGS: If the student sends a casual greeting (like "hi" or "hello"), reply warmly and concisely (e.g. "Hello! What concept in ${chapter.title} would you like to master today?").

BOOK: ${notebook.title}
CHAPTER: ${chapter.title}
PAGES: ${chapter.startPage} to ${chapter.endPage}

${isGroundingAvailable ? `TEXTBOOK EXCERPT (EXTRACTED FROM PAGES ${chapter.startPage}-${chapter.endPage}):\n${excerptToUse.slice(0, 14000)}` : `(No raw text excerpt available for this chapter)`}

CONVERSATION HISTORY:
${nextMessagesWithUser.slice(-6).map((m) => `${m.sender === 'user' ? 'Student' : 'Tutor'}: ${m.text}`).join('\n')}

STUDENT'S QUESTION:
${messageText}`;

      const assistantMsgId = `msg_ai_${Date.now()}`;
      setStreamingMsgId(assistantMsgId);

      // Initialize empty assistant bubble for live streaming
      setMessages([...nextMessagesWithUser, {
        id: assistantMsgId,
        sender: 'assistant',
        text: '',
        timestamp: Date.now(),
      }]);

      const responseStream = await ai.models.generateContentStream({
        model: 'qwen/qwen3.7-flash',
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 450,
        },
      });

      let streamedText = '';
      for await (const chunk of responseStream) {
        const chunkText = getResponseText(chunk);
        streamedText += chunkText;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, text: streamedText } : m))
        );
      }

      const finalMessages = [
        ...nextMessagesWithUser,
        {
          id: assistantMsgId,
          sender: 'assistant' as const,
          text: streamedText || 'I could not generate an explanation for that. Please rephrase your question.',
          timestamp: Date.now(),
        },
      ];

      // Persist full thread to SQLite
      await saveChapterGeneration(notebook.id, chapter.id, userProfile?.uid || 'local', 'chat', finalMessages);
      void deductAICredits(userProfile?.uid, cost, 'Notebook Chat Tutor', appSettings);
    } catch (err) {
      console.error('Notebook chat error:', err);
      addToast('Failed to get answer. Please check your connection.', 'error');
    } finally {
      setIsLoading(false);
      setStreamingMsgId(null);
    }
  };

  const suggestionPills = [
    'Explain the main concept simply',
    'Summarize key takeaways from this chapter',
    'Give me a practical example',
    'Quiz me on this chapter',
  ];

  // Helper to render streaming text
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
        <div className="space-y-1">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents(false)}
          >
            {formatLatexMath(completedPart)}
          </ReactMarkdown>
          {activePart && (
            <div className="inline-block text-[#0F172A] dark:text-brand-300 font-semibold text-[17px] sm:text-[18px] tracking-normal animate-fade-in transition-all duration-300">
              <span>{activePart}</span>
              <span className="inline-block w-2 h-4 ml-1 bg-[#0066FF] rounded-xs animate-pulse align-middle" />
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="inline-block text-[#0F172A] dark:text-brand-300 font-semibold text-[17px] sm:text-[18px] tracking-normal animate-fade-in transition-all duration-300">
        <span>{text}</span>
        <span className="inline-block w-2 h-4 ml-1 bg-[#0066FF] rounded-xs animate-pulse align-middle" />
      </div>
    );
  };

  const markdownComponents = (isUser: boolean) => ({
    h1: ({ node, ...props }: any) => (
      <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] dark:text-white mt-5 mb-3 tracking-tight" {...props} />
    ),
    h2: ({ node, ...props }: any) => (
      <h2 className="text-xl sm:text-2xl font-bold text-[#0F172A] dark:text-white mt-4 mb-2 tracking-tight border-b border-[#E3E9F1] dark:border-[#2A2A2A] pb-1.5" {...props} />
    ),
    h3: ({ node, ...props }: any) => (
      <h3 className="text-lg sm:text-xl font-bold text-[#0F172A] dark:text-[#3B82F6] mt-3.5 mb-1.5" {...props} />
    ),
    h4: ({ node, ...props }: any) => (
      <h4 className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-white mt-3 mb-1" {...props} />
    ),
    p: ({ node, ...props }: any) => <p className="mb-4 last:mb-0 text-[17px] sm:text-[18px] leading-relaxed text-[#0F172A] dark:text-slate-100" {...props} />,
    strong: ({ node, ...props }: any) => (
      <strong className={isUser ? 'font-black text-white' : 'font-black text-[#0F172A] dark:text-white'} {...props} />
    ),
    em: ({ node, ...props }: any) => (
      <em className={isUser ? 'italic text-white/90' : 'italic text-[#334155] dark:text-[#A3A3A3]'} {...props} />
    ),
    code: ({ node, inline, ...props }: any) =>
      inline ? (
        <code className={`px-1.5 py-0.5 rounded font-mono text-sm ${isUser ? 'bg-white/20 text-white' : 'bg-neutral-100 dark:bg-[#1C1C1C] text-[#2563EB] dark:text-[#3B82F6] border border-neutral-200 dark:border-[#2A2A2A]'}`} {...props} />
      ) : (
        <code className="block overflow-x-auto rounded-2xl bg-[#0A0A0A] dark:bg-[#141414] text-slate-100 p-4 text-sm font-mono my-3 border border-[#2A2A2A]" {...props} />
      ),
    blockquote: ({ node, ...props }: any) => (
      <blockquote className={`border-l-4 p-3.5 rounded-r-xl my-3 text-base sm:text-[17px] leading-relaxed ${isUser ? 'border-[#3B82F6] bg-white/10 text-white' : 'border-[#2563EB] dark:border-[#3B82F6] bg-neutral-100 dark:bg-[#1C1C1C] text-slate-800 dark:text-slate-200'}`} {...props} />
    ),
    ul: ({ node, ...props }: any) => <ul className="mb-4 last:mb-0 list-disc pl-5 space-y-2 text-[17px] sm:text-[18px] marker:text-[#2563EB] dark:marker:text-[#3B82F6] text-[#0F172A] dark:text-slate-100" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="mb-4 last:mb-0 list-decimal pl-5 space-y-2 text-[17px] sm:text-[18px] marker:text-[#2563EB] dark:marker:text-[#3B82F6] text-[#0F172A] dark:text-slate-100 font-medium" {...props} />,
    li: ({ node, ...props }: any) => <li className="leading-relaxed" {...props} />,
    a: ({ node, ...props }: any) => <a className={`${isUser ? 'text-blue-200 underline' : 'text-[#2563EB] dark:text-[#3B82F6] underline hover:text-[#1D4ED8]'}`} target="_blank" rel="noopener noreferrer" {...props} />,
  });

  return (
    <div className="flex-1 w-full h-full min-h-0 flex flex-col overflow-hidden bg-[#F6F6F3] dark:bg-[#0A0A0A] animate-fade-in">
      {/* Scrollable Messages Area — WhatsApp-style bottom upwards loading */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 scroll-smooth"
      >
        <div className="max-w-4xl mx-auto w-full min-h-full flex flex-col justify-end py-3 sm:py-4">
          {messages.length === 0 ? (
            <div className="my-auto flex flex-col items-center justify-center text-center p-6 sm:p-8 bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl shadow-xs">
              <div className="w-14 h-14 rounded-2xl bg-[#2563EB]/10 dark:bg-[#3B82F6]/20 text-[#2563EB] dark:text-[#3B82F6] flex items-center justify-center text-2xl mb-3.5 shadow-2xs">
                <i className="bi bi-chat-heart-fill"></i>
              </div>
              <h3 className="text-lg font-bold text-[#0F172A] dark:text-white">Socratic Tutor for {chapter.title}</h3>
              <p className="text-sm text-[#64748B] dark:text-[#A3A3A3] max-w-md mt-1 mb-4 leading-relaxed">
                Ask any question, clarify a tricky concept, or get step-by-step worked examples directly from your material.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                {suggestionPills.map((pill, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(pill)}
                    className="px-4 py-2 rounded-full bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-[#E6E6E6] dark:hover:bg-[#2A2A2A] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-slate-200 hover:text-[#2563EB] dark:hover:text-[#3B82F6] text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    <span className="text-[#2563EB] dark:text-[#3B82F6]">✦</span>
                    <span>{pill}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full space-y-4">
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                const isCurrentlyStreaming = msg.id === streamingMsgId && isLoading;
                const isLongUserMsg = isUser && (msg.text.length > 220 || (msg.text.match(/\n/g) || []).length >= 4);
                const isExpanded = expandedMessageIds.has(msg.id);

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} w-full animate-fade-in`}
                  >
                    <div
                      className={`leading-relaxed text-[17px] sm:text-[18px] relative ${
                        isUser
                          ? 'p-4 sm:p-5 min-w-[33%] max-w-[85%] sm:max-w-[75%] bg-[#0F172A] text-white shadow-xs rounded-2xl rounded-tr-none text-base'
                          : 'w-full bg-transparent font-reading text-[15.5px] sm:text-[16.5px] leading-[1.75] tracking-[-0.011em] font-normal text-[#24292F] dark:text-[#E2E8F0] border-0 shadow-none px-1 py-2'
                      }`}
                    >
                      {isUser ? (
                        <div>
                          <div className={`relative ${isLongUserMsg && !isExpanded ? 'max-h-[125px] overflow-hidden' : ''}`}>
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>

                            {/* Fade Shadow Gradient for Long User Sent Messages */}
                            {isLongUserMsg && !isExpanded && (
                              <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/85 to-transparent pointer-events-none" />
                            )}
                          </div>

                          {/* 3D Arrow Down Expand / Collapse Button */}
                          {isLongUserMsg && (
                            <div className="mt-2 flex justify-center">
                              <button
                                type="button"
                                onClick={() => toggleMessageExpand(msg.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 text-white rounded-full text-xs font-bold transition shadow-[0_3px_10px_rgba(0,0,0,0.3)] active:scale-95 cursor-pointer border border-white/25 backdrop-blur-xs"
                              >
                                <span>{isExpanded ? 'Show less' : 'Read full message'}</span>
                                <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-xs drop-shadow-md`}></i>
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isCurrentlyStreaming ? (
                        renderStreamingContent(msg.text)
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={markdownComponents(false)}
                        >
                          {formatLatexMath(msg.text)}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && !streamingMsgId && (
                <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#141414] rounded-2xl border border-[#E3E9F1] dark:border-[#2A2A2A] shadow-2xs w-fit animate-fade-in">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] dark:bg-[#3B82F6] animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] dark:bg-[#3B82F6] animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] dark:bg-[#3B82F6] animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom: Suggestions + Input — floats above bottom nav */}
      <div className="shrink-0 px-3 sm:px-5 pt-2 pb-[calc(76px+env(safe-area-inset-bottom)+8px)]">
        <div className="max-w-4xl mx-auto w-full space-y-2">
          {/* Suggestion Pills */}
          {messages.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
              {suggestionPills.map((pill, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(pill)}
                  className="px-3.5 py-1.5 rounded-full bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] hover:border-[#2563EB] dark:hover:border-[#3B82F6] text-[#0F172A] dark:text-slate-200 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer shadow-2xs shrink-0"
                >
                  <i className="bi bi-sparkles mr-1 text-[#2563EB] dark:text-[#3B82F6]"></i>
                  {pill}
                </button>
              ))}
            </div>
          )}

          {/* Input Form */}
          <div className="bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-2xl p-1.5 sm:p-2 flex items-center gap-2 shadow-2xs">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder="Ask a question about this chapter..."
              className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-transparent text-sm text-[#0F172A] dark:text-white placeholder:text-[#64748B] dark:placeholder:text-[#737373] focus:outline-none"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim() || isLoading}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] dark:bg-[#3B82F6] dark:hover:bg-[#60A5FA] disabled:opacity-40 text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
              aria-label="Send message"
            >
              <i className="bi bi-send-fill text-sm"></i>
            </button>
          </div>
        </div>
      </div>

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

export default NotebookChat;
