import React, { useState, useRef } from 'react';
import { TeachingQuestion, StudentAnswerEvaluation } from '../../../types/teachingScript';

export interface QuestionOverlayProps {
  question: TeachingQuestion;
  evaluationFeedback: StudentAnswerEvaluation | null;
  isSubmittingAnswer: boolean;
  onSubmitAnswer: (answer: string) => void;
  onDismiss?: () => void;
}

/**
 * Lightweight floating classroom question overlay.
 * Appears seamlessly over the board with voice answering, text input, quick chips, and conversational feedback.
 */
export const QuestionOverlay: React.FC<QuestionOverlayProps> = ({
  question,
  evaluationFeedback,
  isSubmittingAnswer,
  onSubmitAnswer,
  onDismiss,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Voice recognition support
  const handleToggleVoice = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((res: any) => res[0].transcript)
          .join(' ');
        setInputText(transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleSubmit = (ans?: string) => {
    const finalAns = ans || inputText.trim();
    if (!finalAns || isSubmittingAnswer) return;
    if (ans) setSelectedOption(ans);
    onSubmitAnswer(finalAns);
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
              Check Your Understanding
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

        {/* Question Text */}
        <h3 className="text-sm sm:text-base font-bold text-white leading-relaxed mb-4">
          {question.question}
        </h3>

        {/* Quick Options */}
        {question.options && question.options.length > 0 && !evaluationFeedback && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-4">
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

        {/* Input Controls (Voice + Text) */}
        {!evaluationFeedback && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Speak or type your answer..."
              disabled={isSubmittingAnswer}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#222222] border border-[#334155] focus:border-[#38BDF8] focus:outline-none text-xs sm:text-sm text-white placeholder-slate-400 font-medium"
            />

            <button
              onClick={handleToggleVoice}
              type="button"
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                isListening
                  ? 'bg-rose-500 text-white animate-pulse'
                  : 'bg-[#222222] hover:bg-[#334155] text-[#38BDF8] border border-[#334155]'
              }`}
              title="Speak answer aloud"
            >
              <i className={`bi ${isListening ? 'bi-mic-fill' : 'bi-mic'}`}></i>
            </button>

            <button
              onClick={() => handleSubmit()}
              disabled={!inputText.trim() || isSubmittingAnswer}
              type="button"
              className="px-4 py-2.5 rounded-xl bg-[#0066FF] hover:bg-blue-600 disabled:opacity-40 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              {isSubmittingAnswer ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Send'
              )}
            </button>
          </div>
        )}

        {/* Conversational Evaluation Feedback & Next Button */}
        {evaluationFeedback && (
          <div className="mt-2 p-4 rounded-2xl bg-[#222222] border border-[#334155] animate-in fade-in duration-300 space-y-3">
            <div className="flex items-center gap-2">
              <i
                className={`bi ${
                  evaluationFeedback.isCorrect
                    ? 'bi-check-circle-fill text-[#34D399]'
                    : 'bi-info-circle-fill text-[#38BDF8]'
                } text-base`}
              ></i>
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                {evaluationFeedback.isCorrect ? 'Spot On!' : 'Lecturer Note:'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
              {evaluationFeedback.spokenFeedback}
            </p>
            {onDismiss && (
              <button
                onClick={onDismiss}
                type="button"
                className="w-full py-2.5 px-4 rounded-xl bg-[#0066FF] hover:bg-blue-600 active:scale-98 text-white font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <span>Continue to Next Concept</span>
                <i className="bi bi-arrow-right text-xs"></i>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionOverlay;
