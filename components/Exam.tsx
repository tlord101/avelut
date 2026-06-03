import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { createVanTutorAI } from '../utils/inference';
import { Type } from '@google/genai';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, set, push, get, serverTimestamp } from 'firebase/database';
import type { UserProfile, Question, ExamHistoryItem, ExamQuestionResult, UserProgress, Course } from '../types';
import { useToast } from '../hooks/useToast';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { CheckIcon } from './icons/CheckIcon';
import { XIcon } from './icons/XIcon';
import { ListIcon } from './icons/ListIcon';
import { LogoIcon } from './icons/LogoIcon';

declare var __app_id: string;

const TIME_PER_QUESTION_SECONDS = 30;

const mockCourses = [
  { id: 'math_algebra_1', name: 'Math - Algebra 1' },
  { id: 'science_biology', name: 'Science - Biology' },
  { id: 'history_us', name: 'History - U.S. History' },
];

const getCourseNameById = (id: string) => {
    return mockCourses.find(c => c.id === id)?.name || 'your department';
}

const sanitizePromptInput = (value: string): string =>
  value.replace(/[^a-zA-Z0-9 ,.\-_/()]/g, ' ').replace(/\s+/g, ' ').trim();

const LoadingSpinner: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center text-center p-8">
    <LogoIcon className="w-12 h-12 loader-logo" />
    <p className="mt-4 text-gray-600">{text}</p>
  </div>
);


