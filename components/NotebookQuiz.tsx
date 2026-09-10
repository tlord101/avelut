import React, { useState, useEffect, useRef, useCallback } from 'react';
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

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface NotebookQuizProps {
  notebook: Notebook;
  chapter: NotebookChapter;
  chapterContent: string;
  userProfile: UserProfile;
  onBack: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

export const NotebookQuiz: React.FC<NotebookQuizProps> = ({
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
        .catch((err) => console.warn('[NotebookQuiz] Error loading chapter content:', err));
    }
  }, [notebook.id, chapter.id, chapter.startPage, chapter.endPage, chapterContent]);

  // Configuration State
  const [isConfiguring, setIsConfiguring] = useState(true);
  const [selectedMinutes, setSelectedMinutes] = useState(15);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'standard' | 'challenging'>('standard');

  // Quiz Execution State
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [savedQuiz, setSavedQuiz] = useState<QuizQuestion[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(15 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitCost, setLimitCost] = useState(1);

  const timerRef = useRef<any>(null);

  // ── Configure Main App Header for Notebook Quiz ──
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
                {chapter.title} — Quiz
              </h2>
            </div>
          </div>
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

  // Check SQLite for previously generated quiz questions on mount
  useEffect(() => {
    let isMounted = true;
    getChapterGeneration<QuizQuestion[]>(notebook.id, chapter.id, 'quiz')
      .then((saved) => {
        if (isMounted && saved && Array.isArray(saved) && saved.length > 0) {
          setSavedQuiz(saved);
        }
      })
      .catch((err) => console.warn('[Quiz] Cache read error:', err));
    return () => {
      isMounted = false;
    };
  }, [notebook.id, chapter.id]);

  // Start with saved quiz questions (instant, 0 credits)
  const handleStartSavedQuiz = () => {
    if (!savedQuiz || savedQuiz.length === 0) return;
    setQuestions(savedQuiz);
    setSelectedAnswers({});
    setCurrentIndex(0);
    setIsSubmitted(false);
    setTimeLeftSeconds(selectedMinutes * 60);
    setIsTimerRunning(true);
    setIsConfiguring(false);
  };

  // Timer Tick
  useEffect(() => {
    if (isTimerRunning && timeLeftSeconds > 0 && !isSubmitted) {
      timerRef.current = setInterval(() => {
        setTimeLeftSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setIsSubmitted(true);
            addToast('Time is up! Quiz submitted automatically.', 'info');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, timeLeftSeconds, isSubmitted, addToast]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Generate Questions via AI
  const handleStartQuiz = async () => {
    const cost = getFeatureCost('ai_quiz_generation', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitModal(true);
      return;
    }

    setIsGenerating(true);
    setIsConfiguring(false);

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

      const prompt = `You are an expert academic examiner. Based strictly on the following textbook chapter excerpt, generate exactly ${questionCount} high-quality, professional multiple-choice questions.

CHAPTER TITLE: ${chapter.title}
BOOK: ${notebook.title}
CONTENT EXCERPT (PAGES ${chapter.startPage}-${chapter.endPage}):
${excerptToUse ? excerptToUse.slice(0, 16000) : `Topic: ${chapter.title} from ${notebook.title}`}

RULES:
1. Ensure all mathematical expressions and formulas are formatted in valid LaTeX with $...$ for inline or $$...$$ for blocks.
2. Provide exactly 4 clear options (A, B, C, D) per question.
3. Include a comprehensive step-by-step academic explanation for why the correct option is right.
4. Output strictly valid JSON matching this schema:
[
  {
    "id": 1,
    "question": "Question text with LaTeX if applicable",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Detailed step-by-step academic explanation"
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
        setQuestions(parsed);
        setSavedQuiz(parsed);
        setSelectedAnswers({});
        setCurrentIndex(0);
        setIsSubmitted(false);
        setTimeLeftSeconds(selectedMinutes * 60);
        setIsTimerRunning(true);
        // Persist questions in SQLite for replay without cost
        await saveChapterGeneration(notebook.id, chapter.id, userProfile?.uid || 'local', 'quiz', parsed);
        void deductAICredits(userProfile?.uid, cost, 'Notebook Quiz Generation');
      } else {
        throw new Error('Invalid question format received');
      }
    } catch (err) {
      console.error('Quiz generation error:', err);
      addToast('Failed to generate quiz from chapter. Please retry.', 'error');
      setIsConfiguring(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectOption = (optionIndex: number) => {
    if (isSubmitted) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [currentIndex]: optionIndex,
    }));
  };

  const calculateScore = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctIndex) {
        score++;
      }
    });
    return score;
  };

  // 1. Configuration Screen
  if (isConfiguring) {
    return (
      <div className="flex-1 w-full max-w-2xl mx-auto p-4 sm:p-6 flex flex-col justify-center pb-[calc(76px+env(safe-area-inset-bottom)+14px)] animate-fade-in">
        <div className="bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl p-6 sm:p-8 shadow-xs">

            {/* Saved Quiz Quick Start Banner */}
            {savedQuiz && savedQuiz.length > 0 && (
              <div className="p-4 mb-6 bg-[#F1F5F9] dark:bg-[#1C1C1C] border border-[#2563EB]/30 dark:border-[#3B82F6]/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#0F172A] dark:bg-[#141414] text-white flex items-center justify-center text-base shrink-0">
                    <i className="bi bi-bookmark-check-fill text-[#2563EB] dark:text-[#3B82F6]"></i>
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-[#0F172A] dark:text-white truncate">
                      Saved Chapter Quiz Available
                    </h4>
                    <p className="text-[11px] text-[#64748B] dark:text-[#A3A3A3]">
                      {savedQuiz.length} questions saved locally on your device (0 credits)
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleStartSavedQuiz}
                  className="w-full sm:w-auto px-4 py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] dark:bg-[#3B82F6] dark:hover:bg-[#60A5FA] text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                >
                  <i className="bi bi-play-fill text-sm"></i>
                  <span>Start Saved Quiz</span>
                </button>
              </div>
            )}

            {/* Settings */}
            <div className="space-y-6">
              {/* Time Limit Setting */}
              <div>
                <label className="block text-xs font-bold text-[#0F172A] dark:text-white uppercase tracking-wider mb-2.5">
                  <i className="bi bi-clock mr-1.5 text-[#2563EB] dark:text-[#3B82F6]"></i> Global Quiz Timer
                </label>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 30].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setSelectedMinutes(mins)}
                    className={`py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                      selectedMinutes === mins
                        ? 'bg-[#0F172A] dark:bg-[#1C1C1C] text-white border-2 border-[#2A2A2A] dark:border-[#3A3A3A]'
                        : 'bg-[#F6F6F3] dark:bg-[#1C1C1C] text-[#0F172A] dark:text-[#FAFAFA] border border-[#E3E9F1] dark:border-[#2A2A2A] hover:bg-[#F1F5F9] dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {mins} Mins
                  </button>
                ))}
              </div>
            </div>

            {/* Question Count Setting */}
            <div>
              <label className="block text-xs font-bold text-[#0F172A] dark:text-white uppercase tracking-wider mb-2.5">
                <i className="bi bi-list-ol mr-1.5 text-[#2563EB] dark:text-[#3B82F6]"></i> Question Count
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 15].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setQuestionCount(cnt)}
                    className={`py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                      questionCount === cnt
                        ? 'bg-[#0F172A] dark:bg-[#1C1C1C] text-white border-2 border-[#2A2A2A] dark:border-[#3A3A3A]'
                        : 'bg-[#F6F6F3] dark:bg-[#1C1C1C] text-[#0F172A] dark:text-[#FAFAFA] border border-[#E3E9F1] dark:border-[#2A2A2A] hover:bg-[#F1F5F9] dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {cnt} Questions
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty Setting */}
            <div>
              <label className="block text-xs font-bold text-[#0F172A] dark:text-white uppercase tracking-wider mb-2.5">
                <i className="bi bi-sliders mr-1.5 text-[#2563EB] dark:text-[#3B82F6]"></i> Difficulty Level
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['standard', 'challenging'] as const).map((diff) => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setDifficulty(diff)}
                    className={`py-3 rounded-2xl text-xs font-bold capitalize transition-all cursor-pointer ${
                      difficulty === diff
                        ? 'bg-[#0F172A] dark:bg-[#1C1C1C] text-white border-2 border-[#2A2A2A] dark:border-[#3A3A3A]'
                        : 'bg-[#F6F6F3] dark:bg-[#1C1C1C] text-[#0F172A] dark:text-[#FAFAFA] border border-[#E3E9F1] dark:border-[#2A2A2A] hover:bg-[#F1F5F9] dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={handleStartQuiz}
              className="w-full py-4 bg-[#0066FF] hover:bg-[#0052cc] active:scale-98 text-white font-bold text-sm rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 mt-4"
            >
              <span>Generate & Start Quiz</span>
              <i className="bi bi-arrow-right"></i>
            </button>
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
  }

  // 2. Generating State
  if (isGenerating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in max-w-md mx-auto">
        <div className="w-14 h-14 rounded-full border-3 border-[#E3E9F1] dark:border-[#2A2A2A] border-t-[#2563EB] dark:border-t-[#3B82F6] animate-spin mb-4" />
        <h3 className="text-lg font-black text-[#0F172A] dark:text-white tracking-tight">
          Formulating Academic Quiz...
        </h3>
        <p className="text-xs text-[#64748B] dark:text-[#A3A3A3] mt-1 leading-relaxed">
          Extracting key principles, theorems, and worked problems from "{chapter.title}".
        </p>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(selectedAnswers).length;

  // 3. Results Screen
  if (isSubmitted) {
    const finalScore = calculateScore();
    const percent = Math.round((finalScore / totalQuestions) * 100);

    return (
      <div className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 overflow-y-auto space-y-6 pb-[calc(76px+env(safe-area-inset-bottom)+14px)] animate-fade-in">
        {/* Score Summary Banner */}
        <div className="bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl p-6 sm:p-8 text-center">
          <span className="text-xs font-bold text-[#64748B] dark:text-[#A3A3A3] uppercase tracking-wider">Quiz Completed</span>
          <h2 className="text-3xl font-black text-[#0F172A] dark:text-white mt-1">
            {percent >= 70 ? 'Excellent Mastery!' : percent >= 50 ? 'Good Effort' : 'Needs Review'}
          </h2>
          <div className="inline-flex items-baseline gap-1 mt-3 px-6 py-2.5 bg-[#F1F5F9] dark:bg-[#1C1C1C] rounded-2xl border border-[#E3E9F1] dark:border-[#2A2A2A]">
            <span className="text-4xl font-black text-[#2563EB] dark:text-[#3B82F6]">{finalScore}</span>
            <span className="text-lg font-bold text-[#64748B] dark:text-[#A3A3A3]">/ {totalQuestions}</span>
            <span className="text-sm font-semibold text-[#64748B] dark:text-[#A3A3A3] ml-2">({percent}%)</span>
          </div>

          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => {
                setIsSubmitted(false);
                setSelectedAnswers({});
                setCurrentIndex(0);
                setIsConfiguring(true);
              }}
              className="px-6 py-3 rounded-2xl bg-[#2563EB] hover:bg-[#1D4ED8] dark:bg-[#3B82F6] dark:hover:bg-[#60A5FA] text-white font-bold text-xs transition-all cursor-pointer"
            >
              Take Another Quiz
            </button>
            <button
              onClick={onBack}
              className="px-6 py-3 rounded-2xl bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-white dark:hover:bg-[#2A2A2A] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-white font-bold text-xs transition-all cursor-pointer"
            >
              Back to Chapters
            </button>
          </div>
        </div>

        {/* Detailed Solutions Review */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-[#0F172A] dark:text-white uppercase tracking-wider px-1">
            Question Review & Solutions
          </h3>

          {questions.map((q, idx) => {
            const userAns = selectedAnswers[idx];
            const isCorrect = userAns === q.correctIndex;

            return (
              <div
                key={q.id || idx}
                className={`bg-white dark:bg-[#141414] border rounded-2xl p-5 sm:p-6 transition-all ${
                  isCorrect ? 'border-emerald-200 dark:border-emerald-800' : 'border-rose-200 dark:border-rose-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <span className="text-xs font-bold text-[#64748B] dark:text-slate-400 uppercase">
                    Question {idx + 1}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      isCorrect
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                    }`}
                  >
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </span>
                </div>

                <div className="text-sm font-medium text-[#0F172A] dark:text-slate-100 leading-relaxed mb-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {formatLatexMath(q.question)}
                  </ReactMarkdown>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {q.options.map((opt, optIdx) => {
                    const isSelected = userAns === optIdx;
                    const isRightAnswer = optIdx === q.correctIndex;

                    let btnClass = 'bg-[#F6F6F3] dark:bg-[#1C1C1C] border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-[#FAFAFA]';
                    if (isRightAnswer) {
                      btnClass = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-600 text-emerald-900 dark:text-emerald-300 font-bold';
                    } else if (isSelected && !isRightAnswer) {
                      btnClass = 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-600 text-rose-900 dark:text-rose-300 line-through';
                    }

                    return (
                      <div
                        key={optIdx}
                        className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${btnClass}`}
                      >
                        <span className="font-bold opacity-70">
                          {String.fromCharCode(65 + optIdx)}.
                        </span>
                        <div className="flex-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {formatLatexMath(opt)}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Explanation */}
                <div className="p-3.5 bg-[#F8FAFC] dark:bg-[#1C1C1C] rounded-xl border border-[#E2E8F0] dark:border-[#2A2A2A] text-xs text-[#334155] dark:text-[#A3A3A3] leading-relaxed">
                  <span className="font-bold text-[#0F172A] dark:text-white block mb-1">
                    <i className="bi bi-info-circle mr-1 text-[#0066FF] dark:text-blue-400"></i> Solution Explanation:
                  </span>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {formatLatexMath(q.explanation)}
                  </ReactMarkdown>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 4. Live Quiz View
  return (
    <div className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 flex flex-col justify-between overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom)+14px)] animate-fade-in">
      {/* Top Bar with Timer and Progress */}
      <div className="bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-2xl p-4 flex items-center justify-between mb-4">
        {/* Global Timer Top-Left */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F6F6F3] dark:bg-[#1C1C1C] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-xl">
          <i
            className={`bi bi-stopwatch text-sm ${
              timeLeftSeconds < 120 ? 'text-rose-600 animate-pulse' : 'text-[#2563EB] dark:text-[#3B82F6]'
            }`}
          ></i>
          <span
            className={`font-mono text-sm font-bold ${
              timeLeftSeconds < 120 ? 'text-rose-600 font-black' : 'text-[#0F172A] dark:text-white'
            }`}
          >
            {formatTimer(timeLeftSeconds)}
          </span>
        </div>

        {/* Question Counter */}
        <div className="text-xs font-bold text-[#64748B] dark:text-[#A3A3A3]">
          Question <span className="text-[#0F172A] dark:text-white font-black">{currentIndex + 1}</span> of {totalQuestions}
        </div>

        {/* End / Submit Early Button */}
        <button
          onClick={() => {
            if (window.confirm('Are you sure you want to submit the quiz now?')) {
              setIsSubmitted(true);
            }
          }}
          className="px-3.5 py-1.5 rounded-xl border border-[#E3E9F1] dark:border-[#2A2A2A] bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-white dark:hover:bg-[#2A2A2A] text-xs font-bold text-[#0F172A] dark:text-white transition-all cursor-pointer"
        >
          Submit Quiz
        </button>
      </div>

      {/* Main Question Card */}
      {currentQ && (
        <div className="flex-1 bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xs mb-4">
          <div>
            <span className="text-[11px] font-bold text-[#64748B] dark:text-[#A3A3A3] uppercase tracking-wider">
              {chapter.title}
            </span>
            <div className="text-base sm:text-lg font-bold text-[#0F172A] dark:text-white leading-relaxed mt-2 mb-6">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {formatLatexMath(currentQ.question)}
              </ReactMarkdown>
            </div>

            {/* Options List */}
            <div className="space-y-3">
              {currentQ.options.map((option, idx) => {
                const isSelected = selectedAnswers[currentIndex] === idx;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                      isSelected
                        ? 'bg-[#F1F5F9] dark:bg-[#1C1C1C] border-[#2563EB] dark:border-[#3B82F6] text-[#2563EB] dark:text-[#3B82F6] font-bold'
                        : 'bg-[#F6F6F3] dark:bg-[#1C1C1C]/60 border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-slate-200 hover:bg-white dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-[#2563EB] dark:bg-[#3B82F6] text-white'
                          : 'bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#64748B] dark:text-[#A3A3A3]'
                      }`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <div className="flex-1 text-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{ p: ({ node, ...props }) => <span {...props} /> }}
                      >
                        {formatLatexMath(option)}
                      </ReactMarkdown>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nav Buttons Inside Question Card */}
          <div className="flex items-center justify-between pt-6 border-t border-[#E3E9F1] dark:border-[#2A2A2A] mt-6">
            <button
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-white dark:hover:bg-[#2A2A2A] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-white disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <i className="bi bi-arrow-left text-sm"></i>
            </button>

            <span className="text-xs font-semibold text-[#64748B] dark:text-[#A3A3A3]">
              {answeredCount} of {totalQuestions} answered
            </span>

            {currentIndex < totalQuestions - 1 ? (
              <button
                onClick={() => setCurrentIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
                className="flex items-center justify-center w-11 h-11 rounded-full bg-[#F6F6F3] dark:bg-[#1C1C1C] hover:bg-white dark:hover:bg-[#2A2A2A] border border-[#E3E9F1] dark:border-[#2A2A2A] text-[#0F172A] dark:text-white transition-all cursor-pointer"
              >
                <i className="bi bi-arrow-right text-sm"></i>
              </button>
            ) : (
              <button
                onClick={() => setIsSubmitted(true)}
                className="px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] dark:bg-[#3B82F6] dark:hover:bg-[#60A5FA] text-white text-xs font-bold transition-all cursor-pointer"
              >
                Finish Quiz
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotebookQuiz;
