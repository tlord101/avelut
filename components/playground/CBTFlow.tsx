import { MarkdownContent } from '../MarkdownContent';
import React, { useState, useEffect } from 'react';
import { createAvelutAI } from '../../utils/inference';
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
    if (initialCourse) {
      setCbtTopicInput(initialCourse);
    }
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
      onExamCreated(newExam.id);
    } catch (err: any) {
      console.error('Failed to generate CBT exam:', err);
      addToast('Failed to generate CBT exam. Please try again.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

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
          {courses.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Select from Enrolled Courses
              </label>
              <select
                value={selectedCourseId}
                onChange={e => {
                  const cId = e.target.value;
                  setSelectedCourseId(cId);
                  const selected = courses.find(c => c.course_id === cId);
                  if (selected) {
                    setCbtTopicInput(`${selected.course_code}: ${selected.course_name}`);
                  }
                }}
                className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white text-sm focus:outline-none focus:border-blue-500 mb-3"
              >
                <option value="">-- Choose an academic course --</option>
                {courses.map(c => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_code ? `${c.course_code} - ` : ''}{c.course_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
              Topic or Subject
            </label>
            <input
              type="text"
              placeholder="e.g. Mechanics & Particle Dynamics"
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
          disabled={isGenerating}
          onClick={handleGenerate}
          className="w-full py-4 rounded-xl bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-2"
        >
          {isGenerating ? (
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
      <div className="flex-1 flex items-center justify-center p-8 text-neutral-400 dark:bg-[#0A0A0A]">
        Loading CBT exam...
      </div>
    );
  }

  const currentQ = activeCBTExam.questions[cbtQuestionIdx];

  if (isCbtSubmitted && cbtAttemptResult) {
    const percentage = Math.round((cbtAttemptResult.score / cbtAttemptResult.totalQuestions) * 100);

    return (
      <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 text-center space-y-3">
          <span className="text-xs font-bold uppercase tracking-widest text-[#A3A3A3]">Exam Results</span>
          <h1 className="text-2xl sm:text-3xl font-black text-white">{activeCBTExam.title}</h1>
          <div className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] text-xl font-bold">
            <span>Score:</span>
            <span className={percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}>
              {cbtAttemptResult.score} / {cbtAttemptResult.totalQuestions} ({percentage}%)
            </span>
          </div>
        </div>

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
                        <div>{opt.id.toUpperCase()}. {renderMarkdownText(opt.text)}</div>
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
            onClick={onExit}
            className="w-full py-3.5 rounded-xl bg-[#2563EB] text-white font-bold text-sm shadow transition"
          >
            Back to Playground
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-4xl mx-auto w-full">
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
                  <div className="text-sm sm:text-base min-w-0">{renderMarkdownText(opt.text)}</div>
                </button>
              );
            })}
          </div>
        </div>

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
};