const ExamHistory: React.FC<{ userProfile: UserProfile, onReview: (exam: ExamHistoryItem) => void }> = ({ userProfile, onReview }) => {
    const [history, setHistory] = useState<ExamHistoryItem[]>(() => {
        return readCachedJson<ExamHistoryItem[]>(`vantutor_exam_history_${userProfile.uid}`, []);
    });
    const [isLoading, setIsLoading] = useState(() => {
        const cached = readCachedJson<ExamHistoryItem[]>(`vantutor_exam_history_${userProfile.uid}`, []);
        return cached.length === 0;
    });

    useEffect(() => {
        const historyRef = dbRef(db, `exam_history/${userProfile.uid}`);
        const cacheKey = `vantutor_exam_history_${userProfile.uid}`;
        const cached = readCachedJson<ExamHistoryItem[]>(cacheKey, []);
        if (cached.length === 0) {
            setIsLoading(true);
        }
        const unsubscribe = onValue(historyRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // RTDB returns an object, we want an array sorted by timestamp descending
                const historyList: ExamHistoryItem[] = Object.values(data);
                historyList.sort((a, b) => {
                    const timeA = typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp as any)?.seconds * 1000 || 0;
                    const timeB = typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp as any)?.seconds * 1000 || 0;
                    return timeB - timeA;
                });
                setHistory(historyList);
                writeCachedJson(cacheKey, historyList);
            } else {
                setHistory([]);
                writeCachedJson(cacheKey, []);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching exam history: ", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [userProfile.uid]);

    if (isLoading) {
        return <LoadingSpinner text="Loading exam history..." />;
    }

    if (history.length === 0) {
        return <p className="text-gray-500 text-center">You haven't completed any exams yet.</p>;
    }

    return (
        <div className="space-y-3">
            {history.map(exam => (
                <div key={exam.id} className="group bg-white p-5 rounded-[2rem] border border-gray-100 flex justify-between items-center transition-all hover:shadow-xl hover:-translate-y-1">
                    <div className="flex gap-4 items-center">
                        <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center text-lime-600">
                             <GraduationCapIcon className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-xs font-black text-gray-900 uppercase tracking-tight">{getCourseNameById(exam.department_id)}</p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                {new Date(exam.timestamp).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    <div className="text-right flex items-center gap-4">
                        <p className="font-black text-lime-600 text-lg">{exam.score}/{exam.total_questions}</p>
                        <button 
                            onClick={() => onReview(exam)} 
                            className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:text-lime-600 hover:bg-lime-50 transition-all active:scale-95"
                        >
                            <ChevronDownIcon className="w-5 h-5 -rotate-90" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};


interface ExamProps {
  userProfile: UserProfile;
  userProgress: UserProgress;
}

export const Exam: React.FC<ExamProps> = ({ userProfile, userProgress }) => {
  const [examState, setExamState] = useState<'start' | 'generating' | 'in_progress' | 'completed' | 'history' | 'review'>('start');
  const [examMode, setExamMode] = useState<'ai' | 'pq'>('ai');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation: string } | null>(null);
  const [score, setScore] = useState(0);
  const [reviewExam, setReviewExam] = useState<ExamHistoryItem | null>(null);
  const [completedTopicNames, setCompletedTopicNames] = useState<string[]>(() => {
    return readCachedJson<string[]>(`vantutor_completed_topics_${userProfile.uid}`, []);
  });
  const [availablePQSubjects, setAvailablePQSubjects] = useState<string[]>(() => {
    return readCachedJson<string[]>(`vantutor_pq_subjects_${userProfile.department_id}_${userProfile.level}`, []);
  });
  const [selectedPQSubject, setSelectedPQSubject] = useState<string>('');
  const [isTopicDataLoading, setIsTopicDataLoading] = useState(() => {
    const cached = readCachedJson<string[]>(`vantutor_completed_topics_${userProfile.uid}`, []);
    return cached.length === 0;
  });
  const [timeLeft, setTimeLeft] = useState(0);
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();
  const { settings: appSettings } = useAppSettings();
  const geminiModel = appSettings.primary_gemini_model;
  const ai = useMemo(() => createVanTutorAI(appSettings, userProfile), [appSettings, userProfile]);
  const isGeminiConfigured = Boolean(ai);

  useEffect(() => {
    const cacheKey = `vantutor_pq_subjects_${userProfile.department_id}_${userProfile.level}`;
    const pqRef = dbRef(db, `past_questions/${userProfile.department_id}/${userProfile.level}`);
    get(pqRef).then(snap => {
        if(snap.exists()) {
            const subjects = Object.keys(snap.val());
            setAvailablePQSubjects(subjects);
            writeCachedJson(cacheKey, subjects);
        } else {
            setAvailablePQSubjects([]);
            writeCachedJson(cacheKey, []);
        }
    }).catch(err => {
        console.error("Failed to fetch PQ subjects:", err);
    });
  }, [userProfile.department_id, userProfile.level]);

  const userAnswersRef = useRef(userAnswers);
  useEffect(() => { userAnswersRef.current = userAnswers; }, [userAnswers]);
  
  const scoreRef = useRef(score);
  useEffect(() => { scoreRef.current = score; }, [score]);

  useEffect(() => {
    const fetchCompletedTopics = async () => {
        const completedTopicIds = Object.keys(userProgress).filter(
            topicId => userProgress[topicId]?.is_complete
        );

        if (completedTopicIds.length === 0) {
            setCompletedTopicNames([]);
            writeCachedJson(`vantutor_completed_topics_${userProfile.uid}`, []);
            setIsTopicDataLoading(false);
            return;
        }
        
        try {
            const snapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
            const departmentData = snapshot.val();

            if (departmentData) {
                const courses: Course[] = departmentData.course_list || [];
                const topicNames: string[] = [];
                courses.forEach(course => {
                    course.topics?.forEach(topic => {
                        if (completedTopicIds.includes(topic.topic_id)) {
                            topicNames.push(topic.topic_name);
                        }
                    });
                });
                setCompletedTopicNames(topicNames);
                writeCachedJson(`vantutor_completed_topics_${userProfile.uid}`, topicNames);
            }
        } catch (error) {
            console.error("Error fetching department data for exam generation:", error);
            addToast("Could not load topic data to create your exam.", 'error');
        } finally {
            setIsTopicDataLoading(false);
        }
    };

    fetchCompletedTopics();
  }, [userProgress, userProfile.department_id, addToast]);

  const startPQExam = async (courseName: string) => {
    setExamState('generating');
    try {
        const pqRef = dbRef(db, `past_questions/${userProfile.department_id}/${userProfile.level}/${courseName}`);
        const snapshot = await get(pqRef);
        if(!snapshot.exists()) throw new Error("No questions found for this course.");
        
        const yearsData = snapshot.val();
        let allQuestions: Question[] = [];
        Object.keys(yearsData).forEach(year => {
            const yearQuestions = Object.values(yearsData[year]) as Question[];
            allQuestions = [...allQuestions, ...yearQuestions];
        });

        if(allQuestions.length === 0) throw new Error("Question bank is empty.");

        // Randomly pick 10 questions
        const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 10);
        
        setQuestions(selected);
        setUserAnswers(new Array(selected.length).fill(''));
        setCurrentQuestionIndex(0);
        setScore(0);
        setTimeLeft(selected.length * 60); // 1 min per question
        setExamState('in_progress');
        setExamMode('pq');
    } catch (err: any) {
        console.error("Failed to start PQ exam:", err);
        addToast(err.message || "Failed to load past questions.", 'error');
        setExamState('start');
    }
  };

  const finishExam = useCallback(async () => {
      setExamState(currentState => {
          if (currentState !== 'in_progress') {
              return currentState; // Prevent multiple submissions
          }

          const currentScore = scoreRef.current;
          const currentAnswers = userAnswersRef.current;
          
          const filledUserAnswers = [...currentAnswers];
          while (filledUserAnswers.length < questions.length) {
              filledUserAnswers.push("Unanswered");
          }

          const examResult = {
              user_id: userProfile.uid,
              department_id: userProfile.department_id,
              score: currentScore,
              total_questions: questions.length,
              timestamp: Date.now(),
              questions: questions.map((q, i) => ({
                  ...q,
                  userAnswer: filledUserAnswers[i],
                  isCorrect: filledUserAnswers[i] === q.correctAnswer,
              })),
          };

          const saveResults = async () => {
              try {
                  const examHistoryRef = push(dbRef(db, `exam_history/${userProfile.uid}`));
                  await set(examHistoryRef, examResult);

                  const notificationRef = push(dbRef(db, `notifications/${userProfile.uid}`));
                  const notificationData = {
                      type: 'exam_reminder',
                      title: 'Exam Finished!',
                      message: `You scored ${currentScore}/${questions.length}!`,
                      is_read: false,
                      timestamp: serverTimestamp(),
                  };
                  await set(notificationRef, notificationData);
              } catch (error) {
                  console.error("Failed to save exam results:", error);
                  addToast("Could not save your exam results.", 'error');
              }
          };

          saveResults();
          setFeedback(null);
          setSelectedOption(null);
          
          return 'completed';
      });
  }, [questions, userProfile.department_id, userProfile.uid, addToast]);

  useEffect(() => {
      if (examState !== 'in_progress' || timeLeft <= 0) {
          return;
      }
      const timerId = setInterval(() => {
          setTimeLeft(prevTime => prevTime - 1);
      }, 1000);
      return () => clearInterval(timerId);
  }, [examState, timeLeft]);

  useEffect(() => {
      if (timeLeft <= 0 && examState === 'in_progress') {
          finishExam();
      }
  }, [timeLeft, examState, finishExam]);


  const generateQuestions = async () => {
    setExamState('generating');
    try {
      if (!ai) {
        throw new Error('Gemini API key is not configured in App Controls.');
      }
      const safeDepartment = sanitizePromptInput(getCourseNameById(userProfile.department_id));
      const safeLevel = sanitizePromptInput(userProfile.level);
      const safeTopics = completedTopicNames.map((topicName, index) => {
        const sanitizedTopic = sanitizePromptInput(topicName);
        return sanitizedTopic || `Topic ${index + 1}`;
      });

      const result = await attemptApiCall(async () => {
        const response = await ai.models.generateContent({
          model: geminiModel,
          contents: [{ role: 'user', parts: [{ text: `Generate 10 multiple-choice questions for a student studying "${safeDepartment}" at a "${safeLevel}" level, focusing on the following topics they have completed: ${safeTopics.join(', ')}. Ensure the options are distinct and the correct answer is one of the options.` }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctAnswer: { type: Type.STRING },
                      explanation: { type: Type.STRING }
                    },
                    required: ['question', 'options', 'correctAnswer', 'explanation']
                  }
                }
              }
            }
          }
        });

        if (!response.text) {
          throw new Error('AI returned an empty response while generating exam questions.');
        }
        const responseData = JSON.parse(response.text);
        if (!(responseData.questions && responseData.questions.length > 0)) {
          throw new Error("Failed to generate valid questions from AI response.");
        }
        const newQuestions = responseData.questions;
        setQuestions(newQuestions);
        setTimeLeft(newQuestions.length * TIME_PER_QUESTION_SECONDS);
        setExamState('in_progress');
      });

      if (!result.success) {
        addToast(result.message, 'error');
        setExamState('start');
        return;
      }
    } catch (error: any) {
      console.error("Error generating exam questions:", error);
      addToast(error.message || "Sorry, we couldn't create an exam for you right now. Please try again in a moment.", 'error');
      setExamState('start');
    }
  };
  
  const resetExam = () => {
    setQuestions([]);
    setUserAnswers([]);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setFeedback(null);
    setScore(0);
    setExamState('start');
    setTimeLeft(0);
  };

  const handleAnswerSubmit = async () => {
    if (!selectedOption) return;

    const currentQuestion = questions[currentQuestionIndex];
    const isCorrect = selectedOption === currentQuestion.correctAnswer;
    
    setUserAnswers(prev => [...prev, selectedOption]);

    if (isCorrect) {
      setScore(prev => prev + 1);
    }
    setFeedback({ isCorrect, explanation: currentQuestion.explanation });
  };
  
  const handleNextQuestion = async () => {
    if (currentQuestionIndex < questions.length - 1) {
      setFeedback(null);
      setSelectedOption(null);
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      finishExam();
    }
  };

  const renderContent = () => {
    switch (examState) {
      case 'generating':
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="relative mb-12">
                    <div className="absolute inset-0 bg-lime-400 rounded-full blur-2xl opacity-20 animate-pulse"></div>
                    <LoadingSpinner text="" />
                </div>
                <h3 className="text-2xl font-black text-gray-900 tracking-tighter mb-2">Assembling your Exam...</h3>
                <p className="text-sm font-bold text-gray-400 uppercase tracking-widest animate-pulse text-center max-w-xs">{extractionProgress || 'Gemini is selecting questions based on your mastery'}</p>
            </div>
        );
      
      case 'in_progress':
        return (
          <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center bg-gray-50/50 p-4 rounded-[2rem] border border-gray-100">
                <div className="px-4">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Question</p>
                    <p className="text-lg font-black text-gray-900">{currentQuestionIndex + 1} <span className="text-gray-300 mx-1">/</span> {questions.length}</p>
                </div>
                
                <div className="flex items-center gap-3 bg-white px-6 py-3 rounded-2xl shadow-sm ring-1 ring-gray-100">
                    <div className={`w-2 h-2 rounded-full animate-pulse ${timeLeft < 30 ? 'bg-red-500' : 'bg-lime-500'}`}></div>
                    <span className={`font-black text-xl tracking-tighter tabular-nums ${timeLeft < 30 ? 'text-red-500' : 'text-gray-900'}`}>
                        {Math.floor(timeLeft / 60)}:{('0' + (timeLeft % 60)).slice(-2)}
                    </span>
                </div>
            </div>

            <div className="space-y-6">
                <h3 className="text-2xl md:text-3xl font-black text-gray-900 leading-[1.1] tracking-tight">{currentQuestion.question}</h3>
                
                <div className="grid grid-cols-1 gap-3">
                {currentQuestion.options.map((option, index) => {
                    const isSelected = selectedOption === option;
                    const isCorrect = option === currentQuestion.correctAnswer;
                    
                    let variantClasses = "bg-white border-gray-100 hover:border-lime-200 hover:bg-lime-50/30";
                    if (feedback) {
                        if (isCorrect) variantClasses = "bg-lime-50 border-lime-500 text-lime-900 ring-4 ring-lime-500/10";
                        else if (isSelected) variantClasses = "bg-red-50 border-red-500 text-red-900 ring-4 ring-red-500/10";
                        else variantClasses = "bg-white border-gray-50 opacity-40";
                    } else if (isSelected) {
                        variantClasses = "bg-lime-600 border-lime-600 text-white shadow-xl shadow-lime-600/20";
                    }

                    return (
                        <button
                        key={index}
                        onClick={() => !feedback && setSelectedOption(option)}
                        className={`group w-full text-left p-6 rounded-[2rem] border-2 transition-all duration-300 flex items-center gap-4 ${variantClasses}`}
                        disabled={!!feedback}
                        >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-black text-xs transition-colors ${
                            isSelected && !feedback ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400 group-hover:bg-lime-100 group-hover:text-lime-600'
                        }`}>
                            {String.fromCharCode(65 + index)}
                        </div>
                        <span className="font-bold text-sm md:text-base leading-snug">{option}</span>
                        </button>
                    );
                })}
                </div>
            </div>

            {feedback && (
                <div className={`p-8 rounded-[2.5rem] animate-in zoom-in-95 duration-300 ${feedback.isCorrect ? 'bg-lime-50 border border-lime-100' : 'bg-red-50 border border-red-100'}`}>
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`p-2 rounded-xl ${feedback.isCorrect ? 'bg-lime-500 text-white' : 'bg-red-500 text-white'}`}>
                            {feedback.isCorrect ? <CheckIcon className="w-5 h-5" /> : <XIcon className="w-5 h-5" />}
                        </div>
                        <h4 className={`text-lg font-black uppercase tracking-tight ${feedback.isCorrect ? 'text-lime-700' : 'text-red-700'}`}>
                            {feedback.isCorrect ? 'Genius Move!' : 'Not Quite...'}
                        </h4>
                    </div>
                    <p className={`text-sm font-bold leading-relaxed ${feedback.isCorrect ? 'text-lime-800/70' : 'text-red-800/70'}`}>{feedback.explanation}</p>
                </div>
            )}

            <div className="pt-4">
                {feedback ? (
                    <button 
                        onClick={handleNextQuestion} 
                        className="w-full flex items-center justify-center gap-3 bg-gray-900 text-white font-black py-6 rounded-[2rem] hover:bg-black transition-all transform active:scale-[0.98] shadow-2xl shadow-black/10 text-xs uppercase tracking-widest"
                    >
                        {currentQuestionIndex < questions.length - 1 ? 'Next Challenge' : 'See Results'}
                        <ChevronDownIcon className="w-5 h-5 -rotate-90" />
                    </button>
                ) : (
                    <button 
                        onClick={handleAnswerSubmit} 
                        disabled={!selectedOption} 
                        className="w-full bg-lime-600 text-white font-black py-6 rounded-[2rem] hover:bg-lime-700 transition-all transform active:scale-[0.98] disabled:opacity-30 disabled:grayscale shadow-2xl shadow-lime-600/20 text-xs uppercase tracking-widest"
                    >
                        Lock in Answer
                    </button>
                )}
            </div>
          </div>
        );
      
      case 'completed':
          const xpEarned = score * 10;
          const percentage = Math.round((score / questions.length) * 100);
        return (
          <div className="max-w-md mx-auto text-center space-y-10 py-10 animate-in zoom-in-95 duration-500">
            <div className="relative inline-block">
                <div className="absolute inset-0 bg-lime-400 rounded-full blur-3xl opacity-20 animate-pulse"></div>
                <div className="relative w-48 h-48 rounded-full border-8 border-gray-50 flex flex-col items-center justify-center bg-white shadow-3xl">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Score</p>
                    <p className="text-6xl font-black text-gray-900 tracking-tighter">{score}</p>
                    <div className="h-px w-12 bg-gray-100 my-2"></div>
                    <p className="text-sm font-black text-lime-600 uppercase tracking-widest">{questions.length} total</p>
                </div>
            </div>

            <div>
                <h3 className="text-4xl font-black text-gray-900 tracking-tighter mb-2">
                    {percentage >= 80 ? 'Masterfully Done.' : percentage >= 50 ? 'Strong effort.' : 'Keep studying.'}
                </h3>
                <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">You earned +{xpEarned} XP for your progress</p>
            </div>

            <div className="flex flex-col gap-3">
                <button onClick={resetExam} className="w-full bg-lime-600 text-white font-black py-5 rounded-[2rem] hover:bg-lime-700 transition-all shadow-xl shadow-lime-600/20 text-xs uppercase tracking-widest">
                    Start New Training
                </button>
                <button onClick={() => setExamState('history')} className="w-full bg-white text-gray-400 font-black py-5 rounded-[2rem] border border-gray-100 hover:text-gray-900 hover:bg-gray-50 transition-all text-xs uppercase tracking-widest">
                    View Performance History
                </button>
            </div>
          </div>
        );

      case 'history':
          return (
              <div className="max-w-3xl mx-auto space-y-8 py-8 animate-in fade-in duration-500">
                  <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-3xl font-black text-gray-900 tracking-tighter leading-none mb-2">Exam History</h3>
                        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">Your previous performance</p>
                      </div>
                      <button 
                        onClick={resetExam} 
                        className="p-4 rounded-2xl bg-white text-lime-600 border border-gray-100 shadow-sm hover:bg-lime-50 transition-all active:scale-95"
                      >
                         <XIcon className="w-5 h-5" />
                      </button>
                  </div>
                  <ExamHistory userProfile={userProfile} onReview={(exam) => { setReviewExam(exam); setExamState('review'); }} />
              </div>
          );

      case 'review':
        if (!reviewExam) return null;
          return (
              <div className="max-w-3xl mx-auto space-y-10 py-8 animate-in slide-in-from-right-8 duration-500">
                  <div className="flex justify-between items-center bg-gray-900 text-white p-8 rounded-[2.5rem] shadow-2xl">
                      <div>
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-2">Reviewing Session</p>
                        <h3 className="text-2xl font-black tracking-tighter leading-none">{getCourseNameById(reviewExam.department_id)}</h3>
                        <p className="text-xs font-bold text-white/60 mt-2 uppercase tracking-widest">{new Date(reviewExam.timestamp).toLocaleDateString()}</p>
                      </div>
                      <button 
                        onClick={() => setExamState('history')} 
                        className="bg-white/10 hover:bg-white/20 p-4 rounded-2xl transition-colors text-white"
                      >
                        <XIcon className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="space-y-6">
                      {reviewExam.questions.map((q, index) => (
                          <div key={index} className="group bg-white p-8 rounded-[2.5rem] border border-gray-100 hover:shadow-xl transition-all duration-500">
                              <div className="flex justify-between items-start mb-6">
                                  <div>
                                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1">Observation {index + 1}</p>
                                      <h4 className="text-xl font-black text-gray-900 leading-tight pr-8">{q.question}</h4>
                                  </div>
                                  <div className={`p-2 rounded-xl shrink-0 ${q.isCorrect ? 'bg-lime-50 text-lime-600' : 'bg-red-50 text-red-600'}`}>
                                      {q.isCorrect ? <CheckIcon className="w-5 h-5" /> : <XIcon className="w-5 h-5" />}
                                  </div>
                              </div>
                              
                              <div className="space-y-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div className={`p-5 rounded-2xl ${q.isCorrect ? 'bg-lime-50/50 border border-lime-100' : 'bg-red-50/50 border border-red-100'}`}>
                                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Your Answer</p>
                                          <p className={`text-sm font-black ${q.isCorrect ? 'text-lime-700' : 'text-red-700'}`}>{q.userAnswer}</p>
                                      </div>
                                      {!q.isCorrect && (
                                          <div className="p-5 rounded-2xl bg-gray-50 border border-gray-100">
                                              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Correct Answer</p>
                                              <p className="text-sm font-black text-gray-900">{q.correctAnswer}</p>
                                          </div>
                                      )}
                                  </div>
                                  
                                  <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100/50">
                                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Explanation</p>
                                      <p className="text-sm font-bold text-gray-600 leading-relaxed">{q.explanation}</p>
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          );
      
      default: // 'start'
        if (isTopicDataLoading) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <LoadingSpinner text="" />
                    <p className="mt-8 text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">Syncing topic data...</p>
                </div>
            );
        }
        
        const canStartExam = completedTopicNames.length > 0;

        return (
          <div className="max-w-4xl mx-auto w-full text-center space-y-12 py-12 animate-in fade-in zoom-in-95 duration-700">
            <h3 className="text-2xl font-bold text-gray-900">Ready for your exam?</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* AI Generated Exam */}
              <div className="bg-white border-2 border-lime-100 rounded-2xl p-6 hover:border-lime-500 transition-all text-left flex flex-col">
                <div className="w-12 h-12 bg-lime-100 rounded-xl flex items-center justify-center text-lime-600 mb-4 font-bold text-xl">
                    AI
                </div>
                <h4 className="text-lg font-bold text-gray-900">Adaptive AI Quiz</h4>
                <p className="text-sm text-gray-600 mt-2 flex-grow">
                    Practice with AI-generated questions based specifically on the topics you've recently covered.
                </p>
                {canStartExam ? (
                    <button
                        onClick={generateQuestions}
                        disabled={!isGeminiConfigured}
                        className="w-full mt-6 bg-lime-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-lime-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isGeminiConfigured ? 'Start AI Exam' : 'AI Exam Unavailable (Missing API Key)'}
                    </button>
                ) : (
                    <div className="mt-6 text-xs text-yellow-800 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                        Complete at least one topic in the Study Guide.
                    </div>
                )}
              </div>

              {/* Past Questions Exam */}
              <div className="bg-white border-2 border-purple-100 rounded-2xl p-6 hover:border-purple-500 transition-all text-left flex flex-col">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 mb-4">
                  <GraduationCapIcon className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-bold text-gray-900">Past Question Mock</h4>
                <p className="text-sm text-gray-600 mt-2 flex-grow">
                  Test yourself with real past questions uploaded by administrators for your course.
                </p>
                
                 {availablePQSubjects.filter(s => {
                  if (userProfile?.subscription_status === 'premium' || userProfile?.is_admin) return true;
                  if (!userProfile?.selected_free_course_id) return false;
                  const subjectNormalized = s.toLowerCase().replace(/[\s_]/g, '');
                  const selectedNormalized = userProfile.selected_free_course_id.toLowerCase().replace(/[\s_]/g, '');
                  return subjectNormalized === selectedNormalized;
                }).length > 0 ? (
                  <div className="mt-6 space-y-3">
                    <select 
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500"
                      onChange={(e) => setSelectedPQSubject(e.target.value)}
                      value={selectedPQSubject}
                    >
                      <option value="">Select Subject</option>
                      {availablePQSubjects.filter(s => {
                        if (userProfile?.subscription_status === 'premium' || userProfile?.is_admin) return true;
                        if (!userProfile?.selected_free_course_id) return false;
                        const subjectNormalized = s.toLowerCase().replace(/[\s_]/g, '');
                        const selectedNormalized = userProfile.selected_free_course_id.toLowerCase().replace(/[\s_]/g, '');
                        return subjectNormalized === selectedNormalized;
                      }).map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ').toUpperCase()}</option>
                      ))}
                    </select>
                    <button
                        onClick={() => selectedPQSubject && startPQExam(selectedPQSubject)}
                        disabled={!selectedPQSubject}
                        className="w-full bg-purple-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                        Start Mock Exam
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-100 italic">
                    {!userProfile?.selected_free_course_id && userProfile?.subscription_status !== 'premium'
                      ? 'Please unlock a free course in the Study Guide first to access past question mock exams.'
                      : 'No past questions available yet for your unlocked course.'}
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={() => setExamState('history')} 
              className="inline-flex items-center text-gray-600 font-semibold hover:text-lime-600 transition-colors mt-8"
            >
              <ListIcon className="w-5 h-5 mr-2" />
              View Exam History
            </button>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col w-full bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
      {renderContent()}
    </div>
  );
};