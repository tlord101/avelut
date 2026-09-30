import { MarkdownContent } from '../MarkdownContent';
import React, { useState, useEffect, useRef } from 'react';
import { createAvelutAI, getResponseText } from '../../utils/inference';
import { checkAICredits, deductAICredits } from '../../utils/usage';
import type { UserProfile, AppSettings } from '../../types';
import type { PastQuestionPack, PastQuestion } from '../../types/playground';
import {
  getPastQuestionPackById,
  getCachedTheorySolution,
  saveTheorySolution
} from '../../services/playgroundStorageService';

export interface PastQuestionViewerProps {
  packId: string;
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  onBack: () => void;
}

export const PastQuestionViewer: React.FC<PastQuestionViewerProps> = ({
  packId,
  userProfile,
  appSettings,
  onBack
}) => {
  const [currentPack, setCurrentPack] = useState<PastQuestionPack | null>(null);
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedMcqOptions, setSelectedMcqOptions] = useState<Record<string, string>>({});
  const [animating, setAnimating] = useState(false);

  const [isTheoryDrawerOpen, setIsTheoryDrawerOpen] = useState(false);
  const [activeTheoryQuestion, setActiveTheoryQuestion] = useState<PastQuestion | null>(null);
  const [theorySolutionText, setTheorySolutionText] = useState('');
  const [isTheorySolving, setIsTheorySolving] = useState(false);
  const [theorySolutionError, setTheorySolutionError] = useState<string | null>(null);
  const [isCachedSolution, setIsCachedSolution] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPastQuestionPackById(packId).then(pack => {
      setCurrentPack(pack);
      setActiveQuestionIdx(0);
      setSelectedMcqOptions({});
    });
  }, [packId]);

  const navigateTo = (idx: number) => {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setActiveQuestionIdx(idx);
      setAnimating(false);
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 160);
  };

  const handleSolveTheoryQuestion = async (q: PastQuestion) => {
    if (!currentPack) return;
    setActiveTheoryQuestion(q);
    setIsTheoryDrawerOpen(true);
    setTheorySolutionError(null);
    setTheorySolutionText('');

    try {
      const cached = await getCachedTheorySolution(currentPack.id, q.id);
      if (cached && cached.solutionMarkdown) {
        setTheorySolutionText(cached.solutionMarkdown);
        setIsCachedSolution(true);
        setIsTheorySolving(false);
        return;
      }
    } catch (e) {
      console.warn('Theory cache lookup warning:', e);
    }

    setIsCachedSolution(false);
    setIsTheorySolving(true);

    if (userProfile) {
      const check = checkAICredits(userProfile, 1, appSettings);
      if (!check.allowed) {
        setTheorySolutionError('Insufficient AI credits. Please top up your balance.');
        setIsTheorySolving(false);
        return;
      }
    }

    try {
      const ai = createAvelutAI(appSettings, userProfile);

      // Smart prompt: concise for theory/factual, step-by-step only for calculations
      const prompt = `You are an academic AI assistant. Answer the following past exam question.

RULES:
- If this is a CALCULATION or MATHEMATICAL question: show step-by-step working clearly, use KaTeX ($...$ inline, $$...$$ block math), and box the final answer using \\boxed{...}.
- If this is a THEORY or CONCEPTUAL question: give a DIRECT, CONCISE answer. No long preambles, no excessive background. Just the precise answer the examiner expects.
- Keep all answers focused and appropriately brief. Do NOT pad with unnecessary context.

Course: ${currentPack.courseCode || currentPack.title}
Question:
${q.prompt}`;

      const response = await ai.models.generateContent({ contents: prompt });
      const resultText = getResponseText(response) || 'Unable to generate solution.';

      setTheorySolutionText(resultText);
      await saveTheorySolution(currentPack.id, q.id, resultText);

      if (userProfile?.uid) {
        void deductAICredits(userProfile.uid, 1, 'Past Question Solution', appSettings);
      }
    } catch (err: any) {
      console.error('Failed to generate theory solution:', err);
      setTheorySolutionError(err?.message || 'Failed to generate AI solution. Please try again.');
    } finally {
      setIsTheorySolving(false);
    }
  };

  const renderMarkdownText = (text: string) => (
    <div className="dark min-w-0"><MarkdownContent content={text} className="[&>p]:my-0" /></div>
  );

  if (!currentPack) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-[#0A0A0A]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#A3A3A3]">Loading questions...</p>
        </div>
      </div>
    );
  }

  const currentQ = currentPack.questions[activeQuestionIdx];
  const progress = (activeQuestionIdx + 1) / currentPack.questions.length;
  const answeredCount = Object.keys(selectedMcqOptions).length;

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen max-w-2xl mx-auto w-full">

      {/* ── Sticky Header ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur-sm border-b border-[#1a1a1a]">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#555] mb-0.5">
                {currentPack.courseCode || 'Past Questions'}
              </p>
              <h1 className="text-sm font-black text-white leading-tight line-clamp-1">{currentPack.title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2.5 py-1.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-bold text-[#A3A3A3]">
                Year {currentPack.year || '—'}
              </span>
              <span className={`px-2.5 py-1.5 rounded-full border text-xs font-bold capitalize ${
                currentQ.type === 'mcq'
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-purple-500/10 border-purple-500/30 text-purple-400'
              }`}>
                {currentQ.type}
              </span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-[#1a1a1a] h-1.5 rounded-full overflow-hidden mb-1.5">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-[#555] font-semibold">
            Question {activeQuestionIdx + 1} of {currentPack.questions.length}
          </p>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">

        {/* Question Card */}
        <div className={`bg-[#111] border border-[#222] rounded-3xl p-5 sm:p-6 transition-all duration-200 ${animating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-black text-[#A3A3A3]">{activeQuestionIdx + 1}</span>
            </div>
            <div className="text-base sm:text-lg font-semibold text-white leading-relaxed min-w-0">
              {renderMarkdownText(currentQ.prompt)}
            </div>
          </div>

          {/* MCQ Options */}
          {currentQ.type === 'mcq' && currentQ.options && (
            <div className="space-y-2.5">
              {currentQ.options.map(opt => {
                const selectedId = selectedMcqOptions[currentQ.id];
                const hasAnswered = !!selectedId;
                const isCorrectOption = opt.isCorrect === true;
                const isSelectedByUser = selectedId === opt.id;

                let btnStyle = "bg-[#181818] border-[#2a2a2a] hover:bg-[#1e1e1e] hover:border-[#333]";
                let letterStyle = "bg-[#252525] text-[#A3A3A3]";
                let textStyle = "text-[#ccc]";
                let icon = null;

                if (hasAnswered) {
                  if (isCorrectOption) {
                    btnStyle = "bg-emerald-500/10 border-emerald-500/40 cursor-default";
                    letterStyle = "bg-emerald-500 text-white";
                    textStyle = "text-emerald-300 font-semibold";
                    icon = <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
                  } else if (isSelectedByUser) {
                    btnStyle = "bg-rose-500/10 border-rose-500/40 cursor-default";
                    letterStyle = "bg-rose-500 text-white";
                    textStyle = "text-rose-300";
                    icon = <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
                  } else {
                    btnStyle = "bg-[#141414] border-[#1e1e1e] opacity-40 cursor-default";
                  }
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      if (!hasAnswered) setSelectedMcqOptions(prev => ({ ...prev, [currentQ.id]: opt.id }));
                    }}
                    disabled={hasAnswered}
                    className={`w-full text-left p-4 rounded-2xl border transition-all duration-150 flex items-center gap-3 active:scale-[0.99] ${btnStyle}`}
                  >
                    <span className={`w-8 h-8 rounded-xl text-xs font-black flex items-center justify-center shrink-0 transition-all ${letterStyle}`}>
                      {opt.id.toUpperCase()}
                    </span>
                    <div className={`text-sm sm:text-base min-w-0 font-medium leading-relaxed flex-1 ${textStyle}`}>
                      {renderMarkdownText(opt.text)}
                    </div>
                    {icon && <span className="ml-auto">{icon}</span>}
                  </button>
                );
              })}

              {/* Explanation */}
              {selectedMcqOptions[currentQ.id] && currentQ.explanation && (
                <div className="mt-2 p-4 rounded-2xl bg-[#181818] border border-[#2a2a2a] text-sm text-[#A3A3A3] leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <p className="text-[11px] font-black uppercase tracking-wide text-white mb-2">Explanation</p>
                  {renderMarkdownText(currentQ.explanation)}
                </div>
              )}
            </div>
          )}

          {/* Theory Solve Section */}
          {currentQ.type === 'theory' && (
            <div className="mt-2 p-5 rounded-2xl bg-gradient-to-br from-[#181818] to-[#141414] border border-[#2a2a2a] flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-black text-white mb-1">AI Solution</h3>
                <p className="text-xs text-[#555] max-w-xs leading-relaxed">
                  Get a precise, direct answer. Calculations include step-by-step working.
                </p>
              </div>
              <button
                onClick={() => handleSolveTheoryQuestion(currentQ)}
                className="px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] text-white font-black text-sm shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Solve Question
              </button>
            </div>
          )}
        </div>

        {/* Question Navigator Grid */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#555] mb-3">Navigator</p>
          <div className="flex flex-wrap gap-2">
            {currentPack.questions.map((q, idx) => {
              const isAnswered = !!selectedMcqOptions[q.id];
              const isCurrent = idx === activeQuestionIdx;
              return (
                <button
                  key={q.id}
                  onClick={() => navigateTo(idx)}
                  className={`w-9 h-9 rounded-xl text-xs font-black transition-all active:scale-90 ${
                    isCurrent
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                      : isAnswered
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                      : 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#555] hover:border-[#444]'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Sticky Bottom Nav ───────────────────────────────────────────────── */}
      <div className="sticky bottom-0 bg-[#0A0A0A]/95 backdrop-blur-sm border-t border-[#1a1a1a] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            disabled={activeQuestionIdx === 0 || animating}
            onClick={() => navigateTo(activeQuestionIdx - 1)}
            className="flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-sm font-bold text-white hover:bg-[#222] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </button>

          <span className="flex-1 text-center text-xs font-semibold text-[#555]">
            {activeQuestionIdx + 1} / {currentPack.questions.length}
          </span>

          <button
            disabled={activeQuestionIdx === currentPack.questions.length - 1 || animating}
            onClick={() => navigateTo(activeQuestionIdx + 1)}
            className="flex items-center gap-1.5 px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] text-white font-black text-sm shadow-lg shadow-blue-600/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Theory Solution Bottom Sheet ────────────────────────────────────── */}
      {isTheoryDrawerOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-[3px] animate-in fade-in duration-200"
            onClick={() => setIsTheoryDrawerOpen(false)}
          />
          {/* Sheet */}
          <div className="relative w-full max-w-3xl mx-auto bg-[#111] border-t border-[#222] rounded-t-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl z-10 animate-in slide-in-from-bottom-4 duration-300">

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-[#333]" />
            </div>

            {/* Header */}
            <div className="px-5 pb-4 pt-2 border-b border-[#1e1e1e] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">AI Solution</h3>
                  <p className="text-[11px] text-[#555]">
                    {isCachedSolution ? '📱 Loaded from cache' : '🤖 Generated by Avelut AI'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTheoryDrawerOpen(false)}
                className="w-9 h-9 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#A3A3A3] hover:text-white flex items-center justify-center transition-all active:scale-90"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              {isTheorySolving ? (
                <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="relative">
                    <div className="w-14 h-14 border-3 border-[#222] rounded-full" />
                    <div className="absolute inset-0 w-14 h-14 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">Solving question...</p>
                    <p className="text-xs text-[#555] mt-1">This usually takes a few seconds</p>
                  </div>
                </div>
              ) : theorySolutionError ? (
                <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex flex-col items-center text-center gap-3">
                  <svg className="w-8 h-8 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p>{theorySolutionError}</p>
                </div>
              ) : (
                <div className="text-sm sm:text-base leading-relaxed text-[#FAFAFA] prose prose-invert max-w-none">
                  {renderMarkdownText(theorySolutionText)}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[#1e1e1e] bg-[#0e0e0e] flex items-center justify-between shrink-0">
              <span className="text-[11px] text-[#444] font-semibold">Saved locally on device</span>
              <button
                onClick={() => setIsTheoryDrawerOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] font-bold text-sm text-white hover:bg-[#222] active:scale-95 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PastQuestionViewer;
