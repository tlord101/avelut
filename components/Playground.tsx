import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { formatLatexMath } from '../utils/latexFormatter';
import { createAvelutAI } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../utils/usage';
import { useToast } from '../hooks/useToast';
import type { UserProfile, AppSettings, Course, Topic } from '../types';
import type {
  PastQuestionPack,
  PastQuestion,
  TheorySolution,
  FlashcardDeck,
  CBTExam,
  CBTAttempt
} from '../types/playground';
import {
  getPastQuestionPacks,
  getPastQuestionPackById,
  getCachedTheorySolution,
  saveTheorySolution,
  getSavedFlashcardDecks,
  saveFlashcardDeck,
  getFlashcardDeckById,
  getSavedCBTExams,
  saveCBTExam,
  getCBTExamById,
  saveCBTAttempt,
  getCBTAttempts
} from '../services/playgroundStorageService';

interface PlaygroundProps {
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
}

type ViewState =
  | { type: 'home' }
  | { type: 'past_viewer'; packId: string }
  | { type: 'flashcards_new' }
  | { type: 'flashcards_study'; deckId: string }
  | { type: 'cbt_new' }
  | { type: 'cbt_exam'; examId: string };

export const Playground: React.FC<PlaygroundProps> = ({
  userProfile,
  appSettings,
  onNavigate,
  setCustomHeaderConfig
}) => {
  const { addToast } = useToast();

  // Internal route state parser from pathname
  const parsePathnameToViewState = (): ViewState => {
    if (typeof window === 'undefined') return { type: 'home' };
    const path = window.location.pathname;
    if (path.startsWith('/playground/past/')) {
      const packId = path.substring('/playground/past/'.length).split('/')[0];
      if (packId) return { type: 'past_viewer', packId };
    }
    if (path === '/playground/flashcards/new') {
      return { type: 'flashcards_new' };
    }
    if (path.startsWith('/playground/flashcards/')) {
      const deckId = path.substring('/playground/flashcards/'.length).split('/')[0];
      if (deckId && deckId !== 'new') return { type: 'flashcards_study', deckId };
    }
    if (path === '/playground/cbt/new') {
      return { type: 'cbt_new' };
    }
    if (path.startsWith('/playground/cbt/')) {
      const examId = path.substring('/playground/cbt/'.length).split('/')[0];
      if (examId && examId !== 'new') return { type: 'cbt_exam', examId };
    }
    return { type: 'home' };
  };

  const [viewState, setViewState] = useState<ViewState>(parsePathnameToViewState);

  // Sync window popstate / location
  useEffect(() => {
    const handlePopState = () => {
      setViewState(parsePathnameToViewState());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToView = useCallback((nextState: ViewState) => {
    setViewState(nextState);
    if (typeof window === 'undefined') return;
    let newPath = '/playground';
    if (nextState.type === 'past_viewer') {
      newPath = `/playground/past/${nextState.packId}`;
    } else if (nextState.type === 'flashcards_new') {
      newPath = '/playground/flashcards/new';
    } else if (nextState.type === 'flashcards_study') {
      newPath = `/playground/flashcards/${nextState.deckId}`;
    } else if (nextState.type === 'cbt_new') {
      newPath = `/playground/cbt/new`;
    } else if (nextState.type === 'cbt_exam') {
      newPath = `/playground/cbt/${nextState.examId}`;
    }
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
  }, []);

  // Update header based on view state
  useEffect(() => {
    if (!setCustomHeaderConfig) return;
    if (viewState.type === 'home') {
      setCustomHeaderConfig({
        title: 'Playground',
        hideProfileAvatar: false,
      });
    } else if (viewState.type === 'past_viewer') {
      setCustomHeaderConfig({
        title: 'Past Questions',
        leftActions: (
          <button
            onClick={() => navigateToView({ type: 'home' })}
            className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )
      });
    } else if (viewState.type === 'flashcards_new') {
      setCustomHeaderConfig({
        title: 'Generate Flashcards',
        leftActions: (
          <button
            onClick={() => navigateToView({ type: 'home' })}
            className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )
      });
    } else if (viewState.type === 'flashcards_study') {
      setCustomHeaderConfig({
        title: 'Study Deck',
        leftActions: (
          <button
            onClick={() => navigateToView({ type: 'home' })}
            className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )
      });
    } else if (viewState.type === 'cbt_new') {
      setCustomHeaderConfig({
        title: 'Generate CBT Exam',
        leftActions: (
          <button
            onClick={() => navigateToView({ type: 'home' })}
            className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )
      });
    } else if (viewState.type === 'cbt_exam') {
      setCustomHeaderConfig({
        title: 'CBT Exam',
        leftActions: (
          <button
            onClick={() => navigateToView({ type: 'home' })}
            className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Exit
          </button>
        )
      });
    }
  }, [viewState, setCustomHeaderConfig, navigateToView]);

  // ---------------------------------------------------------------------------
  // 1. HOME VIEW STATE & HELPERS
  // ---------------------------------------------------------------------------
  const [pastPacks, setPastPacks] = useState<PastQuestionPack[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeHomeTab, setActiveHomeTab] = useState<'past' | 'flashcards' | 'cbt'>('past');
  const [savedDecks, setSavedDecks] = useState<FlashcardDeck[]>([]);
  const [savedExams, setSavedExams] = useState<CBTExam[]>([]);

  useEffect(() => {
    getPastQuestionPacks().then(setPastPacks);
    if (userProfile?.uid) {
      getSavedFlashcardDecks(userProfile.uid).then(setSavedDecks);
      getSavedCBTExams(userProfile.uid).then(setSavedExams);
    }
  }, [userProfile?.uid]);

  const filteredPacks = useMemo(() => {
    if (!searchQuery.trim()) return pastPacks;
    const q = searchQuery.toLowerCase();
    return pastPacks.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.courseCode && p.courseCode.toLowerCase().includes(q)) ||
      (p.courseName && p.courseName.toLowerCase().includes(q))
    );
  }, [pastPacks, searchQuery]);

  // ---------------------------------------------------------------------------
  // 2. PAST QUESTION VIEWER STATE & THEORY DRAWER
  // ---------------------------------------------------------------------------
  const [currentPack, setCurrentPack] = useState<PastQuestionPack | null>(null);
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedMcqOptions, setSelectedMcqOptions] = useState<Record<string, string>>({}); // questionId -> selectedOptionId

  // Theory solution drawer state
  const [isTheoryDrawerOpen, setIsTheoryDrawerOpen] = useState(false);
  const [activeTheoryQuestion, setActiveTheoryQuestion] = useState<PastQuestion | null>(null);
  const [theorySolutionText, setTheorySolutionText] = useState('');
  const [isTheorySolving, setIsTheorySolving] = useState(false);
  const [theorySolutionError, setTheorySolutionError] = useState<string | null>(null);
  const [isCachedSolution, setIsCachedSolution] = useState(false);

  useEffect(() => {
    if (viewState.type === 'past_viewer') {
      getPastQuestionPackById(viewState.packId).then(pack => {
        setCurrentPack(pack);
        setActiveQuestionIdx(0);
        setSelectedMcqOptions({});
      });
    }
  }, [viewState]);

  const handleSolveTheoryQuestion = async (q: PastQuestion) => {
    if (!currentPack) return;
    setActiveTheoryQuestion(q);
    setIsTheoryDrawerOpen(true);
    setTheorySolutionError(null);
    setTheorySolutionText('');

    // 1. Check device cache first
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

    // 2. Uncached: Call AI & stream/generate step-by-step KaTeX solution
    setIsCachedSolution(false);
    setIsTheorySolving(true);

    if (userProfile?.uid) {
      const check = checkAICredits(userProfile.uid, 1);
      if (!check.hasCredits) {
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

      // Save to device cache so second Solve never calls AI
      await saveTheorySolution(currentPack.id, q.id, resultText);

      // Deduct credit once for uncached generation
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

  // ---------------------------------------------------------------------------
  // 3. GENERATE FLASHCARDS STATE
  // ---------------------------------------------------------------------------
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [courseTopicInput, setCourseTopicInput] = useState('');
  const [flashcardCount, setFlashcardCount] = useState(15);
  const [flashcardDifficulty, setFlashcardDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);

  // Active flashcard study deck state
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);

  useEffect(() => {
    if (viewState.type === 'flashcards_study' && userProfile?.uid) {
      getFlashcardDeckById(userProfile.uid, viewState.deckId).then(deck => {
        setActiveDeck(deck);
        setActiveCardIdx(0);
        setIsCardFlipped(false);
      });
    }
  }, [viewState, userProfile?.uid]);

  const handleGenerateFlashcards = async () => {
    if (!courseTopicInput.trim()) {
      addToast('Please enter a course or topic name.', 'error');
      return;
    }
    if (!userProfile?.uid) {
      addToast('Please log in to generate flashcards.', 'error');
      return;
    }

    const cost = getFeatureCost('flashcard_generation', appSettings) || 2;
    const check = checkAICredits(userProfile.uid, cost);
    if (!check.hasCredits) {
      addToast(`You need at least ${cost} AI credits to generate flashcards.`, 'error');
      return;
    }

    setIsGeneratingFlashcards(true);
    try {
      const ai = createAvelutAI(appSettings, userProfile);
      const prompt = `Generate a high-quality study flashcard deck of ${flashcardCount} cards on the topic: "${courseTopicInput.trim()}". Difficulty: ${flashcardDifficulty}.
Return strictly valid JSON with no markdown block markers:
{
  "title": "${courseTopicInput.trim()} Flashcards",
  "cards": [
    {
      "front": "Question or term on front side (use KaTeX math $...$ if relevant)",
      "back": "Clear concise answer or explanation on back side"
    }
  ]
}`;

      const response = await ai.generateContent(prompt);
      let jsonStr = (response.text || '').trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

      const parsed = JSON.parse(jsonStr.trim());
      const newDeck: FlashcardDeck = {
        id: `fc_${Date.now()}`,
        title: parsed.title || `${courseTopicInput.trim()} Deck`,
        topicName: courseTopicInput.trim(),
        cards: (parsed.cards || []).map((c: any, i: number) => ({
          id: `card_${i}`,
          front: c.front || '',
          back: c.back || ''
        })),
        createdAt: Date.now()
      };

      await saveFlashcardDeck(userProfile.uid, newDeck);
      await deductAICredits(userProfile.uid, cost, 'Flashcards Generation', appSettings);
      addToast('Flashcard deck created!', 'success');

      // Refresh saved decks list & view
      getSavedFlashcardDecks(userProfile.uid).then(setSavedDecks);
      navigateToView({ type: 'flashcards_study', deckId: newDeck.id });
    } catch (err: any) {
      console.error('Failed to generate flashcards:', err);
      addToast('Failed to generate flashcard deck. Please try again.', 'error');
    } finally {
      setIsGeneratingFlashcards(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 4. GENERATE CBT EXAM STATE & TEST TAKER
  // ---------------------------------------------------------------------------
  const [cbtTopicInput, setCbtTopicInput] = useState('');
  const [cbtQuestionCount, setCbtQuestionCount] = useState(10);
  const [cbtTimerMinutes, setCbtTimerMinutes] = useState(15);
  const [isGeneratingCBT, setIsGeneratingCBT] = useState(false);

  // CBT Exam taker state
  const [activeCBTExam, setActiveCBTExam] = useState<CBTExam | null>(null);
  const [cbtQuestionIdx, setCbtQuestionIdx] = useState(0);
  const [cbtUserAnswers, setCbtUserAnswers] = useState<Record<string, string>>({}); // questionId -> optionId
  const [cbtTimeRemainingSeconds, setCbtTimeRemainingSeconds] = useState<number | null>(null);
  const [cbtAttemptResult, setCbtAttemptResult] = useState<CBTAttempt | null>(null);
  const [isCbtSubmitted, setIsCbtSubmitted] = useState(false);

  useEffect(() => {
    if (viewState.type === 'cbt_exam' && userProfile?.uid) {
      getCBTExamById(userProfile.uid, viewState.examId).then(exam => {
        setActiveCBTExam(exam);
        setCbtQuestionIdx(0);
        setCbtUserAnswers({});
        setIsCbtSubmitted(false);
        setCbtAttemptResult(null);
        if (exam && exam.durationMinutes > 0) {
          setCbtTimeRemainingSeconds(exam.durationMinutes * 60);
        } else {
          setCbtTimeRemainingSeconds(null);
        }
      });
    }
  }, [viewState, userProfile?.uid]);

  // CBT Timer effect
  useEffect(() => {
    if (viewState.type !== 'cbt_exam' || isCbtSubmitted || cbtTimeRemainingSeconds === null) return;
    if (cbtTimeRemainingSeconds <= 0) {
      handleSubmitCBT();
      return;
    }
    const interval = setInterval(() => {
      setCbtTimeRemainingSeconds(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [viewState.type, isCbtSubmitted, cbtTimeRemainingSeconds]);

  const handleGenerateCBT = async () => {
    if (!cbtTopicInput.trim()) {
      addToast('Please enter a course or topic name for the exam.', 'error');
      return;
    }
    if (!userProfile?.uid) {
      addToast('Please log in to generate CBT exam.', 'error');
      return;
    }

    const cost = getFeatureCost('ai_quiz_generation', appSettings) || 3;
    const check = checkAICredits(userProfile.uid, cost);
    if (!check.hasCredits) {
      addToast(`You need at least ${cost} AI credits to generate a CBT exam.`, 'error');
      return;
    }

    setIsGeneratingCBT(true);
    try {
      const ai = createAvelutAI(appSettings, userProfile);
      const prompt = `Generate a CBT multiple choice exam of ${cbtQuestionCount} questions for topic: "${cbtTopicInput.trim()}".
Return strictly valid JSON with no markdown block markers:
{
  "title": "${cbtTopicInput.trim()} CBT Practice Exam",
  "questions": [
    {
      "id": "q1",
      "prompt": "Question text with KaTeX math $...$ if needed",
      "options": [
        { "id": "a", "text": "Option A" },
        { "id": "b", "text": "Option B" },
        { "id": "c", "text": "Option C" },
        { "id": "d", "text": "Option D" }
      ],
      "correctOptionId": "a",
      "explanation": "Brief explanation"
    }
  ]
}`;

      const response = await ai.generateContent(prompt);
      let jsonStr = (response.text || '').trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

      const parsed = JSON.parse(jsonStr.trim());
      const newExam: CBTExam = {
        id: `cbt_${Date.now()}`,
        title: parsed.title || `${cbtTopicInput.trim()} Exam`,
        topicName: cbtTopicInput.trim(),
        durationMinutes: cbtTimerMinutes,
        questions: (parsed.questions || []).map((q: any, i: number) => ({
          id: q.id || `q_${i}`,
          prompt: q.prompt || '',
          options: (q.options || []).map((o: any) => ({
            id: String(o.id || o.label || '').toLowerCase(),
            text: o.text || String(o)
          })),
          correctOptionId: String(q.correctOptionId || q.correct_option_id || 'a').toLowerCase(),
          explanation: q.explanation || ''
        })),
        createdAt: Date.now()
      };

      await saveCBTExam(userProfile.uid, newExam);
      await deductAICredits(userProfile.uid, cost, 'CBT Exam Generation', appSettings);
      addToast('CBT Exam generated successfully!', 'success');

      getSavedCBTExams(userProfile.uid).then(setSavedExams);
      navigateToView({ type: 'cbt_exam', examId: newExam.id });
    } catch (err: any) {
      console.error('Failed to generate CBT exam:', err);
      addToast('Failed to generate CBT exam. Please try again.', 'error');
    } finally {
      setIsGeneratingCBT(false);
    }
  };

  const handleSubmitCBT = async () => {
    if (!activeCBTExam || isCbtSubmitted) return;
    let score = 0;
    activeCBTExam.questions.forEach(q => {
      if (cbtUserAnswers[q.id] === q.correctOptionId) {
        score += 1;
      }
    });

    const attempt: CBTAttempt = {
      id: `att_${Date.now()}`,
      examId: activeCBTExam.id,
      answers: cbtUserAnswers,
      score,
      totalQuestions: activeCBTExam.questions.length,
      completedAt: Date.now()
    };

    if (userProfile?.uid) {
      await saveCBTAttempt(userProfile.uid, attempt);
    }
    setCbtAttemptResult(attempt);
    setIsCbtSubmitted(true);
    addToast(`CBT Submitted! Your score: ${score}/${activeCBTExam.questions.length}`, 'success');
  };

  const handleSharePayload = (title: string, summary: string) => {
    const textToShare = `${title}\n${summary}\nGenerated via Avelut Playground.`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToShare).then(() => {
        addToast('Copied summary to clipboard!', 'success');
      }).catch(() => {
        addToast('Sharing coming soon!', 'info');
      });
    } else {
      addToast('Sharing coming soon!', 'info');
    }
  };

  // Helper for Markdown + KaTeX
  const renderMarkdownText = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {formatLatexMath(text)}
    </ReactMarkdown>
  );

  // Format timer seconds into MM:SS
  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ===========================================================================
  // RENDER VIEWS
  // ===========================================================================

  // 1. PAST QUESTION VIEWER VIEW
  if (viewState.type === 'past_viewer') {
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
                      // Correct option is ALWAYS styled GREEN
                      optionStyle = "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-semibold";
                    } else if (isSelectedByOption) {
                      // Selected wrong option is styled RED
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
                      {hasAnswered && isCorrectOption && (
                        <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {hasAnswered && isSelectedByOption && !isCorrectOption && (
                        <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}

                {/* Explanation if answered */}
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

        {/* THEORY SOLUTION BOTTOM DRAWER */}
        {isTheoryDrawerOpen && (
          <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/75 backdrop-blur-sm animate-fade-in">
            <div
              className="fixed inset-0"
              onClick={() => setIsTheoryDrawerOpen(false)}
            />
            <div className="relative w-full max-w-3xl mx-auto bg-[#141414] border-t border-[#2A2A2A] rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl z-10 animate-slide-up">
              {/* Drawer Handle & Header */}
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

              {/* Solution Drawer Body */}
              <div className="p-5 sm:p-6 overflow-y-auto space-y-4">
                {isTheorySolving ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-semibold text-white">Generating step-by-step solution...</p>
                    <p className="text-xs text-[#A3A3A3]">Formulating KaTeX equations and explanations</p>
                  </div>
                ) : theorySolutionError ? (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex flex-col items-center text-center space-y-3">
                    <p>{theorySolutionError}</p>
                    <button
                      onClick={() => activeTheoryQuestion && handleSolveTheoryQuestion(activeTheoryQuestion)}
                      className="px-4 py-2 rounded-lg bg-rose-600 text-white font-bold text-xs"
                    >
                      Retry Generation
                    </button>
                  </div>
                ) : (
                  <div className="text-sm sm:text-base leading-relaxed text-[#FAFAFA] prose prose-invert max-w-none">
                    {renderMarkdownText(theorySolutionText)}
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-[#2A2A2A] bg-[#101010] flex items-center justify-between text-xs text-[#A3A3A3]">
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Saved on user device
                </span>
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
  }

  // 2. GENERATE FLASHCARDS VIEW
  if (viewState.type === 'flashcards_new') {
    return (
      <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-2xl mx-auto w-full">
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">Generate Study Flashcards</h1>
            <p className="text-xs text-[#A3A3A3] mt-1">
              AI creates a complete set of front/back revision cards for your course.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Course / Topic Name
              </label>
              <input
                type="text"
                placeholder="e.g. MTH 101 Calculus & Differentiation"
                value={courseTopicInput}
                onChange={e => setCourseTopicInput(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white placeholder-[#A3A3A3] text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Number of Cards: {flashcardCount}
              </label>
              <input
                type="range"
                min="5"
                max="30"
                step="5"
                value={flashcardCount}
                onChange={e => setFlashcardCount(Number(e.target.value))}
                className="w-full accent-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Difficulty Level
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['easy', 'medium', 'hard'] as const).map(diff => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setFlashcardDifficulty(diff)}
                    className={`py-2.5 rounded-xl border text-xs font-bold uppercase tracking-wider capitalize transition ${
                      flashcardDifficulty === diff
                        ? 'bg-[#2563EB] border-[#2563EB] text-white'
                        : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#A3A3A3] hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            disabled={isGeneratingFlashcards}
            onClick={handleGenerateFlashcards}
            className="w-full py-4 rounded-xl bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-2"
          >
            {isGeneratingFlashcards ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating Deck...</span>
              </>
            ) : (
              <span>Generate Flashcards</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // 3. STUDY FLASHCARDS DECK VIEW
  if (viewState.type === 'flashcards_study') {
    if (!activeDeck || !activeDeck.cards.length) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 text-neutral-400 dark:bg-[#0A0A0A]">
          Loading flashcard deck...
        </div>
      );
    }

    const currentCard = activeDeck.cards[activeCardIdx];

    return (
      <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-white">{activeDeck.title}</h1>
            <p className="text-xs text-[#A3A3A3]">Card {activeCardIdx + 1} of {activeDeck.cards.length}</p>
          </div>
          <button
            onClick={() => handleSharePayload(activeDeck.title, `Studying ${activeDeck.cards.length} cards`)}
            className="px-3.5 py-1.5 rounded-xl bg-[#2563EB] text-white font-bold text-xs flex items-center gap-1.5 shadow"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
        </div>

        {/* Flip Card Interactive Container */}
        <div
          onClick={() => setIsCardFlipped(prev => !prev)}
          className="flex-1 min-h-[320px] bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer shadow-lg transition transform active:scale-98 select-none mb-6 relative group"
        >
          <span className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-widest text-[#A3A3A3] bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
            {isCardFlipped ? 'Back (Answer)' : 'Front (Question)'}
          </span>

          <div className="text-lg sm:text-xl text-white font-medium max-w-xl">
            {renderMarkdownText(isCardFlipped ? currentCard.back : currentCard.front)}
          </div>

          <span className="mt-8 text-xs text-[#A3A3A3] group-hover:text-white transition">
            Tap card to flip
          </span>
        </div>

        {/* Card Controls */}
        <div className="flex items-center justify-between gap-4">
          <button
            disabled={activeCardIdx === 0}
            onClick={() => {
              setActiveCardIdx(prev => prev - 1);
              setIsCardFlipped(false);
            }}
            className="flex-1 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-sm font-bold text-white hover:bg-[#2A2A2A] disabled:opacity-40 transition"
          >
            Previous
          </button>
          <button
            disabled={activeCardIdx === activeDeck.cards.length - 1}
            onClick={() => {
              setActiveCardIdx(prev => prev + 1);
              setIsCardFlipped(false);
            }}
            className="flex-1 py-3 rounded-xl bg-[#2563EB] text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-40 transition shadow"
          >
            Next Card
          </button>
        </div>
      </div>
    );
  }

  // 4. GENERATE CBT EXAM VIEW
  if (viewState.type === 'cbt_new') {
    return (
      <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-2xl mx-auto w-full">
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">Generate CBT Practice Exam</h1>
            <p className="text-xs text-[#A3A3A3] mt-1">
              Create a timed computer-based test with instant grading and detailed explanations.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Course / Topic Name
              </label>
              <input
                type="text"
                placeholder="e.g. PHY 101 General Physics Mechanics"
                value={cbtTopicInput}
                onChange={e => setCbtTopicInput(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white placeholder-[#A3A3A3] text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                  Question Count
                </label>
                <select
                  value={cbtQuestionCount}
                  onChange={e => setCbtQuestionCount(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white text-sm focus:outline-none"
                >
                  <option value={5}>5 Questions</option>
                  <option value={10}>10 Questions</option>
                  <option value={15}>15 Questions</option>
                  <option value={20}>20 Questions</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                  Timer Limit
                </label>
                <select
                  value={cbtTimerMinutes}
                  onChange={e => setCbtTimerMinutes(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white text-sm focus:outline-none"
                >
                  <option value={5}>5 Minutes</option>
                  <option value={10}>10 Minutes</option>
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={0}>Untimed</option>
                </select>
              </div>
            </div>
          </div>

          <button
            disabled={isGeneratingCBT}
            onClick={handleGenerateCBT}
            className="w-full py-4 rounded-xl bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-2"
          >
            {isGeneratingCBT ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating Exam...</span>
              </>
            ) : (
              <span>Start CBT Exam</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // 5. CBT EXAM TAKER VIEW & REVIEW
  if (viewState.type === 'cbt_exam') {
    if (!activeCBTExam || !activeCBTExam.questions.length) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 text-neutral-400 dark:bg-[#0A0A0A]">
          Loading CBT exam...
        </div>
      );
    }

    const currentQ = activeCBTExam.questions[cbtQuestionIdx];

    // IF SUBMITTED: RESULT & REVIEW MODE
    if (isCbtSubmitted && cbtAttemptResult) {
      const percentage = Math.round((cbtAttemptResult.score / cbtAttemptResult.totalQuestions) * 100);

      return (
        <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
          {/* Score Header */}
          <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 text-center space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-[#A3A3A3]">Exam Results</span>
            <h1 className="text-2xl sm:text-3xl font-black text-white">{activeCBTExam.title}</h1>
            <div className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] text-xl font-bold">
              <span>Score:</span>
              <span className={percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}>
                {cbtAttemptResult.score} / {cbtAttemptResult.totalQuestions} ({percentage}%)
              </span>
            </div>
            <div>
              <button
                onClick={() => handleSharePayload(activeCBTExam.title, `Scored ${percentage}% (${cbtAttemptResult.score}/${cbtAttemptResult.totalQuestions})`)}
                className="px-4 py-2 rounded-xl bg-[#2563EB] text-white font-bold text-xs inline-flex items-center gap-1.5 shadow"
              >
                Share Score
              </button>
            </div>
          </div>

          {/* Question Review List */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Answer Review</h2>
            {activeCBTExam.questions.map((q, idx) => {
              const userSelectedId = cbtUserAnswers[q.id];
              const isCorrect = userSelectedId === q.correctOptionId;

              return (
                <div key={q.id} className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-bold uppercase text-[#A3A3A3]">Question {idx + 1}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      isCorrect ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>

                  <div className="text-sm sm:text-base font-medium text-white">
                    {renderMarkdownText(q.prompt)}
                  </div>

                  <div className="space-y-2 pt-2">
                    {q.options.map(opt => {
                      const isCorrectOpt = opt.id === q.correctOptionId;
                      const isUserSelected = opt.id === userSelectedId;

                      let style = "bg-[#1C1C1C] border-[#2A2A2A] text-[#A3A3A3]";
                      if (isCorrectOpt) {
                        style = "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-semibold";
                      } else if (isUserSelected && !isCorrectOpt) {
                        style = "bg-rose-500/10 border-rose-500/50 text-rose-400";
                      }

                      return (
                        <div key={opt.id} className={`p-3 rounded-xl border text-sm flex items-center justify-between ${style}`}>
                          <span>{opt.id.toUpperCase()}. {renderMarkdownText(opt.text)}</span>
                          {isCorrectOpt && <span className="text-xs font-bold text-emerald-400">Correct Answer</span>}
                          {isUserSelected && !isCorrectOpt && <span className="text-xs font-bold text-rose-400">Your Selection</span>}
                        </div>
                      );
                    })}
                  </div>

                  {q.explanation && (
                    <div className="p-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-xs text-[#A3A3A3]">
                      <span className="font-bold text-white block mb-1">Explanation:</span>
                      {renderMarkdownText(q.explanation)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-4">
            <button
              onClick={() => navigateToView({ type: 'home' })}
              className="w-full py-3.5 rounded-xl bg-[#2563EB] text-white font-bold text-sm shadow transition"
            >
              Back to Playground
            </button>
          </div>
        </div>
      );
    }

    // ACTIVE CBT TAKING VIEW
    return (
      <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-4xl mx-auto w-full">
        {/* Header with Timer */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-4 mb-6 flex items-center justify-between shadow-sm">
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white">{activeCBTExam.title}</h1>
            <p className="text-xs text-[#A3A3A3]">Question {cbtQuestionIdx + 1} of {activeCBTExam.questions.length}</p>
          </div>

          {cbtTimeRemainingSeconds !== null && (
            <div className="px-3.5 py-1.5 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-sm font-mono font-bold text-blue-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTimer(cbtTimeRemainingSeconds)}
            </div>
          )}
        </div>

        {/* Question Card */}
        <div className="flex-1 bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 flex flex-col justify-between mb-6 shadow-sm">
          <div>
            <div className="text-base sm:text-lg font-medium text-white mb-6">
              {renderMarkdownText(currentQ.prompt)}
            </div>

            <div className="space-y-3">
              {currentQ.options.map(opt => {
                const isSelected = cbtUserAnswers[currentQ.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setCbtUserAnswers(prev => ({ ...prev, [currentQ.id]: opt.id }))}
                    className={`w-full text-left p-4 rounded-xl border transition flex items-center gap-3 ${
                      isSelected
                        ? 'bg-[#2563EB]/10 border-[#2563EB] text-white font-semibold'
                        : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#FAFAFA] hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-[#2563EB] text-white' : 'bg-[#2A2A2A] text-[#FAFAFA]'
                    }`}>
                      {opt.id.toUpperCase()}
                    </span>
                    <span className="text-sm sm:text-base">{renderMarkdownText(opt.text)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between pt-6 border-t border-[#1C1C1C] mt-6">
            <button
              disabled={cbtQuestionIdx === 0}
              onClick={() => setCbtQuestionIdx(prev => prev - 1)}
              className="px-4 py-2 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-sm font-semibold text-white hover:bg-[#2A2A2A] disabled:opacity-40 transition"
            >
              Previous
            </button>

            {cbtQuestionIdx === activeCBTExam.questions.length - 1 ? (
              <button
                onClick={handleSubmitCBT}
                className="px-6 py-2.5 rounded-xl bg-[#2563EB] text-white font-bold text-sm hover:bg-blue-600 transition shadow"
              >
                Submit Exam
              </button>
            ) : (
              <button
                onClick={() => setCbtQuestionIdx(prev => prev + 1)}
                className="px-6 py-2.5 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white font-bold text-sm hover:bg-[#2A2A2A] transition"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // 6. DEFAULT PLAYGROUND HOME VIEW
  // ===========================================================================
  return (
    <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Top Half: Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Flashcards Generator Card */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-7 flex flex-col justify-between hover:border-[#3A3A3A] transition shadow-md group">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-white mb-4 group-hover:scale-105 transition">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Generate Flashcards</h2>
            <p className="text-xs sm:text-sm text-[#A3A3A3] mt-2 leading-relaxed">
              Create AI study decks for any course or topic. Save cards locally on device and study offline anytime.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1C1C1C] flex items-center justify-between">
            <span className="text-xs font-medium text-[#A3A3A3]">Interactive Study Cards</span>
            <button
              onClick={() => navigateToView({ type: 'flashcards_new' })}
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-bold tracking-wide uppercase transition shadow active:scale-95"
            >
              Generate Flashcards
            </button>
          </div>
        </div>

        {/* CBT Generator Card */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-7 flex flex-col justify-between hover:border-[#3A3A3A] transition shadow-md group">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-white mb-4 group-hover:scale-105 transition">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Generate CBT Exam</h2>
            <p className="text-xs sm:text-sm text-[#A3A3A3] mt-2 leading-relaxed">
              Practice timed multiple choice exams. Instant grading with green/red answer reviews and explanations.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1C1C1C] flex items-center justify-between">
            <span className="text-xs font-medium text-[#A3A3A3]">Computer-Based Tests</span>
            <button
              onClick={() => navigateToView({ type: 'cbt_new' })}
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-bold tracking-wide uppercase transition shadow active:scale-95"
            >
              Generate CBT
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Half: Past Questions & Saved Material Navigation */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#2A2A2A] pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveHomeTab('past')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'past'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Past Questions Catalog
            </button>
            <button
              onClick={() => setActiveHomeTab('flashcards')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'flashcards'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Saved Flashcards ({savedDecks.length})
            </button>
            <button
              onClick={() => setActiveHomeTab('cbt')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'cbt'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Saved CBT Exams ({savedExams.length})
            </button>
          </div>

          {activeHomeTab === 'past' && (
            <div className="w-full sm:w-64 relative">
              <input
                type="text"
                placeholder="Search course code or title..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#141414] border border-[#2A2A2A] text-xs text-white placeholder-[#A3A3A3] focus:outline-none focus:border-blue-500"
              />
              <svg className="w-4 h-4 text-[#A3A3A3] absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* TAB 1: PAST QUESTIONS LIST */}
        {activeHomeTab === 'past' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPacks.map(pack => (
              <div
                key={pack.id}
                onClick={() => navigateToView({ type: 'past_viewer', packId: pack.id })}
                className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#1C1C1C] border border-[#2A2A2A] text-blue-400">
                      {pack.courseCode || 'PAST Q'}
                    </span>
                    <span className="text-xs text-[#A3A3A3] font-medium">Year {pack.year || '2023'}</span>
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition leading-snug">
                    {pack.title}
                  </h3>
                </div>

                <div className="mt-5 pt-3 border-t border-[#1C1C1C] flex items-center justify-between text-xs text-[#A3A3A3]">
                  <span className="capitalize">{pack.type} Format</span>
                  <span className="font-semibold text-white">{pack.questionCount} Questions</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: SAVED FLASHCARDS DECKS */}
        {activeHomeTab === 'flashcards' && (
          <div>
            {savedDecks.length === 0 ? (
              <div className="py-12 text-center bg-[#141414] border border-[#2A2A2A] rounded-2xl">
                <p className="text-sm text-[#A3A3A3] mb-3">No saved flashcard decks found.</p>
                <button
                  onClick={() => navigateToView({ type: 'flashcards_new' })}
                  className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold"
                >
                  Generate Your First Deck
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedDecks.map(deck => (
                  <div
                    key={deck.id}
                    onClick={() => navigateToView({ type: 'flashcards_study', deckId: deck.id })}
                    className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-400 bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
                        Flashcards
                      </span>
                      <h3 className="text-base font-bold text-white mt-3 group-hover:text-blue-400 transition">
                        {deck.title}
                      </h3>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#1C1C1C] text-xs text-[#A3A3A3] flex justify-between">
                      <span>{deck.cards.length} Cards</span>
                      <span>{new Date(deck.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SAVED CBT EXAMS */}
        {activeHomeTab === 'cbt' && (
          <div>
            {savedExams.length === 0 ? (
              <div className="py-12 text-center bg-[#141414] border border-[#2A2A2A] rounded-2xl">
                <p className="text-sm text-[#A3A3A3] mb-3">No saved CBT practice exams found.</p>
                <button
                  onClick={() => navigateToView({ type: 'cbt_new' })}
                  className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold"
                >
                  Generate CBT Exam
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedExams.map(exam => (
                  <div
                    key={exam.id}
                    onClick={() => navigateToView({ type: 'cbt_exam', examId: exam.id })}
                    className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-400 bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
                        CBT Exam
                      </span>
                      <h3 className="text-base font-bold text-white mt-3 group-hover:text-blue-400 transition">
                        {exam.title}
                      </h3>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#1C1C1C] text-xs text-[#A3A3A3] flex justify-between">
                      <span>{exam.questions.length} Questions</span>
                      <span>{exam.durationMinutes > 0 ? `${exam.durationMinutes} Mins` : 'Untimed'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Playground;
