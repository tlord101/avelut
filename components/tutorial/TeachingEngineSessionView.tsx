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
import { LessonDurationModal, type LessonDurationMode } from './LessonDurationModal';
import { unifiedVoiceRouter } from '../../services/voice/UnifiedVoiceRouter';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../hooks/useToast';
import {
  topicKeyFromTitle,
  getLiveTeachingProgress,
  saveLiveTeachingProgress,
  formatResumeLabel,
} from '../../services/liveTeachingProgressService';

import type { UserProfile, AppSettings } from '../../types';

export interface TeachingEngineSessionViewProps {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  initialVoice?: string;
  initialDurationMode?: LessonDurationMode;
  userId?: string;
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  onClose?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

const KEY_POINT_PAUSE_MS = 5000;

export const TeachingEngineSessionView: React.FC<TeachingEngineSessionViewProps> = ({
  topicTitle,
  courseName = 'Academic Course',
  syllabusContext,
  initialVoice = 'Altair',
  initialDurationMode,
  userId = 'anon',
  userProfile,
  appSettings: propAppSettings,
  onClose,
  setCustomHeaderConfig,
}) => {
  const { settings: hookAppSettings } = useAppSettings();
  const appSettings = propAppSettings || hookAppSettings;
  const { addToast } = useToast();

  const [currentVoice, setCurrentVoice] = useState<string>(initialVoice);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showAskModal, setShowAskModal] = useState(false);
  const [isProcessingAsk, setIsProcessingAsk] = useState(false);
  const [isAnsweringOnBoard, setIsAnsweringOnBoard] = useState(false);

  const topicKey = topicKeyFromTitle(topicTitle, courseName);
  const savedProgress = getLiveTeachingProgress(userId, topicKey);
  const [durationMode, setDurationMode] = useState<LessonDurationMode | null>(initialDurationMode ?? null);
  const [showDurationModal, setShowDurationModal] = useState(!initialDurationMode);
  const [sessionStarted, setSessionStarted] = useState(Boolean(initialDurationMode));
  const [resumeInfo] = useState(() =>
    savedProgress && !savedProgress.isCompleted && savedProgress.structure ? savedProgress : null
  );
  const startBoardIndexRef = useRef(0);

  const engineRef = useRef<TeachingEngineService | null>(null);
  const boardManagerRef = useRef<BoardStateManager>(new BoardStateManager());
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingBoardRef = useRef(false);
  const savedBoardRef = useRef<LiveBoardElement[] | null>(null);

  const [structure, setStructure] = useState<TeachingStructure | null>(null);
  const [currentBoardPerf, setCurrentBoardPerf] = useState<TeachingBoardPerformance | null>(null);
  const [boardIndex, setBoardIndex] = useState(0);
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

