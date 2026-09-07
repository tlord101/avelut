import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TeachingBoardPerformance,
  TeachingQuestion,
  StudentAnswerEvaluation,
  LiveBoardElement,
  FinalTest,
  FinalTestQuestion,
  TeachingStructure,
} from '../../types/teachingScript';
import { TeachingEngineService } from '../../services/teachingEngineService';
import { BoardStateManager } from '../../services/boardStateManager';
import { TeachingBoard } from './live-teaching/TeachingBoard';
import { QuestionOverlay } from './live-teaching/QuestionOverlay';
import { LecturerAskModal } from './live-teaching/LecturerAskModal';
import { LiveTutorialVoiceSelectorModal } from './LiveTutorialVoiceSelectorModal';
import { unifiedVoiceRouter } from '../../services/voice/UnifiedVoiceRouter';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../hooks/useToast';
import {
  topicKeyFromTitle,
  getLiveTeachingProgress,
  getSavedTeachingStructure,
  saveLiveTeachingProgress,
  formatResumeLabel,
} from '../../services/liveTeachingProgressService';
import type { LessonDurationMode } from './LessonDurationModal';

export interface TeachingEngineSessionViewProps {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  initialVoice?: string;
  onClose?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
  userId?: string;
  userProfile?: any;
  appSettings?: any;
  durationMode?: LessonDurationMode;
  startBoardIndex?: number;
  resumeInfo?: any;
}

/** Minimum reading pause duration (ms) after speech ends before auto-advancing (at least 2 minutes per board) */
const KEY_POINT_PAUSE_MS = 120000;

