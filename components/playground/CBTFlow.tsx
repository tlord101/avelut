import { MarkdownContent } from '../MarkdownContent';
import React, { useState, useEffect, useRef } from 'react';
import { createAvelutAI, getResponseText } from '../../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../../utils/usage';
import { useToast } from '../../hooks/useToast';
import type { UserProfile, AppSettings } from '../../types';
import type { CBTExam, CBTAttempt } from '../../types/playground';
import {
  saveCBTExam,
  getCBTExamById,
  saveCBTAttempt
} from '../../services/playgroundStorageService';

import { supabaseDataService } from '../../services/supabaseDataService';
import type { Course } from '../../types';

export interface CBTNewProps {
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  initialCourse?: string;
  onExamCreated: (examId: string) => void;
}

export const CBTNew: React.FC<CBTNewProps> = ({
  userProfile,
  appSettings,
  initialCourse,
  onExamCreated
}) => {
  const { addToast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [cbtTopicInput, setCbtTopicInput] = useState(initialCourse || '');
  const [cbtQuestionCount, setCbtQuestionCount] = useState(10);
  const [cbtTimerMinutes, setCbtTimerMinutes] = useState(15);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    supabaseDataService.fetchCourses(userProfile?.department_id, userProfile?.level).then(dbCourses => {
      if (dbCourses) setCourses(dbCourses);
    });
  }, [userProfile?.department_id, userProfile?.level]);

  useEffect(() => {
    if (initialCourse) setCbtTopicInput(initialCourse);
  }, [initialCourse]);

  const handleGenerate = async () => {
    if (!cbtTopicInput.trim()) {
      addToast('Please enter a course or topic name for the exam.', 'error');
      return;
    }
    if (!userProfile?.uid) {
      addToast('Please log in to generate CBT exam.', 'error');
      return;
    }

    const cost = getFeatureCost('ai_quiz_generation', appSettings) || 3;
    const check = checkAICredits(userProfile, cost, appSettings);
    if (!check.allowed) {
      addToast(`You need at least ${cost} AI credits to generate a CBT exam.`, 'error');
      return;
    }

    setIsGenerating(true);
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

      const response = await ai.models.generateContent({ contents: prompt });
      let jsonStr = (getResponseText(response) || '').trim();
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
      onExamCreated(newExam.id);
    } catch (err: any) {
      console.error('Failed to generate CBT exam:', err);
      addToast('Failed to generate CBT exam. Please try again.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 bg-[#0A0A0A] min-h-screen flex flex-col items-center justify-start p-4 sm:p-6 pt-6">
      {/* Header */}
      <div className="w-full max-w-lg mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">CBT Practice Exam</h1>
            <p className="text-xs text-[#A3A3A3]">AI-generated timed multiple choice test</p>
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-lg bg-[#111] border border-[#222] rounded-3xl overflow-hidden shadow-2xl">
        {/* Top accent strip */}
        <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" />

        <div className="p-6 space-y-5">
          {/* Course picker */}
          {courses.length > 0 && (
            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-widest text-[#A3A3A3]">
                Enrolled Courses
              </label>
              <select
                value={selectedCourseId}
                onChange={e => {
                  const cId = e.target.value;
                  setSelectedCourseId(cId);
                  const selected = courses.find(c => c.course_id === cId);
                  if (selected) setCbtTopicInput(`${selected.course_code}: ${selected.course_name}`);
                }}
                className="w-full px-4 py-3.5 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all appearance-none"
              >
                <option value="">— Choose a course —</option>
                {courses.map(c => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_code ? `${c.course_code} – ` : ''}{c.course_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Topic input */}
          <div className="space-y-2">
            <label className="block text-[11px] font-black uppercase tracking-widest text-[#A3A3A3]">
              Topic or Subject
            </label>
            <input
              type="text"
              placeholder="e.g. Mechanics & Particle Dynamics"
              value={cbtTopicInput}
              onChange={e => setCbtTopicInput(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#555] text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all"
            />
          </div>

          {/* Config row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-widest text-[#A3A3A3]">Questions</label>
              <select
                value={cbtQuestionCount}
                onChange={e => setCbtQuestionCount(Number(e.target.value))}
                className="w-full px-4 py-3.5 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-blue-500 transition-all"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-widest text-[#A3A3A3]">Timer</label>
              <select
                value={cbtTimerMinutes}
                onChange={e => setCbtTimerMinutes(Number(e.target.value))}
                className="w-full px-4 py-3.5 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm focus:outline-none focus:border-blue-500 transition-all"
              >
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={0}>Untimed</option>
              </select>
            </div>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-semibold text-[#A3A3A3]">
              📝 {cbtQuestionCount} Questions
            </span>
            <span className="px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-semibold text-[#A3A3A3]">
              ⏱ {cbtTimerMinutes > 0 ? `${cbtTimerMinutes} min` : 'Untimed'}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-xs font-semibold text-blue-400">
              🤖 AI Generated
            </span>
          </div>

          {/* Generate button */}
          <button
            disabled={isGenerating}
            onClick={handleGenerate}
            className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50 text-white font-black text-sm shadow-lg shadow-blue-600/20 transition-all duration-200 flex items-center justify-center gap-2.5 mt-2"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Generating Exam...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Start CBT Exam</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface CBTExamTakerProps {
  examId: string;
  userProfile?: UserProfile;
  onExit: () => void;
}

export const CBTExamTaker: React.FC<CBTExamTakerProps> = ({ examId, userProfile, onExit }) => {
  const { addToast } = useToast();
  const [activeCBTExam, setActiveCBTExam] = useState<CBTExam | null>(null);
  const [cbtQuestionIdx, setCbtQuestionIdx] = useState(0);
  const [cbtUserAnswers, setCbtUserAnswers] = useState<Record<string, string>>({});
  const [cbtTimeRemainingSeconds, setCbtTimeRemainingSeconds] = useState<number | null>(null);
  const [cbtAttemptResult, setCbtAttemptResult] = useState<CBTAttempt | null>(null);
  const [isCbtSubmitted, setIsCbtSubmitted] = useState(false);
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (userProfile?.uid) {
      getCBTExamById(userProfile.uid, examId).then(exam => {
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
  }, [examId, userProfile?.uid]);

  useEffect(() => {
    if (isCbtSubmitted || cbtTimeRemainingSeconds === null) return;
    if (cbtTimeRemainingSeconds <= 0) {
      handleSubmitCBT();
      return;
    }
    const interval = setInterval(() => {
      setCbtTimeRemainingSeconds(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isCbtSubmitted, cbtTimeRemainingSeconds]);

  const handleSubmitCBT = async () => {
    if (!activeCBTExam || isCbtSubmitted) return;
    let score = 0;
    activeCBTExam.questions.forEach(q => {
      if (cbtUserAnswers[q.id] === q.correctOptionId) score += 1;
    });

    const attempt: CBTAttempt = {
      id: `att_${Date.now()}`,
      examId: activeCBTExam.id,
      answers: cbtUserAnswers,
      score,
      totalQuestions: activeCBTExam.questions.length,
      completedAt: Date.now()
    };

    if (userProfile?.uid) await saveCBTAttempt(userProfile.uid, attempt);
    setCbtAttemptResult(attempt);
    setIsCbtSubmitted(true);
    addToast(`CBT Submitted! Score: ${score}/${activeCBTExam.questions.length}`, 'success');
  };

  const navigateTo = (idx: number) => {
    setAnimatingIdx(idx);
    setTimeout(() => {
      setCbtQuestionIdx(idx);
      setAnimatingIdx(null);
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
  };

  const renderMarkdownText = (text: string) => (
    <div className="dark min-w-0"><MarkdownContent content={text} className="[&>p]:my-0" /></div>
  );

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!activeCBTExam || !activeCBTExam.questions.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-[#0A0A0A]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#A3A3A3]">Loading exam...</p>
        </div>
      </div>
    );
  }

  const currentQ = activeCBTExam.questions[cbtQuestionIdx];
  const answeredCount = Object.keys(cbtUserAnswers).length;
  const progress = (cbtQuestionIdx + 1) / activeCBTExam.questions.length;
  const isTimeLow = cbtTimeRemainingSeconds !== null && cbtTimeRemainingSeconds < 60;

  // ─── RESULTS VIEW ────────────────────────────────────────────────────────────
  if (isCbtSubmitted && cbtAttemptResult) {
    const percentage = Math.round((cbtAttemptResult.score / cbtAttemptResult.totalQuestions) * 100);
    const isPassing = percentage >= 50;
    const circumference = 2 * Math.PI * 44;
    const strokeDash = (percentage / 100) * circumference;

    return (
      <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-5">
        {/* Score Card */}
        <div className="bg-[#111] border border-[#222] rounded-3xl p-6 text-center relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" />
          <p className="text-xs font-black uppercase tracking-widest text-[#A3A3A3] mb-3">Exam Results</p>
          <h1 className="text-base sm:text-lg font-black text-white mb-5 leading-tight">{activeCBTExam.title}</h1>

          {/* Score ring */}
          <div className="flex justify-center mb-4">
            <div className="relative w-28 h-28">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#1a1a1a" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="44" fill="none"
                  stroke={isPassing ? '#10b981' : '#ef4444'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${strokeDash} ${circumference}`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-black ${isPassing ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {percentage}%
                </span>
                <span className="text-xs text-[#A3A3A3] font-semibold">
                  {cbtAttemptResult.score}/{cbtAttemptResult.totalQuestions}
                </span>
              </div>
            </div>
          </div>

          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${isPassing ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'}`}>
            {isPassing ? '🎉 Passed' : '📚 Needs Review'}
          </div>
        </div>

        {/* Review */}
        <div className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-[#A3A3A3] px-1">Answer Review</h2>
          {activeCBTExam.questions.map((q, idx) => {
            const userSelectedId = cbtUserAnswers[q.id];
            const isCorrect = userSelectedId === q.correctOptionId;

            return (
              <div key={q.id} className="bg-[#111] border border-[#222] rounded-2xl p-5 space-y-3 transition-all hover:border-[#333]">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-black text-[#555] uppercase tracking-wider">Q{idx + 1}</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isCorrect ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'}`}>
                    {isCorrect ? '✓ Correct' : '✗ Incorrect'}
                  </span>
                </div>

                <div className="text-sm font-medium text-white">{renderMarkdownText(q.prompt)}</div>

                <div className="space-y-1.5 pt-1">
                  {q.options.map(opt => {
                    const isCorrectOpt = opt.id === q.correctOptionId;
                    const isUserSelected = opt.id === userSelectedId;
                    let style = "bg-[#181818] border-[#2a2a2a] text-[#A3A3A3]";
                    if (isCorrectOpt) style = "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-semibold";
                    else if (isUserSelected && !isCorrectOpt) style = "bg-rose-500/10 border-rose-500/40 text-rose-300";

                    return (
                      <div key={opt.id} className={`p-3 rounded-xl border text-sm flex items-center justify-between gap-2 ${style}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="shrink-0 text-xs font-black opacity-60">{opt.id.toUpperCase()}.</span>
                          <div className="min-w-0">{renderMarkdownText(opt.text)}</div>
                        </div>
                        {isCorrectOpt && <span className="shrink-0 text-[10px] font-black text-emerald-400 uppercase tracking-wide">✓ Correct</span>}
                        {isUserSelected && !isCorrectOpt && <span className="shrink-0 text-[10px] font-black text-rose-400 uppercase tracking-wide">Your pick</span>}
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <div className="p-3 rounded-xl bg-[#181818] border border-[#2a2a2a] text-xs text-[#A3A3A3] leading-relaxed">
                    <span className="font-black text-white block mb-1 text-[11px] uppercase tracking-wide">Explanation</span>
                    {renderMarkdownText(q.explanation)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={onExit}
          className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-black text-sm shadow-lg shadow-blue-600/20 transition-all"
        >
          Back to Playground
        </button>
      </div>
    );
  }

  // ─── EXAM TAKER VIEW ─────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen max-w-2xl mx-auto w-full">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur-sm border-b border-[#1a1a1a]">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#555] mb-0.5">CBT Exam</p>
              <h1 className="text-sm font-black text-white truncate">{activeCBTExam.title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Answered badge */}
              <span className="px-2.5 py-1 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-bold text-[#A3A3A3]">
                {answeredCount}/{activeCBTExam.questions.length}
              </span>
              {/* Timer */}
              {cbtTimeRemainingSeconds !== null && (
                <div className={`px-3 py-1.5 rounded-xl border text-sm font-mono font-black flex items-center gap-1.5 transition-colors ${isTimeLow ? 'bg-rose-500/10 border-rose-500/40 text-rose-400 animate-pulse' : 'bg-[#1a1a1a] border-[#2a2a2a] text-blue-400'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatTimer(cbtTimeRemainingSeconds)}
                </div>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-[#1a1a1a] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-[#555] font-semibold mt-1.5">Question {cbtQuestionIdx + 1} of {activeCBTExam.questions.length}</p>
        </div>
      </div>

      {/* Scrollable Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {/* Question Card */}
        <div
          className={`bg-[#111] border border-[#222] rounded-3xl p-5 sm:p-6 transition-all duration-200 ${animatingIdx !== null ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}
        >
          <div className="flex items-start gap-3 mb-5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-black text-blue-400">{cbtQuestionIdx + 1}</span>
            </div>
            <div className="text-base sm:text-lg font-semibold text-white leading-relaxed min-w-0">
              {renderMarkdownText(currentQ.prompt)}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2.5">
            {currentQ.options.map((opt, oi) => {
              const isSelected = cbtUserAnswers[currentQ.id] === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setCbtUserAnswers(prev => ({ ...prev, [currentQ.id]: opt.id }))}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-150 flex items-center gap-3 active:scale-[0.99] group ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500/60 shadow-sm shadow-blue-500/10'
                      : 'bg-[#181818] border-[#2a2a2a] hover:bg-[#1e1e1e] hover:border-[#333]'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-xl text-xs font-black flex items-center justify-center shrink-0 transition-all duration-150 ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-[#252525] text-[#A3A3A3] group-hover:bg-[#2a2a2a]'
                  }`}>
                    {opt.id.toUpperCase()}
                  </span>
                  <div className={`text-sm sm:text-base min-w-0 font-medium leading-relaxed transition-colors ${isSelected ? 'text-white' : 'text-[#ccc]'}`}>
                    {renderMarkdownText(opt.text)}
                  </div>
                  {isSelected && (
                    <svg className="w-4 h-4 text-blue-400 shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Question grid navigator */}
        <div className="bg-[#111] border border-[#222] rounded-2xl p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#555] mb-3">Question Navigator</p>
          <div className="flex flex-wrap gap-2">
            {activeCBTExam.questions.map((q, idx) => {
              const isAnswered = !!cbtUserAnswers[q.id];
              const isCurrent = idx === cbtQuestionIdx;
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

      {/* Bottom Nav */}
      <div className="sticky bottom-0 bg-[#0A0A0A]/95 backdrop-blur-sm border-t border-[#1a1a1a] px-4 py-3 safe-area-bottom">
        <div className="flex items-center gap-3">
          <button
            disabled={cbtQuestionIdx === 0}
            onClick={() => navigateTo(cbtQuestionIdx - 1)}
            className="flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] text-sm font-bold text-white hover:bg-[#222] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </button>

          <div className="flex-1" />

          {cbtQuestionIdx === activeCBTExam.questions.length - 1 ? (
            <button
              onClick={handleSubmitCBT}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] text-white font-black text-sm shadow-lg shadow-emerald-600/20 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Submit Exam
            </button>
          ) : (
            <button
              onClick={() => navigateTo(cbtQuestionIdx + 1)}
              className="flex items-center gap-1.5 px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] text-white font-black text-sm shadow-lg shadow-blue-600/20 transition-all"
            >
              Next
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
