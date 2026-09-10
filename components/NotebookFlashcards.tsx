import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { formatLatexMath } from '../utils/latexFormatter';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../utils/usage';
import { getChapterGeneration, saveChapterGeneration, getChapterContent } from '../services/notebookStorageService';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import type { UserProfile } from '../types';
import type { Notebook, NotebookChapter } from '../services/notebookStorageService';

interface FlashcardItem {
  id: number;
  front: string;
  back: string;
  hint?: string;
}

interface NotebookFlashcardsProps {
  notebook: Notebook;
  chapter: NotebookChapter;
  chapterContent: string;
  userProfile: UserProfile;
  onBack: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

export const NotebookFlashcards: React.FC<NotebookFlashcardsProps> = ({
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
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitCost, setLimitCost] = useState(1);

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
        .catch((err) => console.warn('[NotebookFlashcards] Error loading chapter content:', err));
    }
  }, [notebook.id, chapter.id, chapter.startPage, chapter.endPage, chapterContent]);

  // ── Configure Main App Header for Flashcards ──
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
              <i className="bi bi-arrow-left text-base font-bold text-[#0066FF] dark:text-blue-400"></i>
            </button>
            <div className="min-w-0 flex flex-col justify-center">
              <span className="text-[10px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider block truncate">
                {notebook.title}
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate max-w-[140px] sm:max-w-[280px] md:max-w-[400px]">
                {chapter.title} — Flashcards
              </h2>
            </div>
          </div>
        ),
        rightActions: (
          <button
            type="button"
            onClick={() => void generateCards(true)}
            className="w-9 h-9 rounded-xl bg-white dark:bg-[#141414] hover:bg-slate-50 dark:hover:bg-[#1C1C1C] border border-[#E3E9F1] dark:border-[#2A2A2A] flex items-center justify-center text-[#64748B] dark:text-[#A3A3A3] hover:text-[#2563EB] dark:hover:text-[#3B82F6] transition-all cursor-pointer shadow-2xs"
            title="Regenerate Flashcards"
            aria-label="Regenerate Flashcards"
          >
            <i className="bi bi-arrow-clockwise text-sm"></i>
          </button>
        ),
        className: 'bg-[#F6F6F3]/95 dark:bg-[#141414]/95 border-b border-[#E3E9F1] dark:border-[#2A2A2A] backdrop-blur-md',
      });
    }

    return () => {
      if (setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [setCustomHeaderConfig, onBack, notebook.title, chapter.title]);

  const generateCards = async (forceRegenerate = false) => {
    // 1. Check local SQLite cache first if not explicitly regenerating
    if (!forceRegenerate) {
      try {
        const saved = await getChapterGeneration<FlashcardItem[]>(notebook.id, chapter.id, 'flashcards');
        if (saved && Array.isArray(saved) && saved.length > 0) {
          setCards(saved);
          setIsGenerating(false);
          return;
        }
      } catch (err) {
        console.warn('[Flashcards] Cache check error:', err);
      }
    }

    const cost = getFeatureCost('flashcard_generation', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitModal(true);
      setIsGenerating(false);
      return;
    }

    setIsGenerating(true);

    try {
      const ai = createAvelutAI(appSettings, userProfile);
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

      const prompt = `You are a master educator creating high-retention flashcards.
Based strictly on the following textbook chapter excerpt, generate exactly 10 high-value flashcards covering key definitions, formulas, concepts, and principles.

CHAPTER: ${chapter.title}
BOOK: ${notebook.title}
CONTENT (PAGES ${chapter.startPage}-${chapter.endPage}):
${excerptToUse ? excerptToUse.slice(0, 16000) : `Topic: ${chapter.title} from ${notebook.title}`}

RULES:
1. "front": Clear prompt, concept query, or equation setup.
2. "back": Concise, precise explanation or breakdown with LaTeX ($...$).
3. "hint": Short memory anchor or mnemonic.
4. Output strictly valid JSON array:
[
  {
    "id": 1,
    "front": "Front question/concept in LaTeX",
    "back": "Back concise definition/solution in LaTeX",
    "hint": "Brief memory clue"
  }
]`;

      const response = await ai.models.generateContent({
        model: 'qwen/qwen3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = getResponseText(response);
      const parsed = JSON.parse(responseText.replace(/```(?:json)?/gi, '').trim());

      if (Array.isArray(parsed) && parsed.length > 0) {
        setCards(parsed);
        setCurrentIndex(0);
        setIsFlipped(false);
        setShowHint(false);
        // Persist to local SQLite for 0ms instant loads on subsequent visits
        await saveChapterGeneration(notebook.id, chapter.id, userProfile?.uid || 'local', 'flashcards', parsed);
        void deductAICredits(userProfile?.uid, cost, 'Notebook Flashcard Generation');
        addToast(forceRegenerate ? 'New flashcards generated!' : 'Flashcards ready!', 'success');
      } else {
        throw new Error('Invalid flashcards format received');
      }
    } catch (err) {
      console.error('Flashcard error:', err);
      addToast('Failed to generate flashcards. Please retry.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    void generateCards(false);
  }, [notebook.id, chapter.id]);

  if (isGenerating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in max-w-md mx-auto my-auto">
        <div className="w-14 h-14 rounded-full border-3 border-[#E3E9F1] dark:border-[#2A2A2A] border-t-[#2563EB] dark:border-t-[#3B82F6] animate-spin mb-4" />
        <h3 className="text-lg font-black text-[#0F172A] dark:text-white tracking-tight">
          Generating Flashcards...
        </h3>
        <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1 leading-relaxed">
          Distilling essential concepts from "{chapter.title}".
        </p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in max-w-md mx-auto my-auto space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] flex items-center justify-center text-[#2563EB] dark:text-[#3B82F6] text-2xl shadow-xs">
          <i className="bi bi-card-text"></i>
        </div>
        <h3 className="text-base font-black text-[#0F172A] dark:text-white">No Flashcards Yet</h3>
        <p className="text-xs text-[#64748B] dark:text-slate-400">Could not extract or generate flashcards for this chapter.</p>
        <button
          onClick={() => void generateCards()}
          className="px-5 py-2.5 bg-[#0066FF] hover:bg-[#0052cc] text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
        >
          Try Generating Again
        </button>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  return (
    <div className="flex-1 w-full max-w-2xl mx-auto p-3 sm:p-5 flex flex-col h-full min-h-0 justify-between overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom)+14px)] animate-fade-in">
      {/* Flashcard Progress Badge */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs font-bold text-[#64748B] dark:text-slate-400">
          Card <span className="text-[#0066FF] dark:text-blue-400 font-black">{currentIndex + 1}</span> of {cards.length}
        </span>
        <span className="text-[11px] text-[#64748B] dark:text-slate-400 font-medium">
          Tap card to reveal answer
        </span>
      </div>

      {/* 3D Flashcard Flip Surface */}
      {currentCard && (
        <div
          onClick={() => setIsFlipped(!isFlipped)}
          className="flex-1 min-h-[300px] sm:min-h-[360px] bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl p-6 sm:p-8 flex flex-col justify-between cursor-pointer transition-all hover:border-[#2563EB]/40 dark:hover:border-[#3B82F6]/40 mb-3 select-none shadow-xs"
        >
          {/* Card Label */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider">
              {isFlipped ? 'Answer / Explanation' : 'Question / Concept'}
            </span>
            <span className="text-[11px] font-bold text-[#0066FF] dark:text-blue-400 flex items-center gap-1">
              <i className="bi bi-arrow-repeat text-xs"></i>
              <span>Tap to flip</span>
            </span>
          </div>

          {/* Card Text Content */}
          <div className="my-auto py-4 text-center">
            <div className="text-base sm:text-xl font-bold text-[#0F172A] dark:text-white leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {formatLatexMath(isFlipped ? currentCard.back : currentCard.front)}
              </ReactMarkdown>
            </div>

            {showHint && currentCard.hint && !isFlipped && (
              <div className="mt-4 p-3 bg-[#F1F5F9] dark:bg-[#1C1C1C] rounded-2xl border border-[#E3E9F1] dark:border-[#2A2A2A] text-xs text-[#64748B] dark:text-[#A3A3A3] inline-block animate-fade-in">
                <i className="bi bi-lightbulb mr-1 text-amber-500"></i>
                {currentCard.hint}
              </div>
            )}
          </div>

          {/* Bottom Hint Toggle */}
          <div className="flex items-center justify-between pt-4 border-t border-[#E3E9F1]/60 dark:border-[#2A2A2A]">
            {currentCard.hint && !isFlipped ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHint(!showHint);
                }}
                className="text-xs font-bold text-[#64748B] dark:text-slate-400 hover:text-[#0066FF] dark:hover:text-blue-400 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <i className="bi bi-lightbulb"></i>
                <span>{showHint ? 'Hide Hint' : 'Show Hint'}</span>
              </button>
            ) : <div />}

            <span className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
              {isFlipped ? 'Tap card to flip back' : 'Tap card to reveal answer'}
            </span>
          </div>
        </div>
      )}

      {/* Prominent Large Bottom Navigation Bar */}
      <div className="bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl p-3 sm:p-4 flex items-center justify-between gap-3 shrink-0 shadow-xs">
        <button
          type="button"
          onClick={() => {
            setIsFlipped(false);
            setShowHint(false);
            setCurrentIndex((prev) => Math.max(0, prev - 1));
          }}
          disabled={currentIndex === 0}
          className="flex-1 py-3.5 sm:py-4 px-4 rounded-2xl bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-[#E3E9F1] dark:hover:bg-[#2A2A2A] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-white disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center gap-2 font-bold text-xs sm:text-sm active:scale-98 shadow-2xs"
        >
          <i className="bi bi-arrow-left text-base font-black"></i>
          <span>Previous</span>
        </button>

        <div className="px-3 py-1.5 bg-[#F1F5F9] dark:bg-[#1C1C1C] rounded-xl text-xs font-black text-[#0F172A] dark:text-white shrink-0 border border-[#E3E9F1] dark:border-[#2A2A2A]">
          {currentIndex + 1} / {cards.length}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsFlipped(false);
            setShowHint(false);
            setCurrentIndex((prev) => Math.min(cards.length - 1, prev + 1));
          }}
          disabled={currentIndex === cards.length - 1}
          className="flex-1 py-3.5 sm:py-4 px-4 rounded-2xl bg-[#0066FF] hover:bg-[#0052cc] text-white disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center gap-2 font-bold text-xs sm:text-sm active:scale-98 shadow-sm"
        >
          <span>Next</span>
          <i className="bi bi-arrow-right text-base font-black"></i>
        </button>
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

export default NotebookFlashcards;