export const TeachingEngineSessionView: React.FC<TeachingEngineSessionViewProps> = ({
  topicTitle,
  courseName = 'Academic Course',
  syllabusContext,
  initialVoice = 'Altair',
  onClose,
  setCustomHeaderConfig,
  userId,
  userProfile,
  appSettings: propAppSettings,
  durationMode,
  startBoardIndex = 0,
  resumeInfo,
}) => {
  const { settings: hookAppSettings } = useAppSettings();
  const resolvedAppSettings = propAppSettings || hookAppSettings;
  const { addToast } = useToast();

  const [currentVoice, setCurrentVoice] = useState<string>(initialVoice);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showAskModal, setShowAskModal] = useState(false);
  const [isProcessingAsk, setIsProcessingAsk] = useState(false);
  const [isAnsweringOnBoard, setIsAnsweringOnBoard] = useState(false);

  const engineRef = useRef<TeachingEngineService | null>(null);
  const boardManagerRef = useRef<BoardStateManager>(new BoardStateManager());
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingBoardRef = useRef(false);
  const savedBoardRef = useRef<LiveBoardElement[] | null>(null);

  const [structure, setStructure] = useState<TeachingStructure | null>(null);
  const [currentBoardPerf, setCurrentBoardPerf] = useState<TeachingBoardPerformance | null>(null);
  const [boardIndex, setBoardIndex] = useState(startBoardIndex);
  const [totalBoards, setTotalBoards] = useState(5);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Planning live lesson structure…');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);

  const [boardElements, setBoardElements] = useState<LiveBoardElement[]>([]);
  const [activeHighlights, setActiveHighlights] = useState<Set<string>>(new Set());
  const [activeCircles, setActiveCircles] = useState<Set<string>>(new Set());
  const [activeUnderlines, setActiveUnderlines] = useState<Set<string>>(new Set());
  const [tutorPointer, setTutorPointer] = useState<{ x: number; y: number; active: boolean; color?: string } | null>(null);

  const [activeQuestion, setActiveQuestion] = useState<TeachingQuestion | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [evaluationFeedback, setEvaluationFeedback] = useState<StudentAnswerEvaluation | null>(null);
  const [completedBoardTitles, setCompletedBoardTitles] = useState<string[]>([]);

  // Final Test State
  const [finalTest, setFinalTest] = useState<FinalTest | null>(null);
  const [isGeneratingTest, setIsGeneratingTest] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);

  const startBoardIndexRef = useRef(startBoardIndex);
  startBoardIndexRef.current = startBoardIndex;
  const boardIndexRef = useRef(boardIndex);
  boardIndexRef.current = boardIndex;
  const totalBoardsRef = useRef(totalBoards);
  totalBoardsRef.current = totalBoards;
  const completedTitlesRef = useRef(completedBoardTitles);
  completedTitlesRef.current = completedBoardTitles;
  const activeQuestionRef = useRef(activeQuestion);
  activeQuestionRef.current = activeQuestion;
  const boardElementsRef = useRef(boardElements);
  boardElementsRef.current = boardElements;
  const isGeneratingTestRef = useRef(isGeneratingTest);
  isGeneratingTestRef.current = isGeneratingTest;
  const currentBoardPerfRef = useRef(currentBoardPerf);
  currentBoardPerfRef.current = currentBoardPerf;

  useEffect(() => {
    const manager = boardManagerRef.current;
    const unsub = manager.subscribe((state) => {
      setBoardElements(Array.from(state.elements.values()));
      setActiveHighlights(new Set(state.activeHighlights));
      setActiveCircles(new Set(state.activeCircles));
      setActiveUnderlines(new Set(state.activeUnderlines));
    });
    return unsub;
  }, []);

  const handleNextBoard = useCallback(async () => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    if (!engineRef.current || isLoadingBoardRef.current) return;

    const nextIdx = boardIndexRef.current + 1;
    if (nextIdx >= totalBoardsRef.current) {
      // Last board complete! Clear board and start final test
      boardManagerRef.current.clearBoard();
      setIsGeneratingTest(true);
      setStatusMessage('Preparing your final mini test…');
      addToast('Lesson boards complete! Generating mini test…', 'info');
      await engineRef.current.generateFinalTest();
      setIsGeneratingTest(false);
      return;
    }

    isLoadingBoardRef.current = true;
    setBoardIndex(nextIdx);
    setIsLoading(true);
    setStatusMessage(`Writing Board ${nextIdx + 1} of ${totalBoardsRef.current}…`);
    setActiveQuestion(null);
    setEvaluationFeedback(null);
    setIsAudioReady(false);

    // Hard reset board elements between boards
    boardManagerRef.current.clearBoard();

    if (currentBoardPerf?.title) {
      setCompletedBoardTitles((prev) => [...prev, currentBoardPerf.title]);
    }

    await engineRef.current.loadBoardPerformance({
      boardIndex: nextIdx,
      completedBoardsSummary: completedTitlesRef.current,
    });
    isLoadingBoardRef.current = false;
  }, [addToast, currentBoardPerf]);

  const handleNextBoardRef = useRef(handleNextBoard);
  handleNextBoardRef.current = handleNextBoard;

  useEffect(() => {
    const engine = new TeachingEngineService(resolvedAppSettings, userProfile || null, currentVoice);
    engineRef.current = engine;
    const manager = boardManagerRef.current;
    isLoadingBoardRef.current = true;

    const topicKey = topicKeyFromTitle(topicTitle, courseName);
    const resolvedUserId = userId || userProfile?.uid || 'anon';

    const unsubscribe = engine.subscribe({
      onStructureLoaded: (struct) => {
        setStructure(struct);
        if (struct.boards && struct.boards.length > 0) {
          setTotalBoards(struct.boards.length);
          setStatusMessage(`Writing Board 1 of ${struct.boards.length}…`);
          if (durationMode != null) {
            saveLiveTeachingProgress(resolvedUserId, {
              topicKey,
              topicTitle,
              courseName,
              durationMode,
              boardIndex: 0,
              totalBoards: struct.boards.length,
              structure: struct,
              isCompleted: false,
            });
          }
          engine.loadBoardPerformance({
            boardIndex: 0,
            completedBoardsSummary: [],
          });
        }
      },
      onBoardLoaded: (perf) => {
        isLoadingBoardRef.current = false;
        setCurrentBoardPerf(perf);
        setIsLoading(false);
        setStatusMessage('');
        setIsAudioReady(false);

        manager.clearBoard();
        engine.playBoardSpeech(perf);
      },
      onAudioPlaybackStateChanged: (playing) => {
        setIsSpeaking(playing);
        if (playing) setIsAudioReady(true);

        if (!playing && isAnsweringOnBoard) {
          setIsAnsweringOnBoard(false);
          const snap = savedBoardRef.current;
          savedBoardRef.current = null;
          manager.clearBoard();
          if (snap && snap.length) {
            snap.forEach((el) => {
              if (el.type === 'svg') {
                manager.applyAction({
                  id: el.id,
                  type: 'draw',
                  position: el.position,
                  metadata: {
                    primitive: 'custom_svg',
                    svgContent: el.svgContent,
                  },
                });
              } else if (el.type === 'text' || el.type === 'formula') {
                manager.applyAction({
                  id: el.id,
                  type: 'write',
                  content: el.content,
                  position: el.position,
                  metadata: {
                    latex: el.latex,
                    fontSize: el.fontSize as any,
                    color: el.color,
                  },
                });
              }
            });
          }
          setIsAudioReady(true);
          setTimeout(() => engineRef.current?.resumeLesson(), 600);
          return;
        }

        // Calculate intelligent reading pause after speech finishes
        if (
          !playing &&
          !activeQuestionRef.current &&
          !isLoadingBoardRef.current &&
          !showAskModal &&
          !isGeneratingTestRef.current
        ) {
          if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);

          const perf = currentBoardPerfRef.current;
          const hasFormulaOrCalculation = perf?.board_actions?.some(
            (a) => a.metadata?.latex || a.content?.includes('=')
          );
          const readingPauseMs = hasFormulaOrCalculation ? KEY_POINT_PAUSE_MS + 2500 : KEY_POINT_PAUSE_MS;

          autoContinueTimerRef.current = setTimeout(() => {
            handleNextBoardRef.current();
          }, readingPauseMs);
        }
      },
      onBoardActionTriggered: (action) => {
        manager.applyAction(action);
        if (action.position) {
          setTutorPointer({ x: action.position.x, y: action.position.y, active: true, color: '#38BDF8' });
          setTimeout(() => {
            setTutorPointer((prev) => (prev ? { ...prev, active: false } : null));
          }, 1200);
        }
      },
      onQuestionAsked: (question) => {
        if (autoContinueTimerRef.current) {
          clearTimeout(autoContinueTimerRef.current);
          autoContinueTimerRef.current = null;
        }
        setActiveQuestion(question);
        setEvaluationFeedback(null);
      },
      onAnswerEvaluated: (evalResult) => {
        setEvaluationFeedback(evalResult);
        setIsSubmittingAnswer(false);
        if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
        autoContinueTimerRef.current = setTimeout(() => {
          handleNextBoardRef.current();
        }, 4000);
      },
      onFinalTestGenerated: (test) => {
        setFinalTest(test);
        setIsLoading(false);
      },
      onError: (err) => {
        console.error('[TeachingEngineView] Error:', err);
        isLoadingBoardRef.current = false;
        setIsLoading(false);
      },
    });

    if (startBoardIndexRef.current > 0 && resumeInfo?.structure) {
      engine.setStructure(resumeInfo.structure);
      setStructure(resumeInfo.structure);
      setTotalBoards(resumeInfo.structure.boards.length);
      setBoardIndex(startBoardIndexRef.current);
      setStatusMessage(`Writing Board ${startBoardIndexRef.current + 1} of ${resumeInfo.structure.boards.length}…`);
      engine.loadBoardPerformance({
        boardIndex: startBoardIndexRef.current,
        completedBoardsSummary: completedTitlesRef.current,
      });
    } else {
      const cachedStructure = getSavedTeachingStructure(resolvedUserId, topicKey, durationMode);
      if (cachedStructure?.boards?.length) {
        engine.setStructure(cachedStructure);
        setStructure(cachedStructure);
        setTotalBoards(cachedStructure.boards.length);
        setStatusMessage(`Writing Board 1 of ${cachedStructure.boards.length}…`);
        engine.loadBoardPerformance({ boardIndex: 0, completedBoardsSummary: [] });
      } else {
        setStatusMessage('Planning live lesson structure…');
        engine.generateTeachingStructure({
          topic: topicTitle,
          courseName,
          syllabusContext,
          durationMode,
        });
      }
    }

    return () => {
      if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
      unsubscribe();
      engine.destroy();
      unifiedVoiceRouter.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicTitle, courseName, syllabusContext]);

  const handleCloseSession = useCallback(() => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.destroy();
      engineRef.current = null;
    }
    unifiedVoiceRouter.stopAll();
    onClose?.();
  }, [onClose]);

  const handleVoiceChange = (newVoice: string) => {
    setCurrentVoice(newVoice);
    setShowVoiceModal(false);
    if (engineRef.current) {
      engineRef.current.setVoice(newVoice);
      if (currentBoardPerf) {
        setIsAudioReady(false);
        engineRef.current.playBoardSpeech(currentBoardPerf);
      }
    }
    addToast(`Lecturer voice switched to ${newVoice}`, 'success');
  };

  const handleSubmitAnswer = async (answerToSubmit: string) => {
    if (!answerToSubmit.trim() || isSubmittingAnswer || !engineRef.current) return;
    setIsSubmittingAnswer(true);
    await engineRef.current.evaluateStudentAnswer({
      topic: topicTitle,
      studentAnswer: answerToSubmit.trim(),
    });
  };

  const handleOpenAsk = () => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    engineRef.current?.pauseLesson();
    setIsSpeaking(false);
    setShowAskModal(true);
  };

  const handleCloseAsk = () => {
    setShowAskModal(false);
    engineRef.current?.resumeLesson();
  };

  const handleAskLecturer = async (studentQuestion: string) => {
    if (!studentQuestion.trim() || !engineRef.current) return;
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }

    setIsProcessingAsk(true);
    savedBoardRef.current = boardElementsRef.current.map((el) => ({ ...el }));
    boardManagerRef.current.clearBoard();
    setIsAnsweringOnBoard(true);
    setIsAudioReady(true);
    setShowAskModal(false);

    addToast('Answering on a fresh board…', 'info');

    await engineRef.current.askLecturerQuestion({
      topic: topicTitle,
      studentQuestion: studentQuestion.trim(),
    });

    setIsProcessingAsk(false);
  };

  // Header configuration sync
  useEffect(() => {
    if (setCustomHeaderConfig) {
      setCustomHeaderConfig({
        leftActions: (
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={handleCloseSession}
              type="button"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#131E32] hover:bg-[#1E2E4A] border border-[#1E293B] flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
              title="Exit Classroom"
            >
              <i className="bi bi-arrow-left text-sm sm:text-base"></i>
            </button>
            <div className="min-w-0 flex items-center gap-2">
              <h1 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate max-w-[150px] sm:max-w-md">
                {topicTitle}
              </h1>
            </div>
          </div>
        ),
        rightActions: (
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!finalTest && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#131E32] border border-[#1E293B] text-[10px] sm:text-xs font-mono text-slate-300">
                <span className="text-[#38BDF8] font-bold">{String(boardIndex + 1).padStart(2, '0')}</span>
                <span className="text-slate-500">/</span>
                <span className="text-slate-400">{String(totalBoards).padStart(2, '0')}</span>
              </div>
            )}
            <button
              onClick={() => setShowVoiceModal(true)}
              type="button"
              className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#131E32] hover:bg-[#1E2E4A] border border-[#1E293B] text-[11px] font-bold text-[#60A5FA] transition-colors cursor-pointer"
              title={`Lecturer: ${currentVoice}`}
            >
              <i className="bi bi-person-voice text-xs"></i>
              <span className="hidden sm:inline">{currentVoice}</span>
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#131E32] border border-[#1E293B]">
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  isSpeaking ? 'bg-[#34D399] shadow-[0_0_8px_#34D399] animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="text-[10px] sm:text-xs font-bold text-slate-200 tracking-wider">
                {finalTest ? 'TEST' : isAnsweringOnBoard ? 'ANSWER' : isSpeaking ? 'LIVE' : showAskModal ? 'PAUSED' : 'READY'}
              </span>
            </div>
          </div>
        ),
        hideBottomNav: true,
        className: 'bg-[#070B14] border-b border-[#1E293B]',
      });
    }
    return () => {
      if (setCustomHeaderConfig) setCustomHeaderConfig(null);
    };
  }, [
    setCustomHeaderConfig,
    topicTitle,
    boardIndex,
    totalBoards,
    isSpeaking,
    currentVoice,
    handleCloseSession,
    isAnsweringOnBoard,
    showAskModal,
    finalTest,
  ]);

  // Calculate score for final mini test
  const calculateScore = () => {
    if (!finalTest) return 0;
    let correct = 0;
    finalTest.questions.forEach((q) => {
      if (selectedAnswers[q.id] === q.correctAnswer) correct += 1;
    });
    return correct;
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#070B14] text-white select-none overflow-hidden relative">
      <main className="flex-1 relative flex flex-col min-h-0 w-full overflow-hidden p-1.5 sm:p-3">
        {/* Render Final Test View or Board View */}
        {finalTest ? (
          <div className="w-full h-full bg-[#0F172A] rounded-2xl sm:rounded-3xl border border-[#1E293B] p-4 sm:p-6 overflow-y-auto flex flex-col items-center">
            <div className="max-w-2xl w-full flex flex-col gap-6">
              <div className="text-center border-b border-[#1E293B] pb-4">
                <span className="px-3 py-1 rounded-full bg-[#38BDF8]/10 text-[#38BDF8] text-xs font-bold uppercase tracking-wider">
                  Final Mini Assessment
                </span>
                <h2 className="text-xl sm:text-2xl font-bold text-white mt-2">{finalTest.topic}</h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Test what you learned from today's live lecture boards.
                </p>
              </div>

              {finalTest.questions.map((q: FinalTestQuestion, idx: number) => {
                const isSelected = Boolean(selectedAnswers[q.id]);
                const isCorrect = selectedAnswers[q.id] === q.correctAnswer;

                return (
                  <div key={q.id} className="p-4 rounded-xl bg-[#131E32] border border-[#1E293B] flex flex-col gap-3">
                    <p className="text-sm sm:text-base font-semibold text-slate-100">
                      <span className="text-[#38BDF8] font-bold mr-2">{idx + 1}.</span> {q.question}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                      {q.options?.map((opt) => {
                        const active = selectedAnswers[q.id] === opt;
                        let optionStyle = 'bg-[#0F172A] border-[#1E293B] text-slate-300 hover:border-[#38BDF8]';

                        if (testSubmitted) {
                          if (opt === q.correctAnswer) {
                            optionStyle = 'bg-[#34D399]/20 border-[#34D399] text-[#34D399] font-bold';
                          } else if (active && !isCorrect) {
                            optionStyle = 'bg-[#F43F5E]/20 border-[#F43F5E] text-[#F43F5E]';
                          }
                        } else if (active) {
                          optionStyle = 'bg-[#38BDF8]/20 border-[#38BDF8] text-[#38BDF8] font-bold';
                        }

                        return (
                          <button
                            key={opt}
                            disabled={testSubmitted}
                            onClick={() => setSelectedAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                            className={`p-3 rounded-lg border text-xs sm:text-sm text-left transition-all cursor-pointer ${optionStyle}`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {testSubmitted && (
                      <div
                        className={`mt-2 p-3 rounded-lg text-xs border ${
                          isCorrect ? 'bg-[#34D399]/10 border-[#34D399]/30 text-[#34D399]' : 'bg-[#F43F5E]/10 border-[#F43F5E]/30 text-rose-300'
                        }`}
                      >
                        <p className="font-bold">{isCorrect ? '✓ Correct' : '✗ Incorrect'}</p>
                        <p className="mt-1 text-slate-300">{q.explanation}</p>
                      </div>
                    )}
                  </div>
                );
              })}

              {!testSubmitted ? (
                <button
                  onClick={() => {
                    setTestSubmitted(true);
                    addToast('Mini test submitted!', 'success');
                  }}
                  disabled={Object.keys(selectedAnswers).length < finalTest.questions.length}
                  className="w-full py-3 sm:py-3.5 rounded-xl bg-[#38BDF8] hover:bg-[#0284C7] disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold text-sm tracking-wide shadow-lg transition-all cursor-pointer"
                >
                  Submit Mini Test
                </button>
              ) : (
                <div className="flex flex-col items-center gap-4 bg-[#131E32] p-6 rounded-2xl border border-[#1E293B] text-center">
                  <div className="text-3xl font-black text-[#38BDF8]">
                    Score: {calculateScore()} / {finalTest.questions.length}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300">
                    {calculateScore() === finalTest.questions.length
                      ? 'Perfect score! You mastered every concept taught in this live lecture.'
                      : 'Great effort! Review the explanations above to solidify your understanding.'}
                  </p>
                  <button
                    onClick={handleCloseSession}
                    className="px-6 py-2.5 rounded-full bg-[#34D399] hover:bg-[#10B981] text-slate-950 font-bold text-sm tracking-wide shadow-lg transition-all cursor-pointer"
                  >
                    Finish Lesson
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <TeachingBoard
            elements={boardElements}
            activeHighlights={activeHighlights}
            activeCircles={activeCircles}
            activeUnderlines={activeUnderlines}
            tutorPointer={tutorPointer}
            isAudioReady={isAudioReady}
          />
        )}

        {/* Loading Indicator */}
        {(isLoading || (!isAudioReady && !showAskModal && !isAnsweringOnBoard && !finalTest)) && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none bg-[#070B14]/60 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-full border-2 border-[#38BDF8]/30 border-t-[#38BDF8] animate-spin mb-3" />
            <p className="text-xs sm:text-sm font-semibold text-slate-300 tracking-wide">{statusMessage}</p>
          </div>
        )}

        {/* Question Overlay */}
        {activeQuestion && !finalTest && (
          <QuestionOverlay
            question={activeQuestion}
            evaluationFeedback={evaluationFeedback}
            isSubmittingAnswer={isSubmittingAnswer}
            onSubmitAnswer={handleSubmitAnswer}
            onDismiss={() => {
              setActiveQuestion(null);
              handleNextBoard();
            }}
          />
        )}

        {/* Ask Lecturer Mic FAB */}
        {!finalTest && (
          <button
            onClick={handleOpenAsk}
            type="button"
            className="absolute bottom-6 right-6 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/25 shadow-2xl backdrop-blur-xl flex items-center justify-center text-white transition-all cursor-pointer z-30 ring-1 ring-white/15"
            title="Ask Lecturer (pauses lesson)"
          >
            <i className="bi bi-mic-fill text-xl sm:text-2xl text-white"></i>
          </button>
        )}
      </main>

      <LiveTutorialVoiceSelectorModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        onSelectVoiceAndStart={handleVoiceChange}
        topicTitle={topicTitle}
        initialVoice={currentVoice}
      />

      <LecturerAskModal
        isOpen={showAskModal}
        onClose={handleCloseAsk}
        onSubmitQuestion={handleAskLecturer}
        isProcessing={isProcessingAsk}
        topicTitle={topicTitle}
      />
    </div>
  );
};

export default TeachingEngineSessionView;
