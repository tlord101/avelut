import { MarkdownContent } from './MarkdownContent';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAvelutAI, getResponseText, getResponseReasoningText } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../utils/usage';
import { getChapterGeneration, saveChapterGeneration, deleteChapterGeneration, getChapterContent } from '../services/notebookStorageService';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { ThinkingTypingIndicator } from './ThinkingTypingIndicator';
import { ChatLimitBanner } from './ChatLimitBanner';
import {
  getOrGenerateTopicStructure,
  saveTopicStructureProgress,
  TopicStructureData,
} from '../services/topicStructureService';
import type { UserProfile } from '../types';
import type { Notebook, NotebookChapter } from '../services/notebookStorageService';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  reasoningText?: string;
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
  const [showLimitBanner, setShowLimitBanner] = useState(false);
  const [limitCost, setLimitCost] = useState(1);
  const [chapterStructure, setChapterStructure] = useState<TopicStructureData | null>(null);

  // Load or generate chapter structure JSON stored on device
  useEffect(() => {
    let isMounted = true;
    getOrGenerateTopicStructure({
      topicKey: `nb_${notebook.id}_ch_${chapter.id}`,
      topicTitle: chapter.title,
      courseTitle: notebook.title,
      context: activeContent.slice(0, 500),
      userProfile,
      appSettings,
    }).then((struct) => {
      if (isMounted && struct) {
        setChapterStructure(struct);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [notebook.id, chapter.id, chapter.title, notebook.title, activeContent, userProfile, appSettings]);

  // Self-load chapter content if missing
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
      const activeStepNumber = (chapterStructure?.currentStepIndex ?? 0) + 1;
      const totalSteps = chapterStructure?.steps?.length || 4;

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
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#64748B] dark:text-[#A3A3A3] uppercase tracking-wider block truncate">
                  {notebook.title}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-[#2563EB]/10 dark:bg-[#3B82F6]/20 text-[#2563EB] dark:text-[#3B82F6] text-[9px] font-extrabold border border-[#2563EB]/20">
                  Step {activeStepNumber}/{totalSteps}
                </span>
              </div>
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
  }, [setCustomHeaderConfig, onBack, notebook.title, chapter.title, messages.length, handleClearHistory, chapterStructure]);

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || inputText).trim();
    if (!messageText || isLoading) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitBanner(true);
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

    // Track and advance chapter structure step progress
    let currentStepIdx = chapterStructure?.currentStepIndex || 0;
    const totalSteps = chapterStructure?.steps?.length || 4;
    const userMsgCount = messages.filter((m) => m.sender === 'user').length;

    if (userMsgCount > 0 && userMsgCount % 2 === 0 && currentStepIdx < totalSteps - 1) {
      currentStepIdx = currentStepIdx + 1;
      if (chapterStructure) {
        const updatedStruct = { ...chapterStructure, currentStepIndex: currentStepIdx };
        setChapterStructure(updatedStruct);
        saveTopicStructureProgress(updatedStruct, userProfile?.uid);
      }
    }

    const activeStep = chapterStructure?.steps?.[currentStepIdx] || {
      title: 'Chapter Step',
      objective: `Master ${chapter.title}`,
      keyConcepts: ['Core principles'],
    };

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

      // Extract a focused segment corresponding to the active step rather than sending 14k raw characters
      let focusedExcerpt = '';
      if (isGroundingAvailable) {
        const stepOffset = Math.floor((currentStepIdx / Math.max(1, totalSteps)) * excerptToUse.length);
        const rawSlice = excerptToUse.slice(stepOffset, stepOffset + 2200);
        focusedExcerpt = rawSlice.trim() || excerptToUse.slice(0, 2200);
      }

      const prompt = `You are an expert, precise, and encouraging academic tutor helping a student understand their textbook material: "${chapter.title}" from "${notebook.title}".

CURRENT STRUCTURED CHAPTER STEP ${currentStepIdx + 1} OF ${totalSteps}: "${activeStep.title}"
STEP OBJECTIVE: "${activeStep.objective}"
KEY CONCEPTS: ${activeStep.keyConcepts?.join(', ') || 'Core concepts'}

CRITICAL TUTORING & PROGRESSIVE TEACHING RULES:
1. PROGRESSIVE IN-DEPTH TEACHING: You are guiding the student through STEP ${currentStepIdx + 1} OF ${totalSteps}: "${activeStep.title}". Teach this step thoroughly and in depth, focusing on "${activeStep.objective}".
2. STRICTLY BITE-SIZED: Keep explanations brief, clear, and digestible (target 90-130 words per turn). Teach ONE micro-concept at a time.
3. INTERACTIVE TEACHING LOOP: Conclude your response with 1 quick check question or thought prompt before proceeding to verify understanding.
4. TYPOGRAPHIC HIERARCHY:
   - Use ### Subheadings for section titles.
   - Use **bold** for key concepts and essential definitions.
   - Format all math, formulas, and variables using LaTeX ($...$ inline or $$...$$ block).
${isGroundingAvailable
  ? `5. TEXTBOOK GROUNDING: Base your explanations and definitions on the focused step excerpt below.`
  : `5. ACADEMIC PRINCIPLES: Explain the core concepts of "${chapter.title}" accurately.`
}
6. GREETINGS: Reply warmly and concisely to greetings.

BOOK: ${notebook.title}
CHAPTER: ${chapter.title} (Pages ${chapter.startPage}-${chapter.endPage})

${isGroundingAvailable ? `RELEVANT CHAPTER EXCERPT (STEP ${currentStepIdx + 1}):\n${focusedExcerpt}` : `(Grounding from curriculum)`}

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
        reasoningText: '',
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
      let streamedReasoning = '';
      for await (const chunk of responseStream) {
        const chunkText = getResponseText(chunk);
        const chunkReasoning = getResponseReasoningText(chunk);
        if (chunkReasoning) {
          streamedReasoning += chunkReasoning;
        }
        if (chunkText) {
          streamedText += chunkText;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, text: streamedText, reasoningText: streamedReasoning }
              : m
          )
        );
      }

      const finalMessages = [
        ...nextMessagesWithUser,
        {
          id: assistantMsgId,
          sender: 'assistant' as const,
          text: streamedText || 'I could not generate an explanation for that. Please rephrase your question.',
          reasoningText: streamedReasoning,
          timestamp: Date.now(),
        },
      ];

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

  const renderStreamingContent = (text: string) => (
    <div className="min-w-0">
      <MarkdownContent content={text} />
      <span aria-hidden="true" className="inline-block w-2 h-4 ml-1 bg-blue-600 dark:bg-blue-400 rounded-sm animate-pulse align-middle" />
    </div>
  );
  return (
    <div className="flex-1 w-full h-full min-h-0 flex flex-col overflow-hidden bg-[#F6F6F3] dark:bg-[#0A0A0A] animate-fade-in">
      {/* Scrollable Messages Area */}
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

                            {isLongUserMsg && !isExpanded && (
                              <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/85 to-transparent pointer-events-none" />
                            )}
                          </div>

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
                      ) : !msg.text ? (
                        <ThinkingTypingIndicator
                          label="thinking"
                          reasoningText={msg.reasoningText}
                          isStreaming={isCurrentlyStreaming}
                        />
                      ) : (
                        <>
                          {msg.reasoningText && (
                            <div className="mb-2">
                              <ThinkingTypingIndicator
                                label="thought process"
                                reasoningText={msg.reasoningText}
                                defaultExpanded={false}
                                isStreaming={false}
                              />
                            </div>
                          )}
                          {isCurrentlyStreaming ? (
                            renderStreamingContent(msg.text)
                          ) : (
                            <MarkdownContent content={msg.text} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && !streamingMsgId && (
                <ThinkingTypingIndicator label="thinking" />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Input */}
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

          {/* LIMIT REACHED BANNER */}
          {showLimitBanner && (
            <div className="w-full pb-1">
              <ChatLimitBanner
                title="Free tier limit reached"
                subtitle="Try again later or upgrade to Pro for much higher limits and premium features."
                actionText="Upgrade to Pro"
              />
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
