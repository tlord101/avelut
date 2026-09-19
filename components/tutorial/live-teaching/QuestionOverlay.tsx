import React, { useState } from 'react';
import { TeachingQuestion, StudentAnswerEvaluation } from '../../../types/teachingScript';

export interface QuestionOverlayProps {
  question: TeachingQuestion;
  evaluationFeedback: StudentAnswerEvaluation | null;
  isSubmittingAnswer: boolean;
  onSubmitAnswer: (answer: string) => void;
  onDismiss?: () => void;
}

/**
 * Fast, lightweight floating classroom question overlay.
 * Shows only options; no manual text input, no question text re-displayed.
 * Uses sound-reactive UI for correction audio.
 */
export const QuestionOverlay: React.FC<QuestionOverlayProps> = ({
  question,
  evaluationFeedback,
  isSubmittingAnswer,
  onSubmitAnswer,
  onDismiss,
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleSubmit = (ans: string) => {
    if (!ans || isSubmittingAnswer) return;
    setSelectedOption(ans);
    onSubmitAnswer(ans);
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-11/12 max-w-xl z-40 animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-2xl sm:rounded-3xl bg-[#080808]/95 backdrop-blur-xl border border-[#38BDF8]/50 p-4 sm:p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-white">
        {/* Header Badge */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-[#0066FF] text-white flex items-center justify-center text-xs font-black">
              Q
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#38BDF8]">
              {evaluationFeedback ? 'Lecturer Note' : 'Select an Answer'}
            </span>
          </div>

          {onDismiss && (
            <button
              onClick={onDismiss}
              type="button"
              className="text-slate-400 hover:text-white text-xs p-1 rounded-full hover:bg-white/10"
              title="Continue lesson"
            >
              <i className="bi bi-x-lg"></i>
            </button>
          )}
        </div>

        {/* Quick Options */}
        {question.options && question.options.length > 0 && !evaluationFeedback && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            {question.options.map((option, idx) => {
              const isSelected = selectedOption === option;
              return (
                <button
                  key={idx}
                  onClick={() => handleSubmit(option)}
                  disabled={isSubmittingAnswer}
                  type="button"
                  className={`flex-1 min-w-[45%] px-4 py-3 rounded-xl border text-xs sm:text-sm font-semibold transition-all active:scale-95 cursor-pointer text-left flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#0066FF] border-[#38BDF8] text-white ring-2 ring-[#38BDF8]/50'
                      : 'bg-[#222222] hover:bg-[#222222]/80 hover:border-[#38BDF8]/50 border-[#334155] text-slate-100'
                  }`}
                >
                  <span>{option}</span>
                  {isSelected && isSubmittingAnswer && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"></div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Sound-Reactive Correction Evaluation Feedback */}
        {evaluationFeedback && !evaluationFeedback.isCorrect && (
          <div className="mt-2 p-6 rounded-2xl bg-[#222222] border border-[#334155] animate-in fade-in duration-300 flex flex-col items-center justify-center space-y-4">
             {/* Simple CSS Audio wave animation */}
             <div className="flex items-center justify-center gap-1.5 h-12">
               {[1, 2, 3, 4, 5].map((i) => (
                 <div
                   key={i}
                   className="w-1.5 bg-[#38BDF8] rounded-full animate-[soundWave_1s_ease-in-out_infinite]"
                   style={{
                     height: '100%',
                     animationDelay: `${i * 0.1}s`,
                     animationDuration: `${0.8 + (i % 3) * 0.2}s`
                   }}
                 />
               ))}
             </div>
             <style>{`
               @keyframes soundWave {
                 0%, 100% { transform: scaleY(0.3); opacity: 0.7; }
                 50% { transform: scaleY(1); opacity: 1; }
               }
             `}</style>
             <p className="text-xs sm:text-sm text-slate-300 text-center font-medium">
               Listen to the lecturer's correction...
             </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionOverlay;
