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
import { logTeachingEvent } from '../../services/teachingEventLogger';
import type { LessonDurationMode } from './LessonDurationModal';
import { lessonPrepService, buildPrepKey } from '../../services/lessonPrepService';
import { getCachedStructure } from '../../services/structurePrefetchService';

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
  isReadyToStart?: boolean;
}

/** Post-speech reading pause duration (ms) before auto-advancing (speech itself lasts ~2 mins per board) */
const KEY_POINT_PAUSE_MS = 6000;

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
  isReadyToStart = true,
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
  const [isPackageMode, setIsPackageMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [isWaitingForVoice, setIsWaitingForVoice] = useState(true);

  const [boardElements, setBoardElements] = useState<LiveBoardElement[]>([]);
  const [activeHighlights, setActiveHighlights] = useState<Set<string>>(new Set());
  const [activeCircles, setActiveCircles] = useState<Set<string>>(new Set());
  const [activeUnderlines, setActiveUnderlines] = useState<Set<string>>(new Set());
  const [tutorPointer, setTutorPointer] = useState<{ x: number; y: number; active: boolean; color?: string } | null>(null);

  const [activeQuestion, setActiveQuestion] = useState<TeachingQuestion | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [evaluationFeedback, setEvaluationFeedback] = useState<StudentAnswerEvaluation | null>(null);
  const [completedBoardTitles, setCompletedBoardTitles] = useState<string[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

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
  const isInitializedRef = useRef(false);

  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;
  const appSettingsRef = useRef(resolvedAppSettings);
  appSettingsRef.current = resolvedAppSettings;
  const resumeInfoRef = useRef(resumeInfo);
  resumeInfoRef.current = resumeInfo;

  useEffect(() => {
    if (!isReadyToStart || isInitializedRef.current) return;
    isInitializedRef.current = true;
    
    const engine = new TeachingEngineService(appSettingsRef.current, userProfileRef.current || null, currentVoice);
    engineRef.current = engine;
    const manager = boardManagerRef.current;
    isLoadingBoardRef.current = true;

    const topicKey = topicKeyFromTitle(topicTitle, courseName);
    const resolvedUserId = userId || userProfileRef.current?.uid || 'anon';

    const unsubscribe = engine.subscribe({
      onStructureLoaded: (struct) => {
        setStructure(struct);
        if (struct.boards && struct.boards.length > 0) {
          setTotalBoards(struct.boards.length);
          setStatusMessage(`Writing Board ${startBoardIndexRef.current + 1} of ${struct.boards.length}…`);

          // Immediately render Title Heading for Board 1 on the canvas
          const b1Title = struct.boards[startBoardIndexRef.current]?.title || topicTitle;
          manager.applyAction({
            id: 'act_title_1_init',
            type: 'write',
            content: b1Title,
            position: { x: 50, y: 10 },
            metadata: { fontSize: '3xl', color: '#FFFFFF' },
          });

          if (durationMode != null) {
            saveLiveTeachingProgress(resolvedUserId, {
              topicKey,
              topicTitle,
              courseName,
              durationMode,
              boardIndex: startBoardIndexRef.current,
              totalBoards: struct.boards.length,
              structure: struct,
              isCompleted: false,
            });
          }
          engine.loadBoardPerformance({
            boardIndex: startBoardIndexRef.current,
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
        setIsWaitingForVoice(true);

        manager.clearBoard();

        // Render Title Action immediately when board is loaded before speech audio starts
        const titleAction = perf.board_actions?.find(
          (a) =>
            a.position?.y <= 16 ||
            a.id?.includes('title') ||
            (a.type as string) === 'title' ||
            (a.type === 'write' && a.content === perf.title)
        );

        if (titleAction) {
          manager.applyAction(titleAction);
        } else if (perf.title) {
          manager.applyAction({
            id: `act_title_${perf.board_number}`,
            type: 'write',
            content: perf.title,
            position: { x: 50, y: 10 },
            metadata: { fontSize: '3xl', color: '#FFFFFF' },
          });
        }

        engine.playBoardSpeech(perf);
      },
      onAudioPlaybackStateChanged: (playing) => {
        setIsSpeaking(playing);
        if (playing) {
          setIsAudioReady(true);
          setIsWaitingForVoice(false);
        }

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
        addToast(err?.message || 'An error occurred during the lesson.', 'error');
        setSessionError(err?.message || 'An error occurred during the lesson.');
        isLoadingBoardRef.current = false;
        setIsLoading(false);
        logTeachingEvent({
          type: 'session_error',
          topic: topicTitle,
          error: err?.message,
        });
      },
    });

    let disposed = false;

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
      void (async () => {
        let cachedStructure = getSavedTeachingStructure(resolvedUserId, topicKey, durationMode);

        // 1) Device-first: load the fully prepared lesson package (IndexedDB) and
        //    hydrate engine caches so opening a Ready lesson makes ZERO
        //    structure/board/TTS network calls.
        let pkgReady = false;
        if (durationMode) {
          const prepKey = buildPrepKey(resolvedUserId, topicKey, durationMode);
          try {
            const pkg = await lessonPrepService.loadReadyPackage(prepKey, currentVoice);
            if (disposed) return;
            if (pkg?.structure?.boards?.length) {
              lessonPrepService.hydrateLessonPackageCaches(pkg);
              engine.hydrateOfflineBoards(pkg.boards);
              engine.setOfflinePackageMode(true);
              setIsPackageMode(true);
              pkgReady = true;

              // Adopt the voice the audio was prepared with so TTS cache keys match
              if (pkg.voice && pkg.voice !== currentVoice) {
                engine.setVoice(pkg.voice);
                setCurrentVoice(pkg.voice);
              }
              cachedStructure = pkg.structure;
            }
          } catch (e) {
            console.warn('[TeachingEngineSessionView] Device package hydration failed:', e);
          }
        }

        // 2) Legacy fallbacks (localStorage / prefetch cache)
        if (!cachedStructure?.boards?.length && durationMode) {
          const prepKey = buildPrepKey(resolvedUserId, topicKey, durationMode);
          const payload = lessonPrepService.getReadyPayload(prepKey);
          if (payload?.structure?.boards?.length) {
            cachedStructure = payload.structure;
          }
        }
        if (!cachedStructure?.boards?.length) {
          cachedStructure = getCachedStructure(topicKey, durationMode, resolvedUserId);
        }

        if (disposed) return;

        if (cachedStructure?.boards?.length) {
          engine.setStructure(cachedStructure);
          setStructure(cachedStructure);
          setTotalBoards(cachedStructure.boards.length);
          setStatusMessage(`Writing Board 1 of ${cachedStructure.boards.length}…`);

          // Immediately render Title Heading for Board 1 on the canvas
          const b1Title = cachedStructure.boards[0]?.title || topicTitle;
          manager.applyAction({
            id: 'act_title_1_init',
            type: 'write',
            content: b1Title,
            position: { x: 50, y: 10 },
            metadata: { fontSize: '3xl', color: '#FFFFFF' },
          });

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
      })();
    }

    return () => {
      disposed = true;
      if (autoContinueTimerRef.current) clearTimeout(autoContinueTimerRef.current);
      unsubscribe();
      engine.destroy();
      unifiedVoiceRouter.stopAll();
      isInitializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReadyToStart, topicTitle, courseName, syllabusContext, durationMode, startBoardIndex, userId]);

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
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
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
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] border border-[#222222] text-[10px] sm:text-xs font-mono text-slate-300">
                <span className="text-[#38BDF8] font-bold">{String(boardIndex + 1).padStart(2, '0')}</span>
                <span className="text-slate-500">/</span>
                <span className="text-slate-400">{String(totalBoards).padStart(2, '0')}</span>
              </div>
            )}
            <button
              onClick={() => setShowVoiceModal(true)}
              type="button"
              className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] text-[11px] font-bold text-[#60A5FA] transition-colors cursor-pointer"
              title={`Lecturer: ${currentVoice}`}
            >
              <i className="bi bi-person-voice text-xs"></i>
              <span className="hidden sm:inline">{currentVoice}</span>
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] border border-[#222222]">
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  isSpeaking ? 'bg-[#34D399] animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="text-[10px] sm:text-xs font-bold text-slate-200 tracking-wider">
                {finalTest ? 'TEST' : isAnsweringOnBoard ? 'ANSWER' : isSpeaking ? 'LIVE' : showAskModal ? 'PAUSED' : 'READY'}
              </span>
            </div>
          </div>
        ),
        hideBottomNav: true,
        className: 'bg-[#000000] border-b border-[#222222]',
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
    <div className="flex flex-col h-full w-full bg-[#000000] text-white select-none overflow-hidden relative">
      <main className="flex-1 relative flex flex-col min-h-0 w-full overflow-hidden p-1.5 sm:p-3">
        {/* Render Final Test View or Board View */}
        {!isReadyToStart ? (
          <div className="w-full h-full bg-[#000000] rounded-2xl sm:rounded-3xl border border-[#222222] p-4 sm:p-6 flex flex-col items-center justify-center animate-fade-in relative">
            <h2 className="absolute top-8 text-xl sm:text-2xl font-bold text-white text-center px-4">{topicTitle}</h2>
            <div className="flex flex-col items-center gap-4 max-w-sm text-center">
              <div className="w-10 h-10 border-4 border-[#38BDF8] border-t-transparent rounded-full animate-spin" />
              <div className="space-y-1.5">
                <p className="text-white font-bold text-base sm:text-lg">Preparing your live lesson…</p>
                <p className="text-slate-300 text-xs sm:text-sm">
                  {statusMessage || 'Planning lesson structure & generating Board 1 speech…'}
                </p>
              </div>
              <div className="bg-[#111111] border border-[#222222] rounded-2xl p-3.5 text-xs text-slate-400 space-y-1.5 text-left w-full shadow-lg">
                <p>&bull; This usually takes about 2–4 minutes.</p>
                <p>&bull; You can leave this page and keep using the app.</p>
                <p>&bull; We’ll notify you as soon as this lesson is ready.</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="absolute bottom-8 px-6 py-2.5 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] text-slate-300 font-bold text-sm transition-colors cursor-pointer"
              >
                Back to Lessons
              </button>
            )}
          </div>
        ) : finalTest ? (
          <div className="w-full h-full bg-[#0F172A] rounded-2xl sm:rounded-3xl border border-[#222222] p-4 sm:p-6 overflow-y-auto flex flex-col items-center">
            <div className="max-w-2xl w-full flex flex-col gap-6">
              <div className="text-center border-b border-[#222222] pb-4">
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
                  <div key={q.id} className="p-4 rounded-xl bg-[#111111] border border-[#222222] flex flex-col gap-3">
                    <p className="text-sm sm:text-base font-semibold text-slate-100">
                      <span className="text-[#38BDF8] font-bold mr-2">{idx + 1}.</span> {q.question}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                      {q.options?.map((opt) => {
                        const active = selectedAnswers[q.id] === opt;
                        let optionStyle = 'bg-[#0F172A] border-[#222222] text-slate-300 hover:border-[#38BDF8]';

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
                <div className="flex flex-col items-center gap-4 bg-[#111111] p-6 rounded-2xl border border-[#222222] text-center">
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
          <>
            {sessionError && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 backdrop-blur-md w-[90%] max-w-lg shadow-lg">
                <i className="bi bi-exclamation-triangle-fill text-rose-500 text-lg shrink-0"></i>
                <p className="text-sm text-rose-200 font-medium leading-snug flex-1">{sessionError}</p>
                <button
                  onClick={() => setSessionError(null)}
                  className="w-6 h-6 rounded-full bg-rose-500/10 hover:bg-rose-500/20 flex items-center justify-center text-rose-400 transition-colors shrink-0 cursor-pointer"
                >
                  <i className="bi bi-x-lg text-xs"></i>
                </button>
              </div>
            )}
            <TeachingBoard
              elements={boardElements}
              activeHighlights={activeHighlights}
              activeCircles={activeCircles}
              activeUnderlines={activeUnderlines}
              tutorPointer={tutorPointer}
              isAudioReady={isAudioReady}
              isWaitingForVoice={isWaitingForVoice}
            />
          </>
        )}

        {/* Sleek Non-Blocking Loading Badge for Initial Board Performance Fetching */}
        {isLoading && !isPackageMode && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/90 border border-[#38BDF8]/40 shadow-xl backdrop-blur-md animate-pulse pointer-events-none">
            <div className="w-3.5 h-3.5 border-2 border-[#38BDF8] border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-xs sm:text-sm font-semibold tracking-wide text-slate-200">
              {statusMessage || 'Lecturer writing board content & speech…'}
            </span>
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
