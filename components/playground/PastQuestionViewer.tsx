import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { formatLatexMath } from '../../utils/latexFormatter';
import { createAvelutAI } from '../../utils/inference';
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

  const [isTheoryDrawerOpen, setIsTheoryDrawerOpen] = useState(false);
  const [activeTheoryQuestion, setActiveTheoryQuestion] = useState<PastQuestion | null>(null);
  const [theorySolutionText, setTheorySolutionText] = useState('');
  const [isTheorySolving, setIsTheorySolving] = useState(false);
  const [theorySolutionError, setTheorySolutionError] = useState<string | null>(null);
  const [isCachedSolution, setIsCachedSolution] = useState(false);

  useEffect(() => {
    getPastQuestionPackById(packId).then(pack => {
      setCurrentPack(pack);
      setActiveQuestionIdx(0);
      setSelectedMcqOptions({});
    });
  }, [packId]);

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
      const prompt = `Solve this university past exam question step-by-step cleanly and thoroughly for a student.
Use standard KaTeX formatting for math ($...$ for inline, $$...$$ for block math).
Box the final answer using KaTeX \\boxed{...}.
Keep steps clear, direct, and educational.

Course: ${currentPack.courseCode || currentPack.title}
Question:
${q.prompt}`;

      const response = await ai.generateContent(prompt);
      const resultText = response.text || 'Unable to generate solution.';

      setTheorySolutionText(resultText);
      await saveTheorySolution(currentPack.id, q.id, resultText);

      if (userProfile?.uid) {
        void deductAICredits(userProfile.uid, 1, 'Past Question Theory Solution', appSettings);
      }
    } catch (err: any) {
      console.error('Failed to generate theory solution:', err);
      setTheorySolutionError(err?.message || 'Failed to generate AI solution. Please try again.');
    } finally {
      setIsTheorySolving(false);
    }
  };

  const renderMarkdownText = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {formatLatexMath(text)}
    </ReactMarkdown>
  );

  if (!currentPack) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-neutral-400 dark:bg-[#0A0A0A]">
        Loading past question pack...
      </div>
    );
  }

  const currentQ = currentPack.questions[activeQuestionIdx];

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-4xl mx-auto w-full">
      {/* Pack Info & Progress Bar */}
      <div className="mb-6 bg-[#141414] border border-[#2A2A2A] rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3]">{currentPack.courseCode || 'Past Questions'}</span>
            <h1 className="text-lg sm:text-xl font-bold text-[#FAFAFA] leading-tight">{currentPack.title}</h1>
          </div>
          <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full bg-[#1C1C1C] border border-[#2A2A2A] text-[#A3A3A3]">
            Year {currentPack.year || '2023'}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-[#A3A3A3] mt-3 pt-3 border-t border-[#1C1C1C]">
          <span>Question {activeQuestionIdx + 1} of {currentPack.questions.length}</span>
          <span className="capitalize font-semibold text-blue-400">{currentQ.type} Question</span>
        </div>
        <div className="w-full bg-[#1C1C1C] h-1.5 rounded-full mt-2 overflow-hidden">
          <div
            className="bg-[#2563EB] h-full transition-all duration-300"
            style={{ width: `${((activeQuestionIdx + 1) / currentPack.questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Current Question View */}
      <div className="flex-1 bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between mb-6">
        <div>
          <div className="text-[#FAFAFA] text-base sm:text-lg leading-relaxed mb-6 font-medium">
            {renderMarkdownText(currentQ.prompt)}
          </div>

          {/* MCQ OPTIONS */}
          {currentQ.type === 'mcq' && currentQ.options && (
            <div className="space-y-3 mb-6">
              {currentQ.options.map(opt => {
                const selectedId = selectedMcqOptions[currentQ.id];
                const hasAnswered = !!selectedId;
                const isCorrectOption = opt.isCorrect === true;
                const isSelectedByOption = selectedId === opt.id;

                let optionStyle = "bg-[#1C1C1C] border-[#2A2A2A] text-[#FAFAFA] hover:bg-[#2A2A2A]";
                if (hasAnswered) {
                  if (isCorrectOption) {
                    optionStyle = "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-semibold";
                  } else if (isSelectedByOption) {
                    optionStyle = "bg-rose-500/10 border-rose-500/50 text-rose-400";
                  } else {
                    optionStyle = "bg-[#1C1C1C] border-[#2A2A2A] opacity-50 text-[#A3A3A3]";
                  }
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setSelectedMcqOptions(prev => ({ ...prev, [currentQ.id]: opt.id }));
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition flex items-center justify-between ${optionStyle}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                        hasAnswered && isCorrectOption
                          ? 'bg-emerald-500 text-white'
                          : hasAnswered && isSelectedByOption
                            ? 'bg-rose-500 text-white'
                            : 'bg-[#2A2A2A] text-[#FAFAFA]'
                      }`}>
                        {opt.id.toUpperCase()}
                      </span>
                      <span className="text-sm sm:text-base">{renderMarkdownText(opt.text)}</span>
                    </div>
                  </button>
                );
              })}

              {selectedMcqOptions[currentQ.id] && currentQ.explanation && (
                <div className="mt-4 p-4 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-sm text-[#A3A3A3]">
                  <span className="font-bold text-white block mb-1">Explanation:</span>
                  {renderMarkdownText(currentQ.explanation)}
                </div>
              )}
            </div>
          )}

          {/* THEORY SOLVE BUTTON */}
          {currentQ.type === 'theory' && (
            <div className="mt-4 p-5 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#2A2A2A] flex items-center justify-center mb-3 text-blue-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-white mb-1">Step-by-Step AI Solution</h3>
              <p className="text-xs text-[#A3A3A3] max-w-md mb-4">
                Get a complete mathematical derivation with KaTeX equations. Solutions are saved locally on your device for instant offline access.
              </p>
              <button
                onClick={() => handleSolveTheoryQuestion(currentQ)}
                className="px-6 py-3 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Solve Question
              </button>
            </div>
          )}
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-[#1C1C1C] mt-6">
          <button
            disabled={activeQuestionIdx === 0}
            onClick={() => setActiveQuestionIdx(prev => prev - 1)}
            className="px-4 py-2 rounded-xl bg-[#1C1C1C] text-sm font-semibold text-[#FAFAFA] border border-[#2A2A2A] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Previous
          </button>
          <span className="text-xs font-semibold text-[#A3A3A3]">
            {activeQuestionIdx + 1} / {currentPack.questions.length}
          </span>
          <button
            disabled={activeQuestionIdx === currentPack.questions.length - 1}
            onClick={() => setActiveQuestionIdx(prev => prev + 1)}
            className="px-4 py-2 rounded-xl bg-[#1C1C1C] text-sm font-semibold text-[#FAFAFA] border border-[#2A2A2A] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next
          </button>
        </div>
      </div>

      {/* THEORY SOLUTION DRAWER */}
      {isTheoryDrawerOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/75 backdrop-blur-sm animate-fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setIsTheoryDrawerOpen(false)}
          />
          <div className="relative w-full max-w-3xl mx-auto bg-[#141414] border-t border-[#2A2A2A] rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl z-10 animate-slide-up">
            <div className="p-4 sm:p-5 border-b border-[#2A2A2A] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#FAFAFA]">Theory Solution</h3>
                  <p className="text-xs text-[#A3A3A3]">
                    {isCachedSolution ? 'Loaded from device cache' : 'Generated by Avelut AI'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTheoryDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-[#1C1C1C] border border-[#2A2A2A] text-[#A3A3A3] hover:text-white flex items-center justify-center transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4">
              {isTheorySolving ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-white">Generating step-by-step solution...</p>
                </div>
              ) : theorySolutionError ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex flex-col items-center text-center space-y-3">
                  <p>{theorySolutionError}</p>
                </div>
              ) : (
                <div className="text-sm sm:text-base leading-relaxed text-[#FAFAFA] prose prose-invert max-w-none">
                  {renderMarkdownText(theorySolutionText)}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#2A2A2A] bg-[#101010] flex items-center justify-between text-xs text-[#A3A3A3]">
              <span>Saved on user device</span>
              <button
                onClick={() => setIsTheoryDrawerOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] font-semibold text-white hover:bg-[#2A2A2A]"
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
