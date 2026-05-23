import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, set, push, get, serverTimestamp } from 'firebase/database';
import type { UserProfile, Question, ExamHistoryItem, ExamQuestionResult, UserProgress, Course } from '../types';
import { useToast } from '../hooks/useToast';

declare var __app_id: string;
// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const TIME_PER_QUESTION_SECONDS = 30;

const mockCourses = [
  { id: 'math_algebra_1', name: 'Math - Algebra 1' },
  { id: 'science_biology', name: 'Science - Biology' },
  { id: 'history_us', name: 'History - U.S. History' },
];

const getCourseNameById = (id: string) => {
    return mockCourses.find(c => c.id === id)?.name || 'your department';
}

const LoadingSpinner: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center text-center p-8">
    <svg className="w-12 h-12 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <p className="mt-4 text-gray-600">{text}</p>
  </div>
);


const ExamHistory: React.FC<{ userProfile: UserProfile, onReview: (exam: ExamHistoryItem) => void }> = ({ userProfile, onReview }) => {
    const [history, setHistory] = useState<ExamHistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const historyRef = dbRef(db, `exam_history/${userProfile.uid}`);
        
        setIsLoading(true);
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
            } else {
                setHistory([]);
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
        <div className="space-y-4">
            {history.map(exam => (
                <div key={exam.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex justify-between items-center">
                    <div>
                        <p className="font-semibold text-gray-900">{getCourseNameById(exam.department_id)}</p>
                        <p className="text-sm text-gray-600">
                            {new Date(exam.timestamp).toLocaleString()}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-lime-600">{exam.score}/{exam.total_questions}</p>
                        <button onClick={() => onReview(exam)} className="text-sm text-lime-600 hover:underline">Review</button>
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
  const [completedTopicNames, setCompletedTopicNames] = useState<string[]>([]);
  const [availablePQSubjects, setAvailablePQSubjects] = useState<string[]>([]);
  const [selectedPQSubject, setSelectedPQSubject] = useState<string>('');
  const [isTopicDataLoading, setIsTopicDataLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const { addToast } = useToast();

  useEffect(() => {
    // Check for available subjects (courses) in Past Questions FOR THE USER'S DEPT AND LEVEL
    const pqRef = dbRef(db, `past_questions/${userProfile.department_id}/${userProfile.level}`);
    get(pqRef).then(snap => {
        if(snap.exists()) {
            setAvailablePQSubjects(Object.keys(snap.val()));
        } else {
            setAvailablePQSubjects([]);
        }
    });
  }, [userProfile.department_id, userProfile.level]);

  const userAnswersRef = useRef(userAnswers);
  useEffect(() => { userAnswersRef.current = userAnswers; }, [userAnswers]);
  
  const scoreRef = useRef(score);
  useEffect(() => { scoreRef.current = score; }, [score]);

  useEffect(() => {
    const fetchCompletedTopics = async () => {
        setIsTopicDataLoading(true);
        const completedTopicIds = Object.keys(userProgress).filter(
            topicId => userProgress[topicId]?.is_complete
        );

        if (completedTopicIds.length === 0) {
            setCompletedTopicNames([]);
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
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: `Generate 10 multiple-choice questions for a student studying "${getCourseNameById(userProfile.department_id)}" at a "${userProfile.level}" level, focusing on the following topics they have completed: ${completedTopicNames.join(', ')}. Ensure the options are distinct and the correct answer is one of the options.`,
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

      const responseData = JSON.parse(response.text);
      if (responseData.questions && responseData.questions.length > 0) {
        const newQuestions = responseData.questions;
        setQuestions(newQuestions);
        setTimeLeft(newQuestions.length * TIME_PER_QUESTION_SECONDS);
        setExamState('in_progress');
      } else {
        throw new Error("Failed to generate valid questions from AI response.");
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

  const currentQuestion = questions[currentQuestionIndex];
  
  const renderContent = () => {
    switch (examState) {
      case 'generating':
        return <LoadingSpinner text="Generating your exam based on completed topics..." />;
      
      case 'in_progress':
        return (
          <div>
            <div className="flex justify-between items-center mb-4">
                <p className="text-gray-500">Question {currentQuestionIndex + 1} of {questions.length}</p>
                <div className="flex items-center gap-2 font-mono text-lg font-bold bg-gray-100 px-3 py-1 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>
                        {Math.floor(timeLeft / 60)}:{('0' + (timeLeft % 60)).slice(-2)}
                    </span>
                </div>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mt-2">{currentQuestion.question}</h3>
            <div className="space-y-3 mt-4">
              {currentQuestion.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => !feedback && setSelectedOption(option)}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-all duration-200 text-gray-900
                    ${feedback ? 
                        (option === currentQuestion.correctAnswer ? 'bg-green-100 border-green-500' : (option === selectedOption ? 'bg-red-100 border-red-500' : 'bg-white border-gray-200'))
                        : 
                        (selectedOption === option ? 'bg-lime-100 border-lime-500' : 'bg-white border-gray-200 hover:border-lime-400')
                    }`}
                  disabled={!!feedback}
                >
                  {option}
                </button>
              ))}
            </div>
            {feedback && (
                <div className={`mt-4 p-4 rounded-lg ${feedback.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                    <h4 className={`font-bold ${feedback.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                        {feedback.isCorrect ? 'Correct!' : 'Incorrect'}
                    </h4>
                    <p className="text-sm text-gray-700 mt-1">{feedback.explanation}</p>
                </div>
            )}
            <div className="mt-6">
                {feedback ? (
                    <button onClick={handleNextQuestion} className="w-full bg-lime-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-lime-700 transition-colors">
                        {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Exam'}
                    </button>
                ) : (
                    <button onClick={handleAnswerSubmit} disabled={!selectedOption} className="w-full bg-lime-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-lime-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        Submit Answer
                    </button>
                )}
            </div>
          </div>
        );
      
      case 'completed':
          const xpEarned = score * 10;
        return (
          <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-900">Exam Completed!</h3>
            <p className="text-gray-600 mt-2">Here's how you did:</p>
            <div className="my-6">
              <p className="text-5xl font-bold text-lime-600">{score} / {questions.length}</p>
              <p className="mt-2 text-lg font-semibold text-gray-800">+{xpEarned} XP Earned</p>
            </div>
            <div className="flex gap-4">
                <button onClick={() => setExamState('history')} className="flex-1 bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors">
                    View History
                </button>
                <button onClick={resetExam} className="flex-1 bg-lime-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-lime-700 transition-colors">
                    Take Another Exam
                </button>
            </div>
          </div>
        );

      case 'history':
          return (
              <div>
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-bold text-gray-900">Exam History</h3>
                      <button onClick={resetExam} className="text-lime-600 hover:underline">Back to Exam</button>
                  </div>
                  <ExamHistory userProfile={userProfile} onReview={(exam) => { setReviewExam(exam); setExamState('review'); }} />
              </div>
          );

      case 'review':
        if (!reviewExam) return null;
          return (
              <div>
                  <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">Reviewing Exam</h3>
                        <p className="text-sm text-gray-600">{new Date(reviewExam.timestamp).toLocaleString()}</p>
                      </div>
                      <button onClick={() => setExamState('history')} className="text-lime-600 hover:underline">Back to History</button>
                  </div>
                  <div className="space-y-6">
                      {reviewExam.questions.map((q, index) => (
                          <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                              <p className="text-gray-500 text-sm">Question {index + 1}</p>
                              <p className="font-semibold text-gray-800 mt-1">{q.question}</p>
                              <div className="mt-3 space-y-2 text-sm">
                                  <p><span className="font-semibold text-gray-600">Your Answer: </span><span className={q.isCorrect ? 'text-green-600' : 'text-red-600'}>{q.userAnswer}</span></p>
                                  {!q.isCorrect && <p><span className="font-semibold text-gray-600">Correct Answer: </span><span className="text-green-600">{q.correctAnswer}</span></p>}
                                  <p className="text-gray-600 pt-2 border-t border-gray-200 mt-2">{q.explanation}</p>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          );
      
      default: // 'start'
        if (isTopicDataLoading) {
            return (
                <LoadingSpinner text="Checking your completed topics..." />
            );
        }
        
        const canStartExam = completedTopicNames.length > 0;

        return (
          <div className="max-w-2xl mx-auto w-full text-center space-y-8 py-8">
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
                        className="w-full mt-6 bg-lime-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-lime-700 transition-colors"
                    >
                        Start AI Exam
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
                
                {availablePQSubjects.length > 0 ? (
                  <div className="mt-6 space-y-3">
                    <select 
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500"
                      onChange={(e) => setSelectedPQSubject(e.target.value)}
                      value={selectedPQSubject}
                    >
                      <option value="">Select Subject</option>
                      {availablePQSubjects.map(s => (
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
                    No past questions available yet for your course.
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