  const [finalTest, setFinalTest] = useState<FinalTest | null>(null);
  const [isGeneratingTest, setIsGeneratingTest] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);

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
    setStatusMessage(`Preparing Board ${nextIdx + 1} of ${totalBoardsRef.current}…`);
    setActiveQuestion(null);
    setEvaluationFeedback(null);
    setIsAudioReady(false);
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
    const engine = new TeachingEngineService(appSettings, null, currentVoice);
    engineRef.current = engine;
    const manager = boardManagerRef.current;
    isLoadingBoardRef.current = true;

    const unsubscribe = engine.subscribe({
      onStructureLoaded: (struct) => {
        setStructure(struct);
        if (struct.boards && struct.boards.length > 0) {
          setTotalBoards(struct.boards.length);
          setStatusMessage(`Preparing Board 1 of ${struct.boards.length}…`);
          engine.loadBoardPerformance({ boardIndex: 0, completedBoardsSummary: [] });
        }
      },
      onBoardLoaded: (perf) => {
        isLoadingBoardRef.current = false;
        setCurrentBoardPerf(perf);
        setIsLoading(false);
        setIsAudioReady(false);
        manager.clearBoard();
        engine.playBoardSpeech(perf);

        const struct = engine.getCurrentStructure();
        const idx = engine.getCurrentBoardIndex();
        void saveLiveTeachingProgress(userId, {
          topicKey,
          topicTitle,
          courseName,
          durationMode: engine.getDurationMode(),
          boardIndex: idx,
          totalBoards: struct?.boards?.length || totalBoardsRef.current,
          chapterTitle: (struct?.boards?.[idx] as any)?.chapter || perf.title,
          structure: struct,
          lastBoardTitle: perf.title,
          isCompleted: false,
        });
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
                  metadata: { primitive: 'custom_svg', svgContent: el.svgContent },
                });
              } else if (el.type === 'text' || el.type === 'formula') {
                manager.applyAction({
                  id: el.id,
                  type: 'write',
                  content: el.content,
                  position: el.position,
                  metadata: { latex: el.latex, fontSize: el.fontSize as any, color: el.color },
                });
              } else if (el.type === 'diagram' && el.diagramProps?.drawType) {
                manager.applyAction({
                  id: el.id,
                  type: 'draw',
                  position: el.position,
                  metadata: { ...el.diagramProps, color: el.color } as any,
                });
              }
            });
          }
          setIsAudioReady(true);
          setTimeout(() => engineRef.current?.resumeLesson(), 600);
          return;
        }

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
        void saveLiveTeachingProgress(userId, {
          topicKey,
          topicTitle,
          courseName,
          durationMode: engine.getDurationMode(),
          boardIndex: totalBoardsRef.current,
          totalBoards: totalBoardsRef.current,
          structure: engine.getCurrentStructure(),
          lastBoardTitle: 'Final test',
          isCompleted: true,
        });
      },
      onError: (err) => {
        console.error('[TeachingEngineView] Error:', err);
        isLoadingBoardRef.current = false;
        setIsLoading(false);
      },
    });

    if (!sessionStarted || !durationMode) {
      return () => {
        unsubscribe();
      };
    }

    engine.setDurationMode(durationMode);

    if (startBoardIndexRef.current > 0 && resumeInfo?.structure) {
      engine.setStructure(resumeInfo.structure);
      setStructure(resumeInfo.structure);
      setTotalBoards(resumeInfo.structure.boards?.length || resumeInfo.totalBoards);
      setBoardIndex(startBoardIndexRef.current);
      setStatusMessage(`Resuming Board ${startBoardIndexRef.current + 1}…`);
      engine.loadBoardPerformance({
        boardIndex: startBoardIndexRef.current,
        completedBoardsSummary:
          resumeInfo.structure.boards?.slice(0, startBoardIndexRef.current).map((b: any) => b.title) || [],
      });
    } else {
      engine.generateTeachingStructure({
        topic: topicTitle,
        courseName,
        syllabusContext,
        durationMode,
      });
    }

    return () => {
      if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
      unsubscribe();
      engine.destroy();
      unifiedVoiceRouter.stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicTitle, courseName, syllabusContext, sessionStarted, durationMode]);

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
              {durationMode && (
                <span className="hidden sm:inline text-[10px] font-mono text-slate-400 border border-[#1E293B] px-1.5 py-0.5 rounded">
                  {durationMode}m
                </span>
              )}
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
    handleCloseSession,
    topicTitle,
    boardIndex,
    totalBoards,
    currentVoice,
    isSpeaking,
    isAnsweringOnBoard,
    showAskModal,
    finalTest,
    durationMode,
  ]);

  const calculateScore = () => {
    if (!finalTest) return 0;
    let correct = 0;
    finalTest.questions.forEach((q) => {
      if (selectedAnswers[q.id] === q.correctAnswer) correct += 1;
    });
    return correct;
  };

  const handleDurationConfirm = (mode: LessonDurationMode) => {
    setDurationMode(mode);
    startBoardIndexRef.current = 0;
    setShowDurationModal(false);
    setSessionStarted(true);
    setIsLoading(true);
    setStatusMessage('Planning live lesson structure…');
  };

  const handleResume = () => {
    if (!resumeInfo) return;
    setDurationMode(resumeInfo.durationMode);
    startBoardIndexRef.current = resumeInfo.boardIndex;
    setShowDurationModal(false);
    setSessionStarted(true);
    setIsLoading(true);
    setStatusMessage(`Resuming from Board ${resumeInfo.boardIndex + 1}…`);
    addToast('Continuing where you left off', 'info');
  };

  if (showDurationModal || !sessionStarted) {
    return (
      <div className="flex flex-col h-full w-full bg-[#070B14] text-white relative">
        <LessonDurationModal
          isOpen
          topicTitle={topicTitle}
          onClose={() => onClose?.()}
          onConfirm={handleDurationConfirm}
          initialMode={30}
          resumeAvailable={Boolean(resumeInfo)}
          resumeLabel={resumeInfo ? formatResumeLabel(resumeInfo) : undefined}
          onResume={handleResume}
          userProfile={userProfile}
          appSettings={appSettings}
        />
      </div>
    );
  }

  if (finalTest) {
    const score = calculateScore();
    const totalQ = finalTest.questions.length;
    return (
      <div className="flex flex-col h-full w-full bg-[#070B14] text-white overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full p-6 space-y-6">
          <div className="text-center space-y-2 pt-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#131E32] border border-[#1E293B] flex items-center justify-center">
              <i className="bi bi-trophy text-2xl text-[#FBBF24]"></i>
            </div>
            <h2 className="text-xl font-bold">{finalTest.title || 'Mini Test'}</h2>
            <p className="text-sm text-slate-400">{finalTest.instructions}</p>
          </div>

          {finalTest.questions.map((q, qi) => (
            <div key={q.id} className="rounded-2xl border border-[#1E293B] bg-[#0B1220] p-5 space-y-3">
              <p className="text-sm font-semibold text-white">
                <span className="text-[#38BDF8] mr-2">Q{qi + 1}.</span>
                {q.question}
              </p>
              <div className="space-y-2">
                {q.options.map((opt) => {
                  const selected = selectedAnswers[q.id] === opt;
                  const isCorrect = testSubmitted && opt === q.correctAnswer;
                  const isWrong = testSubmitted && selected && opt !== q.correctAnswer;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={testSubmitted}
                      onClick={() => setSelectedAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                      className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm transition-all ${
                        isCorrect
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                          : isWrong
                            ? 'border-red-500 bg-red-500/10 text-red-300'
                            : selected
                              ? 'border-[#38BDF8] bg-[#38BDF8]/10 text-white'
                              : 'border-[#1E293B] bg-[#131E32] text-slate-300 hover:border-[#334155]'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {testSubmitted && q.explanation && (
                <p className="text-xs text-slate-400 pt-1">{q.explanation}</p>
              )}
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 pb-8">
            {!testSubmitted ? (
              <button
                type="button"
                onClick={() => setTestSubmitted(true)}
                disabled={Object.keys(selectedAnswers).length < totalQ}
                className="flex-1 py-3 rounded-xl bg-[#0066FF] hover:bg-[#0052cc] disabled:opacity-40 text-white text-sm font-bold"
              >
                Submit answers
              </button>
            ) : (
              <div className="flex-1 text-center space-y-3">
                <p className="text-lg font-bold text-white">
                  Score: {score}/{totalQ}
                </p>
                <button
                  type="button"
                  onClick={handleCloseSession}
                  className="px-6 py-2.5 rounded-xl bg-[#131E32] border border-[#1E293B] text-sm font-bold text-white"
                >
                  Exit classroom
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#070B14] text-white relative overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 relative">
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#070B14]/90">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-2 border-[#38BDF8] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-300">{statusMessage}</p>
            </div>
          </div>
        )}

        <TeachingBoard
          elements={boardElements}
          activeHighlights={activeHighlights}
          activeCircles={activeCircles}
          activeUnderlines={activeUnderlines}
          tutorPointer={tutorPointer}
          isLoading={isLoading}
        />

        {activeQuestion && (
          <QuestionOverlay
            question={activeQuestion}
            isSubmitting={isSubmittingAnswer}
            evaluation={evaluationFeedback}
            onSubmit={handleSubmitAnswer}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-[#1E293B] bg-[#0B1220] px-4 py-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleOpenAsk}
          className="px-4 py-2 rounded-xl bg-[#131E32] border border-[#1E293B] text-xs font-bold text-slate-200 hover:bg-[#1E2E4A]"
        >
          <i className="bi bi-chat-dots mr-1.5"></i>
          Ask lecturer
        </button>
        <button
          type="button"
          onClick={() => handleNextBoard()}
          disabled={isLoading || Boolean(activeQuestion)}
          className="px-4 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052cc] disabled:opacity-40 text-xs font-bold text-white"
        >
          Next board
          <i className="bi bi-arrow-right ml-1.5"></i>
        </button>
      </div>

      {showVoiceModal && (
        <LiveTutorialVoiceSelectorModal
          isOpen={showVoiceModal}
          currentVoice={currentVoice}
          onClose={() => setShowVoiceModal(false)}
          onSelect={handleVoiceChange}
        />
      )}

      {showAskModal && (
        <LecturerAskModal
          isOpen={showAskModal}
          isProcessing={isProcessingAsk}
          onClose={handleCloseAsk}
          onSubmit={handleAskLecturer}
          topicTitle={topicTitle}
        />
      )}
    </div>
  );
};

export default TeachingEngineSessionView;
