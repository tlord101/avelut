import React, { useState, useEffect, useRef, useCallback } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import type { UserProfile, Course, Topic } from '../types';
import {
    getStudentCognitiveProfile,
    recordSessionCompletion,
    StudentCognitiveProfile,
} from '../services/tutorMemoryService';
import {
    saveLocalVoiceTutorialProgress,
    getLocalVoiceTutorialProgress,
} from '../services/voiceTutorialStorageService';
import { formatLatexMath } from '../utils/latexFormatter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
// @ts-ignore: KaTeX stylesheet
import 'katex/dist/katex.min.css';
import { LimitExceededModal } from './LimitExceededModal';
import { unifiedVoiceRouter, unifiedTts } from '../services/voice/UnifiedVoiceRouter';
import { sanitizeAndValidateSvg, SVG_REALISTIC_ILLUSTRATION_SYSTEM_PROMPT } from '../services/svgIllustrationEngine';
import { deductAICredits, getFeatureCost, checkAICredits, isPaidSubscriber, isExempt } from '../utils/usage';
import { TeachingEngineSessionView } from './tutorial/TeachingEngineSessionView';
import { safeJsonParse } from '../lib/safeJsonParse';

import { LessonDurationModal, type LessonDurationMode } from './tutorial/LessonDurationModal';
import {
    getLiveTeachingProgress,
    topicKeyFromTitle,
    formatResumeLabel,
    prefetchTopicTeachingStructure,
    type LiveTeachingProgress,
} from '../services/liveTeachingProgressService';
import { TeachingEngineService } from '../services/teachingEngineService';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_BOARD_LINES = 6;

// ── Types ────────────────────────────────────────────────────────────────────
export interface VoiceTutorialSessionData {
    course: Course;
    topic?: Topic | null;
    syllabusContext?: string;
    image?: string | null;
    customPrompt?: string | null;
    source?: string;
}

export interface PrecompiledBoard {
    boardId: string;
    conceptIdx: number;
    conceptName: string;
    phaseTitle: string;
    boardLines: string[];
    spokenExplanation: string;
    diagramSvg?: string | null;
    tableMarkdown?: string | null;
    diagramCaption?: string | null;
}

export interface SinglePassTopicLesson {
    topicName: string;
    courseName?: string;
    overview: string;
    boards: PrecompiledBoard[];
    overallSummary: string;
}

export interface VoiceTutorialPageProps {
    userProfile?:  UserProfile | null;
    appSettings?:  any;
    onNavigate?:   (tab: string) => void;
    initialSessionData?: VoiceTutorialSessionData | null;
    onBack?:       () => void;
    setCustomHeaderConfig?: (config: any) => void;
}

const simpleHash = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
};

const readImageAsDataUrl = async (input: File | Blob | string): Promise<{ dataUrl: string; mimeType: string }> => {
    if (typeof input === 'string') {
        if (input.startsWith('data:')) {
            const mimeType = input.split(';')[0].split(':')[1] || 'image/jpeg';
            return { dataUrl: input, mimeType };
        }
        if (input.startsWith('blob:') || input.startsWith('http://') || input.startsWith('https://')) {
            try {
                const response = await fetch(input);
                const blob = await response.blob();
                return readImageAsDataUrl(blob);
            } catch (err) {
                console.warn('Failed to fetch image blob/url:', err);
            }
        }
        return { dataUrl: input, mimeType: 'image/jpeg' };
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                const mimeType = (input as any).type || 'image/jpeg';
                resolve({ dataUrl: reader.result, mimeType });
            } else {
                reject(new Error('Failed to read image as data URL'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(input);
    });
};

import { cleanAndParseJson } from '../utils/jsonUtils';

/**
 * Robust JSON parser capable of handling LaTeX backslashes, unclosed quotes, and markdown code blocks.
 */
export function robustParseJson<T = any>(raw: string): T {
    const fallbackStructure = {
        topicName: 'Academic Tutorial',
        overview: 'Interactive Multi-Disciplinary Lesson',
        boards: [
            {
                boardId: 'b_0',
                conceptIdx: 0,
                conceptName: 'Core Overview',
                phaseTitle: 'Intuition & Key Concepts',
                boardLines: ['Welcome to your interactive session.', 'Let us begin with the core concept.'],
                speakerNarrative: 'Welcome! Today we will break down key concepts step by step.',
                checkQuestion: 'Ready to continue?',
                checkOptions: ['Yes, let us begin', 'Explain again'],
                correctOptionIdx: 0,
            },
        ],
    } as any;

    return cleanAndParseJson<T>(raw, { fallback: fallbackStructure as T });
}

// ── Component ─────────────────────────────────────────────────────────────────
export const VoiceTutorialPage: React.FC<VoiceTutorialPageProps> = ({
    userProfile,
    appSettings: propAppSettings,
    onNavigate,
    initialSessionData,
    onBack,
    setCustomHeaderConfig,
}) => {
    const { settings: hookAppSettings } = useAppSettings();
    const resolvedAppSettings = propAppSettings || hookAppSettings;

    // ── Live Teaching Whiteboard Architecture ──
    const topicTitle = initialSessionData?.topic?.topic_name || initialSessionData?.customPrompt || 'Live Tutorial';
    const courseName = initialSessionData?.course?.course_name || 'Academic Topic';
    const syllabusContext = initialSessionData?.syllabusContext;

    const [selectedDurationMode, setSelectedDurationMode] = useState<LessonDurationMode | null>(null);
    const [isDurationModalOpen, setIsDurationModalOpen] = useState<boolean>(true);
    const [resumeProgress, setResumeProgress] = useState<LiveTeachingProgress | null>(null);
    const [startBoardIndex, setStartBoardIndex] = useState<number>(0);

    // Reset duration mode & progress whenever topic or initialSessionData changes
    useEffect(() => {
        setSelectedDurationMode(null);
        setStartBoardIndex(0);
        setResumeProgress(null);
        setIsDurationModalOpen(true);
    }, [topicTitle, courseName, initialSessionData]);

    // Check for existing progress to allow 1-click session resuming
    useEffect(() => {
        const userId = userProfile?.uid || 'anon';
        const topicKey = topicKeyFromTitle(topicTitle, courseName);
        const progress = getLiveTeachingProgress(userId, topicKey);
        if (progress && !progress.isCompleted && progress.boardIndex > 0) {
            setResumeProgress(progress);
        } else {
            setResumeProgress(null);
        }
    }, [userProfile?.uid, topicTitle, courseName]);

    // Background prefetch all 3 duration modes (15m, 30m, 60m) into localStorage & Supabase DB immediately
    useEffect(() => {
        if (!topicTitle) return;
        void prefetchTopicTeachingStructure({
            topicTitle,
            courseName,
            syllabusContext,
            userId: userProfile?.uid,
            userProfile,
            appSettings: resolvedAppSettings,
        });
    }, [topicTitle, courseName, syllabusContext, resolvedAppSettings, userProfile]);

    const handleConfirmDuration = (mode: LessonDurationMode) => {
        setSelectedDurationMode(mode);
        setStartBoardIndex(0);
        setIsDurationModalOpen(false);
    };

    const handleResumeSession = () => {
        if (resumeProgress) {
            setSelectedDurationMode(resumeProgress.durationMode);
            setStartBoardIndex(resumeProgress.boardIndex);
            setIsDurationModalOpen(false);
        }
    };

    const handleCloseModal = () => {
        setIsDurationModalOpen(false);
        if (!selectedDurationMode) {
            if (onBack) onBack();
            else setSelectedDurationMode(30);
        }
    };

    return (
        <div className="relative w-full h-full">
            <LessonDurationModal
                isOpen={isDurationModalOpen}
                topicTitle={topicTitle}
                onClose={handleCloseModal}
                onConfirm={handleConfirmDuration}
                initialMode={selectedDurationMode || 30}
                resumeAvailable={Boolean(resumeProgress)}
                resumeLabel={resumeProgress ? formatResumeLabel(resumeProgress) : undefined}
                onResume={handleResumeSession}
                userProfile={userProfile}
                appSettings={resolvedAppSettings}
            />

            {selectedDurationMode && (
                <TeachingEngineSessionView
                    topicTitle={topicTitle}
                    courseName={courseName}
                    syllabusContext={syllabusContext}
                    userId={userProfile?.uid}
                    userProfile={userProfile}
                    appSettings={resolvedAppSettings}
                    durationMode={selectedDurationMode}
                    startBoardIndex={startBoardIndex}
                    onClose={onBack}
                    setCustomHeaderConfig={setCustomHeaderConfig}
                />
            )}
        </div>
    );
};

// ── Legacy Component Implementation (Preserved for compatibility) ────────────
export const LegacyVoiceTutorialPage: React.FC<VoiceTutorialPageProps> = ({
    userProfile,
    appSettings: propAppSettings,
    onNavigate,
    initialSessionData,
    onBack,
    setCustomHeaderConfig,
}) => {
    const { settings: hookAppSettings } = useAppSettings();
    const appSettings = propAppSettings || hookAppSettings;
    const { addToast } = useToast();

    // ── Session & Lesson State ──────────────────────────────────────────
    const [sessionData, setSessionData] = useState<VoiceTutorialSessionData | null>(initialSessionData || null);
    const [lessonPlan, setLessonPlan] = useState<SinglePassTopicLesson | null>(null);
    const [isGeneratingLesson, setIsGeneratingLesson] = useState(false);
    const [lessonGenStep, setLessonGenStep] = useState('');
    const [isBackgroundCompilingPhase2, setIsBackgroundCompilingPhase2] = useState(false);
    const [boardIndex, setBoardIndex] = useState(0);
    const [isDone, setIsDone] = useState(false);

    // ── Board Content & Animation State ─────────────────────────────────
    const [visibleBoardLines, setVisibleBoardLines] = useState<string[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [activeWritingIndex, setActiveWritingIndex] = useState<number>(-1);
    const [activeDiagramSvg, setActiveDiagramSvg] = useState<string | null>(null);
    const [diagramKey, setDiagramKey] = useState(0);

    // ── Audio & Voice State (Altair) ────────────────────────────────────
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isTtsLoading, setIsTtsLoading] = useState(false);
    const [activeSpokenWord, setActiveSpokenWord] = useState<string>('');
    const [audioErrorBoardIdx, setAudioErrorBoardIdx] = useState<number | null>(null);
    const [isRetryingAudio, setIsRetryingAudio] = useState(false);

    // ── Live Interruptible Q&A State ────────────────────────────────────
    const [isMicListening, setIsMicListening] = useState(false);
    const [micDisplay, setMicDisplay] = useState('');
    const [isAnsweringQuestion, setIsAnsweringQuestion] = useState(false);
    const [qaQuestion, setQaQuestion] = useState<string | null>(null);
    const [qaAnswer, setQaAnswer] = useState<string | null>(null);
    const [attachedImage, setAttachedImage] = useState<{ base64: string; mimeType: string } | null>(null);
    const [showScannedImageModal, setShowScannedImageModal] = useState(false);
    const [showLimitModal, setShowLimitModal] = useState(false);
    const [limitModalData, setLimitModalData] = useState<{ cost: number; balance: number }>({ cost: 1, balance: 0 });
    const [isNavigatingBack, setIsNavigatingBack] = useState(false);
    const [useTeachingEngine, setUseTeachingEngine] = useState(true);

    // ── Refs ────────────────────────────────────────────────────────────
    const boardScrollRef            = useRef<HTMLDivElement | null>(null);
    const fileInputRef              = useRef<HTMLInputElement | null>(null);
    const isActiveRef               = useRef(true);
    const hasStartedRef             = useRef(false);
    const boardIndexRef             = useRef(0);
    const isSpeakingRef             = useRef(false);
    const currentAudioRef           = useRef<any>(null);
    const playSessionIdRef          = useRef(0);
    const streamTimersRef           = useRef<ReturnType<typeof setTimeout>[]>([]);
    const recognitionRef            = useRef<any>(null);
    const spokenTextRef             = useRef('');
    const pendingBoardLinesRef      = useRef<string[]>([]);
    const pendingVisualsRef         = useRef<{ svg: string | null; table: string | null; caption: string | null }>({ svg: null, table: null, caption: null });

    // ── Batch Playback Refs (one TTS request covers a group of boards) ────
    const lessonPlanRef             = useRef<SinglePassTopicLesson | null>(null);
    const currentAudioPlayerRef     = useRef<any>(null);
    const lastKnownTimeRef          = useRef(0);
    const activeSegmentRef          = useRef<{ start: number; end: number; script: string; key: string; charStarts: number[] } | null>(null);
    const qaResumeSeekRef           = useRef(0); // seconds to resume audio at after a Q&A answer
    const qaResumeBoardRef          = useRef<number>(-1); // board to reveal immediately after Q&A resume

    // ── Auto-Scroll Board Content Smoothly to Bottom ────────────────────
    const scrollToBottom = useCallback(() => {
        if (boardScrollRef.current) {
            boardScrollRef.current.scrollTo({
                top: boardScrollRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [visibleBoardLines, isStreaming, activeSpokenWord, activeDiagramSvg, scrollToBottom]);

    const clearAllStreamTimers = useCallback(() => {
        streamTimersRef.current.forEach(t => clearTimeout(t));
        streamTimersRef.current = [];
    }, []);

    const stopAudioImmediate = useCallback(() => {
        playSessionIdRef.current++;
        if (currentAudioRef.current) {
            try {
                if (typeof currentAudioRef.current.stop === 'function') {
                    currentAudioRef.current.stop();
                } else if (typeof currentAudioRef.current.pause === 'function') {
                    currentAudioRef.current.pause();
                }
            } catch (_) {}
            currentAudioRef.current = null;
        }
        unifiedVoiceRouter.stopAudio();
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        setIsTtsLoading(false);
        setActiveSpokenWord('');
    }, []);

    // ── Speech Text Sanitizer (Preserves Grok Speech Tags) ───────────────
    const cleanSpokenTextForTTS = (rawText: string): string => {
        return rawText
            .replace(/\$\$([\s\S]*?)\$\$/g, ' ')
            .replace(/\$([^\$]+)\$/g, (m, math) => {
                return math
                    .replace(/\\text\{([^\}]+)\}/g, '$1')
                    .replace(/\\frac\{([^\}]+)\}\{([^\}]+)\}/g, '$1 over $2')
                    .replace(/\\sqrt\{([^\}]+)\}/g, 'square root of $1')
                    .replace(/v_f/g, 'v final')
                    .replace(/v_i/g, 'v initial')
                    .replace(/F_\{net\}|F_net/g, 'net force')
                    .replace(/\\theta/g, 'theta')
                    .replace(/\^2/g, ' squared')
                    .replace(/\^3/g, ' cubed')
                    .replace(/m\/s\^2|\\text\{m\/s\}\^2/g, 'meters per second squared')
                    .replace(/m\/s|\\text\{m\/s\}/g, 'meters per second')
                    .replace(/kg/g, 'kilograms')
                    .replace(/=/g, ' equals ')
                    .replace(/\+/g, ' plus ')
                    .replace(/-/g, ' minus ')
                    .replace(/\*/g, ' times ')
                    .replace(/\\rightarrow/g, ' leads to ')
                    .replace(/\\Delta/g, 'change in ');
            })
            .replace(/[#`_~]/g, '')
            .replace(/\*\*(.*?)\*\*/g, '<emphasis>$1</emphasis>')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // ── Synchronized Progressive Board Reveal (Accurate Voice Pacing) ────
    const revealLinesProgressively = useCallback((lines: string[], spokenText?: string) => {
        clearAllStreamTimers();
        if (!lines || lines.length === 0) {
            setVisibleBoardLines([]);
            setIsStreaming(false);
            setActiveWritingIndex(-1);
            return;
        }

        setIsStreaming(true);
        const words = spokenText ? spokenText.split(/\s+/).filter(Boolean) : [];
        const wordCount = Math.max(words.length, 20);

        // Pacing at 520ms per word with a guaranteed 30 seconds minimum per board
        const totalEstMs = Math.max(30000, wordCount * 520);
        const lineCount = lines.length;
        const lineIntervalMs = Math.max(4500, Math.min(9000, Math.floor(totalEstMs / Math.max(lineCount, 1))));

        // Lead delay of 280ms before Line 0 writes
        const initTimer = setTimeout(() => {
            if (!isActiveRef.current) return;
            setVisibleBoardLines([lines[0]]);
            setActiveWritingIndex(0);
            scrollToBottom();
        }, 280);
        streamTimersRef.current.push(initTimer);

        for (let i = 1; i < lineCount; i++) {
            const timer = setTimeout(() => {
                if (!isActiveRef.current) return;
                setVisibleBoardLines(lines.slice(0, i + 1));
                setActiveWritingIndex(i);
                scrollToBottom();
            }, 280 + i * lineIntervalMs);
            streamTimersRef.current.push(timer);
        }

        const finishTimer = setTimeout(() => {
            if (!isActiveRef.current) return;
            setVisibleBoardLines(lines.slice(0, MAX_BOARD_LINES));
            setIsStreaming(false);
            setActiveWritingIndex(-1);
            setActiveSpokenWord('');
            scrollToBottom();
        }, 280 + lineCount * lineIntervalMs);
        streamTimersRef.current.push(finishTimer);
    }, [clearAllStreamTimers, scrollToBottom]);

    // ── Batch Segment Playback (one TTS request covers a group of boards) ─
    const segmentGroupsForIndex = (len: number, idx: number): [number, number] => {
      // ONE BOARD PER REQUEST: small payloads synthesize in seconds, cache
      // instantly, and failures are cheap. Multi-board batches exceeded the
      // serverless function time limit, left the UI stuck in a perpetual
      // loading state, and burned credits on retried mega-payloads.
      const safeIdx = Math.max(0, Math.min(idx, Math.max(len - 1, 0)));
      return [safeIdx, safeIdx];
    };

    const buildGradedSegment = (lesson: SinglePassTopicLesson, start: number, end: number) => {
      const boards = lesson.boards.slice(start, end + 1);
      const cleaned = boards.map((b) => cleanSpokenTextForTTS(b.spokenExplanation));
      const charStarts: number[] = [];
      let script = '';
      cleaned.forEach((t, i) => {
        charStarts.push(script.length);
        script += t;
        if (i < cleaned.length - 1) script += ' ';
      });
      const cid = sessionData?.course?.course_id || 'general';
      const tid = sessionData?.topic?.topic_id || 'core';
      return {
        start,
        end,
        script,
        charStarts,
        key: `avelut_grok_${cid}_${tid}_batch_${start}_${end}`,
      };
    };

    const revealBatchBoard = (lesson: SinglePassTopicLesson, idx: number) => {
      if (!lesson || !lesson.boards[idx]) return;
      const board = lesson.boards[idx];
      const svg = sanitizeAndValidateSvg(board.diagramSvg);
      const table = board.tableMarkdown && board.tableMarkdown.trim().includes('|') ? board.tableMarkdown : null;
      pendingVisualsRef.current = { svg, table, caption: board.diagramCaption || board.phaseTitle };
      pendingBoardLinesRef.current = board.boardLines.slice(0, MAX_BOARD_LINES);
      setBoardIndex(idx);
      boardIndexRef.current = idx;
      setActiveDiagramSvg(svg);
      if (svg) setDiagramKey((k) => k + 1);
      revealLinesProgressively(board.boardLines, cleanSpokenTextForTTS(board.spokenExplanation));
      const uid = userProfile?.uid || 'anon';
      const cid = sessionData?.course?.course_id || 'lib';
      const tid = sessionData?.topic?.topic_id || 'core';
      void saveLocalVoiceTutorialProgress(uid, cid, tid, idx, board.phaseTitle, false, lesson);
    };

    const playGrokBatch = async (lesson: SinglePassTopicLesson, targetIdx: number) => {
      if (!isActiveRef.current || !lesson || !lesson.boards.length) return;
      const len = lesson.boards.length;

      // If the segment containing the target is already playing, just reveal it (no new fetch).
      const active = activeSegmentRef.current;
      if (active && targetIdx >= active.start && targetIdx <= active.end && currentAudioPlayerRef.current) {
        const isRunning = typeof currentAudioPlayerRef.current.isPlaying === 'function'
          ? currentAudioPlayerRef.current.isPlaying()
          : true;
        if (isRunning) {
          revealBatchBoard(lesson, targetIdx);
          return;
        }
      }

      const [s, e] = segmentGroupsForIndex(len, targetIdx);
      const seg = buildGradedSegment(lesson, s, e);
      lessonPlanRef.current = lesson;

      stopAudioImmediate();
      clearAllStreamTimers();
      setIsPaused(false);
      setAudioErrorBoardIdx(null);

      if (isMuted) {
        setIsTtsLoading(false);
        setActiveSpokenWord('');
        revealBatchBoard(lesson, s);
        return;
      }

      setIsTtsLoading(true);
      setIsSpeaking(false);
      setVisibleBoardLines([]);
      setActiveWritingIndex(-1);
      setActiveDiagramSvg(null);

      const sessionId = ++playSessionIdRef.current;
      let startedOnce = false;
      let readyOrStarted = false;
      const isNotebook = Boolean(
        sessionData?.syllabusContext?.toLowerCase().includes('notebook') ||
        sessionData?.syllabusContext?.toLowerCase().includes('chapter') ||
        sessionData?.course?.course_id?.startsWith('nb_') ||
        sessionData?.source === 'notebook'
      );

      const player = unifiedVoiceRouter.playSpeech(seg.script, {
        appSettings,
        context: isNotebook ? 'notebook' : 'study_guide',
        withTimestamps: true,
        cacheKey: seg.key,
        isPrivate: isNotebook,
        onStart: () => {
          clearTimeout(startWatchdog);
          readyOrStarted = true;
          if (startedOnce) return;
          startedOnce = true;
          if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
          setIsSpeaking(true);
          isSpeakingRef.current = true;
          setIsTtsLoading(false);
          setAudioErrorBoardIdx(null);
          const qaSeek = qaResumeSeekRef.current;
          if (qaSeek > 0) {
            currentAudioPlayerRef.current?.seek?.(qaSeek);
            qaResumeSeekRef.current = 0;
          }
        },
        onReady: () => {
          // Audio fully downloaded → reveal the board content immediately so
          // text and diagrams display even if autoplay policy delays playback.
          // (Reveal must NOT live in onStart: onReady fires first and the
          // startedOnce guard would otherwise skip the reveal entirely.)
          clearTimeout(startWatchdog);
          readyOrStarted = true;
          if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
          setIsTtsLoading(false);
          setAudioErrorBoardIdx(null);
          const qaBoard = qaResumeBoardRef.current;
          if (qaBoard >= s && qaBoard <= e) {
            revealBatchBoard(lesson, qaBoard);
          } else {
            revealBatchBoard(lesson, s);
          }
          qaResumeBoardRef.current = -1;
        },
        onTimeUpdate: (curTime, charIdx, word) => {
          if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
          lastKnownTimeRef.current = curTime;
          setActiveSpokenWord(word);
          let b = s;
          for (let i = 0; i < seg.charStarts.length; i++) {
            if (charIdx >= seg.charStarts[i]) b = s + i;
            else break;
          }
          if (b > boardIndexRef.current && b <= e) revealBatchBoard(lesson, b);
        },
        onEnd: () => {
          clearTimeout(startWatchdog);
          if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
          const latest = lessonPlanRef.current || lesson;
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setIsPaused(false);
          setIsTtsLoading(false);
          currentAudioRef.current = null;
          currentAudioPlayerRef.current = null;
          activeSegmentRef.current = null;
          const lastBoard = latest?.boards?.[e];
          setVisibleBoardLines(lastBoard?.boardLines?.slice(0, MAX_BOARD_LINES) || []);
          setIsStreaming(false);
          setActiveWritingIndex(-1);
          setActiveSpokenWord('');

          setTimeout(() => {
            if (!isActiveRef.current) return;
            if (!latest || e + 1 >= latest.boards.length) {
              setIsDone(true);
              const uid = userProfile?.uid || 'anon';
              const cid = sessionData?.course?.course_id || 'lib';
              const tid = sessionData?.topic?.topic_id || 'core';
              void recordSessionCompletion(uid, tid, sessionData?.topic?.topic_name || tid, sessionData?.course?.course_name || cid, latest?.overallSummary || 'Lesson completed', []);
              void saveLocalVoiceTutorialProgress(uid, cid, tid, 0, 'completed', true, latest);
              return;
            }
            void presentBoard(latest, e + 1);
          }, 1000);
        },
        onError: (err) => {
          clearTimeout(startWatchdog);
          if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
          console.warn('[VoiceTutorial] Batch audio failed:', err);
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          setIsPaused(false);
          setIsTtsLoading(false);
          currentAudioRef.current = null;
          currentAudioPlayerRef.current = null;
          activeSegmentRef.current = null;
          setAudioErrorBoardIdx(targetIdx);
          addToast('Audio playback encountered an issue. Tap "Retry Audio" to reload.', 'info');
        },
      });

      currentAudioRef.current = player;
      currentAudioPlayerRef.current = player;
      activeSegmentRef.current = { start: s, end: e, script: seg.script, key: seg.key, charStarts: seg.charStarts };

      // Safety net: never leave the board stuck in a perpetual loading state.
      // If narration hasn't started within 45s, surface the retry UI instead.
      const startWatchdog = setTimeout(() => {
        if (readyOrStarted || !isActiveRef.current || playSessionIdRef.current !== sessionId) return;
        console.warn('[VoiceTutorial] Audio did not start in time — recovering UI.');
        setIsTtsLoading(false);
        setAudioErrorBoardIdx(targetIdx);
        addToast('Voice server is slow. Board content is ready — tap Retry Audio for narration.', 'info');
      }, 45000);

      // Pre-fetch ONLY the next single board (small request) so the next
      // transition is instant without risking oversized synthesis jobs.
      const nextIdx = targetIdx + 1;
      if (nextIdx < len && isActiveRef.current) {
        const nSeg = buildGradedSegment(lessonPlanRef.current || lesson, nextIdx, nextIdx);
        unifiedVoiceRouter.prefetchSpeech(nSeg.script, nSeg.key, {
          appSettings,
          context: isNotebook ? 'notebook' : 'study_guide',
          isPrivate: isNotebook,
        });
      }
    };

    // ── Speak Board Audio & Live Timestamp Sync ──────────────────────────
    const speakBoardAudio = useCallback(async (
        text: string,
        lines: string[],
        cacheKey: string,
        onEnd?: () => void,
        onErrorCb?: (err: Error) => void
    ): Promise<void> => {
        if (!isActiveRef.current || !text) {
            onEnd?.();
            return;
        }

        stopAudioImmediate();
        clearAllStreamTimers();
        setIsPaused(false);
        setAudioErrorBoardIdx(null);

        if (isMuted) {
            setIsTtsLoading(false);
            setIsSpeaking(false);
            revealLinesProgressively(lines, text);

            if (pendingVisualsRef.current.svg) {
                setActiveDiagramSvg(pendingVisualsRef.current.svg);
                setDiagramKey(k => k + 1);
            }
            onEnd?.();
            return;
        }

        setIsTtsLoading(true);
        setIsSpeaking(false);
        setVisibleBoardLines([]);
        setActiveWritingIndex(-1);
        setActiveDiagramSvg(null);

        const sessionId = ++playSessionIdRef.current;
        const cleanedText = cleanSpokenTextForTTS(text);

        if (!cleanedText) {
            setIsTtsLoading(false);
            revealLinesProgressively(lines, text);
            onEnd?.();
            return;
        }

        const isNotebook = Boolean(
            sessionData?.syllabusContext?.toLowerCase().includes('notebook') || 
            sessionData?.syllabusContext?.toLowerCase().includes('chapter') ||
            sessionData?.course?.course_id?.startsWith('nb_') ||
            sessionData?.source === 'notebook'
        );

        const player = unifiedVoiceRouter.playSpeech(cleanedText, {
            appSettings,
            context: isNotebook ? 'notebook' : 'study_guide',
            withTimestamps: true,
            cacheKey,
            isPrivate: isNotebook,
            onStart: () => {
                if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
                setIsSpeaking(true);
                isSpeakingRef.current = true;
                setIsTtsLoading(false);
                setAudioErrorBoardIdx(null);

                revealLinesProgressively(lines, cleanedText);

                if (pendingVisualsRef.current.svg) {
                    setActiveDiagramSvg(pendingVisualsRef.current.svg);
                    setDiagramKey(k => k + 1);
                }
            },
            onTimeUpdate: (curTime, charIndex, currentWord) => {
                if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
                setActiveSpokenWord(currentWord);
            },
            onEnd: () => {
                if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                setIsPaused(false);
                setIsTtsLoading(false);
                currentAudioRef.current = null;

                setVisibleBoardLines(lines);
                setIsStreaming(false);
                setActiveWritingIndex(-1);
                setActiveSpokenWord('');

                onEnd?.();
            },
            onError: (err) => {
                if (!isActiveRef.current || playSessionIdRef.current !== sessionId) return;
                console.warn('[VoiceTutorial] Audio generation failed on current board:', err);
                setIsSpeaking(false);
                isSpeakingRef.current = false;
                setIsPaused(false);
                setIsTtsLoading(false);
                currentAudioRef.current = null;
                
                // Show text lines so user can still see content
                revealLinesProgressively(lines, cleanedText);
                if (pendingVisualsRef.current.svg) {
                    setActiveDiagramSvg(pendingVisualsRef.current.svg);
                }
                
                // Trigger audio error callback to halt auto-progression and enable retry
                if (onErrorCb) {
                    onErrorCb(err);
                }
            },
        });

        currentAudioRef.current = player as any;
    }, [isMuted, clearAllStreamTimers, revealLinesProgressively, stopAudioImmediate]);

    // ── 2-Phase Phased Topic Lesson Generator (5 mins Part 1 + 5 mins Part 2) ──
    const generateLessonPhase = useCallback(async (
        phase: 1 | 2,
        session: VoiceTutorialSessionData,
        existingPhase1?: SinglePassTopicLesson | null
    ): Promise<SinglePassTopicLesson | null> => {
        const aiClient = createAvelutAI(appSettings, userProfile || null);
        if (!aiClient) {
            addToast('AI service unavailable. Check connection or settings.', 'error');
            return null;
        }

        const topicName = session.topic?.topic_name || session.course.course_name || 'Academic Subject';
        const courseContext = session.syllabusContext ? `SYLLABUS CONTEXT:\n${session.syllabusContext}\n` : '';
        const customPromptCtx = session.customPrompt ? `SPECIFIC FOCUS INSTRUCTIONS:\n${session.customPrompt}\n` : '';

        const isNotebookSource = Boolean(
            session.syllabusContext?.toLowerCase().includes('notebook') || 
            session.syllabusContext?.toLowerCase().includes('chapter') ||
            session.course?.course_id?.startsWith('nb_')
        );

        const phase1Prompt = `You are AVELUT Master Academic Voice & Visual Tutor.
Generate PART 1 (First ~5 Minutes: Boards 1 to 5) of a DEEP, EXPLICIT, CRYSTAL-CLEAR VIDEO-STYLE LESSON for "${topicName}".

${courseContext}${customPromptCtx}
${SVG_REALISTIC_ILLUSTRATION_SYSTEM_PROMPT}

CRITICAL BOARD TIMING & EXPLANATION RULES (30+ SECONDS PER BOARD):
1. SPOKEN EXPLANATION DEPTH:
   - In spokenExplanation, ALWAYS provide a comprehensive, deep verbal walkthrough of at least 75 to 110 spoken words (taking ~30 to 45 seconds to speak). Never rush or give 1-sentence summaries.
2. DOMAIN ADAPTATION:
   - If QUANTITATIVE (Maths, Physics, Accounting, Chemistry calculations): Include a concrete problem setup with given values, reading the question clearly out loud.
   - If QUALITATIVE (Biology, Law, History, Government, Literature, English grammar, Economics concepts): Skip artificial math steps and use clear real-world scenario analysis, doctrines, mechanisms, and case study breakdowns.
3. QUESTION / EXAMPLE READ-ALOUD:
   - In spokenExplanation, ALWAYS read any problem, question, or example scenario out loud word-for-word first before explaining the steps!
4. RELATABLE NIGERIAN REAL-WORLD CONTEXT:
   - All analogies, intuition, and examples MUST use familiar Nigerian daily life scenarios (e.g. POS agent transactions & transfer charges, market bargaining in Balogun/Bodija/Ariaria, Danfo/Keke speed and traffic, NEPA power vs. generator fuel, cooking jollof rice / boiling kettle, buying recharge cards and data plans). Avoid alien or abstract western examples.
5. CLEAN BOARD LINES (1-3 lines max):
   - Keep board lines clean, elegant, and readable with LaTeX equations ($...$ inline or $$...$$ block) and [DIAGRAM] tags. DO NOT use tables, markdown tables, or step badge prefixes.

PART 1 SEQUENCE (BOARDS 1 TO 5):
- Board 1: "Real-World Intuition & Everyday Nigerian Analogy" — Everyday relatable scenario, physical intuition, [DIAGRAM].
- Board 2: "Foundational Definition & Core Meaning" — Plain English definition without jargon, core terminology.
- Board 3: "Governing Law / Fundamental Principle" — Core equation/doctrine/rule ($...$), conditions, [DIAGRAM].
- Board 4: "Variable Anatomy & Component Breakdown" — Symbols, units, meaning of each part.
- Board 5: "Worked Example / Case Study: Problem Setup" — Real-world question read aloud, listing given items and context, [DIAGRAM].

${isNotebookSource ? `NOTEBOOK TUTOR PERSONA: Refer naturally to the student's notebook or textbook chapter.` : ''}

OUTPUT VALID JSON ONLY:
{
  "topicName": "${topicName}",
  "overview": "2-sentence engaging topic overview",
  "boards": [
    {
      "boardId": "board_1",
      "conceptIdx": 0,
      "conceptName": "Everyday Intuition",
      "phaseTitle": "Real-World Intuition & Analogy",
      "boardLines": ["Line 1 with LaTeX ($...$)", "[DIAGRAM]", "Line 2"],
      "spokenExplanation": "Comprehensive 75-110 word conversational narration with [pause] and <emphasis>tags</emphasis>",
      "diagramSvg": "Complete SVG string (viewBox=\\"0 0 800 480\\") or null",
      "diagramCaption": "Caption string or null"
    }
  ],
  "overallSummary": "Part 1 foundations covered."
}`;

        const phase2Prompt = `You are AVELUT Master Academic Voice & Visual Tutor.
Generate PART 2 (Next ~5 Minutes: Boards 6 to 10+) to complete the lesson for "${topicName}".
Previous Part 1 covered: ${existingPhase1?.boards?.map(b => b.phaseTitle).join(', ') || 'Foundations & Setup'}.

${courseContext}${customPromptCtx}
${SVG_REALISTIC_ILLUSTRATION_SYSTEM_PROMPT}

CRITICAL BOARD TIMING & EXPLANATION RULES (30+ SECONDS PER BOARD):
1. SPOKEN EXPLANATION DEPTH:
   - In spokenExplanation, ALWAYS provide a comprehensive, deep verbal walkthrough of at least 75 to 110 spoken words (taking ~30 to 45 seconds to speak). Never rush or give 1-sentence summaries.
2. DOMAIN ADAPTATION:
   - If QUANTITATIVE: Step-by-step formulation, substitution, arithmetic calculation, and intuitive sanity check.
   - If QUALITATIVE: Mechanism breakdown, doctrine application, comparative classification, and outcome analysis.
3. QUESTION / EXAMPLE READ-ALOUD:
   - In spokenExplanation, explicitly narrate and read all questions and step-by-step logic aloud.
4. FAMILIAR NIGERIAN EXAMPLES:
   - Continue using relatable everyday Nigerian scenarios.
5. CLEAN BOARD LINES (1-3 lines max): Clean, uncluttered layout with LaTeX ($...$) and [DIAGRAM]. DO NOT use tables or step badge prefixes.

PART 2 SEQUENCE (BOARDS 6 TO 10+):
- Board 6: "Worked Example / Case Study: Step-by-Step Resolution" — Detailed step-by-step working or doctrine application.
- Board 7: "Worked Example / Case Study: Final Result & Reality Check" — Final answer with units or takeaway analysis, [DIAGRAM].
- Board 8: "Deep-Dive Mechanism / Behind-the-Scenes" — How and why it works under the hood, [DIAGRAM].
- Board 9: "Classic Exam Trap & Student Misconception" — Common error made in exams, why it is false, and how to avoid it.
- Board 10: "Golden Rule & Master Memory Anchor" — Memorable 1-line rule to remember forever, [DIAGRAM].

OUTPUT VALID JSON ONLY:
{
  "topicName": "${topicName}",
  "overview": "Comprehensive mastery continuation",
  "boards": [
    {
      "boardId": "board_6",
      "conceptIdx": 5,
      "conceptName": "Step-by-Step Resolution",
      "phaseTitle": "Worked Example: Resolution",
      "boardLines": ["Line 1", "[DIAGRAM]", "Line 2"],
      "spokenExplanation": "Comprehensive 75-110 word conversational narration with [pause] and <emphasis>tags</emphasis>",
      "diagramSvg": "Complete SVG string (viewBox=\\"0 0 800 480\\") or null",
      "diagramCaption": "Caption string or null"
    }
  ],
  "overallSummary": "Comprehensive summary of topic mastery."
}`;

        try {
            const parts: any[] = [];
            if (session.image) {
                try {
                    const { dataUrl, mimeType } = await readImageAsDataUrl(session.image);
                    const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                    if (base64Data) {
                        parts.push({ inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } });
                    }
                } catch (imgErr) {
                    console.warn('[LessonGen] Failed to format image for AI:', imgErr);
                }
            }
            parts.push({ text: phase === 1 ? phase1Prompt : phase2Prompt });

            const result = await aiClient.models.generateContent({
                model: appSettings?.openrouter_model || 'qwen/qwen3.7-flash',
                contents: [{ role: 'user', parts }],
                config: { responseMimeType: 'application/json', temperature: 0.35, maxOutputTokens: 8192 },
            });
            const raw = getResponseText(result);
            if (!raw) throw new Error('Empty lesson response');
            const lesson: SinglePassTopicLesson = robustParseJson<SinglePassTopicLesson>(raw);
            return lesson;
        } catch (err) {
            console.error(`[LessonGen Phase ${phase}] failed:`, err);
            return null;
        }
    }, [appSettings, userProfile, addToast]);

    // ── Present Precompiled Board Unit ──────────────────────────────────
    const presentBoard = useCallback(async (
        lesson: SinglePassTopicLesson,
        targetIndex: number
    ) => {
        if (!isActiveRef.current || !lesson || !lesson.boards || lesson.boards.length === 0) return;

        if (targetIndex >= lesson.boards.length) {
            // If Phase 2 is still compiling in background, show waiting state
            if (isBackgroundCompilingPhase2) {
                addToast('Loading Part 2 of lesson...', 'info');
                return;
            }
            setIsDone(true);
            const uid = userProfile?.uid || 'anon';
            const cid = sessionData?.course?.course_id || 'general';
            const tid = sessionData?.topic?.topic_id || 'core';
            const tName = sessionData?.topic?.topic_name || tid;
            const cName = sessionData?.course?.course_name || cid;
            void recordSessionCompletion(uid, tid, tName, cName, lesson.overallSummary || 'Topic completed', []);
            void saveLocalVoiceTutorialProgress(uid, cid, tid, 0, 'completed', true, lesson);
            return;
        }

        const board = lesson.boards[targetIndex];
        setBoardIndex(targetIndex);
        boardIndexRef.current = targetIndex;
        setAudioErrorBoardIdx(null);

        const uid = userProfile?.uid || 'anon';
        const cid = sessionData?.course?.course_id || 'general';
        const tid = sessionData?.topic?.topic_id || 'core';
        void saveLocalVoiceTutorialProgress(uid, cid, tid, targetIndex, board.phaseTitle, false, lesson);

        // Sanitize visual attachments
        const svg = sanitizeAndValidateSvg(board.diagramSvg);
        const table = (board.tableMarkdown && board.tableMarkdown.trim().includes('|')) ? board.tableMarkdown : null;

        pendingVisualsRef.current = {
            svg,
            table,
            caption: board.diagramCaption || board.phaseTitle,
        };
        pendingBoardLinesRef.current = board.boardLines.slice(0, MAX_BOARD_LINES);

        // Pre-fetch next board's audio in background
        const isNotebook = Boolean(
            sessionData?.syllabusContext?.toLowerCase().includes('notebook') || 
            sessionData?.syllabusContext?.toLowerCase().includes('chapter') ||
            sessionData?.course?.course_id?.startsWith('nb_') ||
            sessionData?.source === 'notebook'
        );

        // Batch playback fetches whole groups at once; no per-board prefetch needed.

        // On board audio completion: Auto-advance smoothly
        const onBoardAudioEnd = () => {
            if (!isActiveRef.current) return;
            setTimeout(() => {
                if (!isActiveRef.current) return;
                // Auto-advance to next board
                const nextBoardIdx = boardIndexRef.current + 1;
                void presentBoard(lesson, nextBoardIdx);
            }, 1200);
        };

        // On board audio error: Halt auto-advance, keep board stored, allow user to retry
        const onBoardAudioError = () => {
            if (!isActiveRef.current) return;
            setAudioErrorBoardIdx(targetIndex);
            addToast('Audio playback encountered an issue. Tap "Retry Audio" to reload.', 'info');
        };

        await playGrokBatch(lesson, targetIndex);

    }, [sessionData, userProfile, isBackgroundCompilingPhase2, addToast, playGrokBatch]);

    // ── Retry Audio on Error Handler ────────────────────────────────────
    const handleRetryAudio = useCallback(async () => {
        if (!lessonPlan || audioErrorBoardIdx === null) return;
        setIsRetryingAudio(true);
        const currentIdx = audioErrorBoardIdx;
        setIsRetryingAudio(false);
        setAudioErrorBoardIdx(null);
        void presentBoard(lessonPlan, currentIdx);
    }, [lessonPlan, audioErrorBoardIdx, presentBoard]);

    // ── Session Bootstrap & 2-Phase Phased Compilation ─────────────────
    const bootstrapSession = useCallback(async () => {
        if (!sessionData) return;

        const uid = userProfile?.uid || 'anon';
        const cid = sessionData.course?.course_id || 'general';
        const tid = sessionData.topic?.topic_id || 'core';
        const lessonCacheKey = `avelut_topic_lesson_${cid}_${tid}`;

        const cachedLesson = readCachedJson<SinglePassTopicLesson | null>(lessonCacheKey, null);
        const sqliteRecord = await getLocalVoiceTutorialProgress(uid, cid, tid);
        
        let lesson: SinglePassTopicLesson | null = cachedLesson || (sqliteRecord?.blueprint ? (sqliteRecord.blueprint as SinglePassTopicLesson) : null);

        if (!lesson || !lesson.boards || lesson.boards.length === 0) {
            const tutorialCost = getFeatureCost('live_tutorial', appSettings) || 150;
            if (userProfile && !isPaidSubscriber(userProfile) && !isExempt(userProfile)) {
                const creditCheck = checkAICredits(userProfile, tutorialCost, appSettings);
                if (!creditCheck.allowed) {
                    setLimitModalData({ cost: tutorialCost, balance: creditCheck.balance });
                    setShowLimitModal(true);
                    addToast('Live tutorial requires a subscription or at least 150 credits.', 'error');
                    return;
                }
            }

            setIsGeneratingLesson(true);
            setLessonGenStep('Pre-compiling Part 1 (First 5 Minutes)...');

            // 1. Generate Phase 1 (First ~5 minutes)
            const phase1Lesson = await generateLessonPhase(1, sessionData);
            if (!phase1Lesson || !isActiveRef.current) {
                setIsGeneratingLesson(false);
                addToast('Failed to compile Part 1 of tutorial. Please try again.', 'error');
                return;
            }

            if (userProfile && !isPaidSubscriber(userProfile) && !isExempt(userProfile)) {
                void deductAICredits(userProfile.uid, tutorialCost, 'Live Voice Tutorial', appSettings);
            }

            lesson = phase1Lesson;
            setIsGeneratingLesson(false);
            setIsDone(false);
            setLessonPlan(phase1Lesson);
            lessonPlanRef.current = phase1Lesson;
            writeCachedJson(lessonCacheKey, phase1Lesson);
            await saveLocalVoiceTutorialProgress(uid, cid, tid, 0, 'phase1_ready', false, phase1Lesson);

            // Start playing Phase 1 immediately. Each board pre-fetches the
            // next single board inside playGrokBatch (small, cached requests).
            void presentBoard(phase1Lesson, 0);

            // 2. Background compile Phase 2 (Next ~5 minutes)
            setIsBackgroundCompilingPhase2(true);
            void (async () => {
                try {
                    const phase2Lesson = await generateLessonPhase(2, sessionData, phase1Lesson);
                    if (!isActiveRef.current || !phase2Lesson || !phase2Lesson.boards || phase2Lesson.boards.length === 0) {
                        setIsBackgroundCompilingPhase2(false);
                        return;
                    }

                    // Renumber conceptIdx for Phase 2 boards
                    const mergedBoards = [
                        ...phase1Lesson.boards,
                        ...phase2Lesson.boards.map((b, idx) => ({
                            ...b,
                            conceptIdx: phase1Lesson.boards.length + idx,
                            boardId: `board_${phase1Lesson.boards.length + idx + 1}`,
                        })),
                    ];

                    const completeLesson: SinglePassTopicLesson = {
                        ...phase1Lesson,
                        boards: mergedBoards,
                        overallSummary: phase2Lesson.overallSummary || phase1Lesson.overallSummary,
                    };

                    if (isActiveRef.current) {
                        setLessonPlan(completeLesson);
                        lessonPlanRef.current = completeLesson;
                        writeCachedJson(lessonCacheKey, completeLesson);
                        await saveLocalVoiceTutorialProgress(uid, cid, tid, boardIndexRef.current, 'full_lesson_ready', false, completeLesson);
                    }
                } catch (bgErr) {
                    console.warn('[VoiceTutorial] Background Phase 2 compilation error:', bgErr);
                } finally {
                    if (isActiveRef.current) {
                        setIsBackgroundCompilingPhase2(false);
                    }
                }
            })();
            return;
        }

        if (!isActiveRef.current || !lesson) return;
        setIsDone(false);
        setLessonPlan(lesson);
        lessonPlanRef.current = lesson;

        let startBoardIndex = sqliteRecord?.conceptIdx ?? 0;
        if (sqliteRecord?.isCompleted || startBoardIndex >= lesson.boards.length) {
            startBoardIndex = 0;
        }

        await presentBoard(lesson, startBoardIndex);
    }, [sessionData, userProfile, generateLessonPhase, presentBoard, addToast]);

    // ── Start on mount & Hide bottom nav on mobile ──────────────────────
    // Keep a stable ref to bootstrap so the mount effect below never re-runs
    // on ordinary re-renders. Its cleanup calls stopAudioImmediate(), which
    // invalidates in-flight TTS sessions (engine bumps activeSessionId) —
    // that silently discarded freshly-downloaded audio and left boards stuck
    // on "Synthesizing voice narration..." forever.
    const bootstrapRef = useRef<() => Promise<void> | void>(() => {});
    useEffect(() => {
        bootstrapRef.current = bootstrapSession;
    });

    useEffect(() => {
        isActiveRef.current = true;
        setCustomHeaderConfig?.({ hideBottomNav: true });
        if (!hasStartedRef.current && sessionData) {
            hasStartedRef.current = true;
            void bootstrapRef.current?.();
        }
        return () => {
            isActiveRef.current = false;
            setCustomHeaderConfig?.(null);
            stopAudioImmediate();
            clearAllStreamTimers();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionData]);

    // ── Live Interruptible Q&A Handler ──────────────────────────────────
    const handleStudentInterruptionQuestion = useCallback(async (
        questionText: string,
        imageAttachment?: { base64: string; mimeType: string } | null
    ) => {
        if (!questionText.trim() && !imageAttachment) return;
        if (!lessonPlan || isGeneratingLesson) return;

        // --- Credit check: 50 credits per question ---
        const qaCost = getFeatureCost('live_tutorial_question', appSettings) || 50;
        const creditCheck = checkAICredits(userProfile, qaCost, appSettings);
        if (!creditCheck.allowed) {
            setLimitModalData({ cost: qaCost, balance: creditCheck.balance });
            setShowLimitModal(true);
            addToast('Insufficient credits to ask a question. Top up to continue.', 'info');
            return;
        }

        // 1. Save resume position, then immediately pause current board audio
        qaResumeSeekRef.current = lastKnownTimeRef.current;
        qaResumeBoardRef.current = boardIndexRef.current;
        stopAudioImmediate();
        clearAllStreamTimers();
        setIsAnsweringQuestion(true);
        setQaQuestion(questionText);
        setQaAnswer(null);

        const currentBoard = lessonPlan.boards[boardIndexRef.current] || lessonPlan.boards[0];
        const topicName = lessonPlan.topicName || sessionData?.topic?.topic_name || 'Topic';

        const aiClient = createAvelutAI(appSettings, userProfile || null);
        if (!aiClient) {
            setIsAnsweringQuestion(false);
            addToast('Could not reach AI to answer question.', 'error');
            return;
        }

        const qaPrompt = `You are AVELUT Master Academic Voice Tutor.
The student is watching a voice tutorial on "${topicName}".
Current Board: "${currentBoard.phaseTitle}" (${currentBoard.conceptName}).
Board lines visible on screen: ${currentBoard.boardLines.join(' | ')}.
The student paused the video lesson to ask: "${questionText}".

Provide a clear, encouraging answer in AT MOST 2 short sentences (under 40 words total), plain English, no lists, no markdown.
At the very end say exactly: "Now, let us continue our lesson."`;

        try {
            const parts: any[] = [];
            if (imageAttachment) {
                const base64Data = imageAttachment.base64.includes(',') ? imageAttachment.base64.split(',')[1] : imageAttachment.base64;
                parts.push({ inlineData: { data: base64Data, mimeType: imageAttachment.mimeType || 'image/jpeg' } });
            }
            parts.push({ text: qaPrompt });

            const result = await aiClient.models.generateContent({
                model: appSettings?.openrouter_model || 'qwen/qwen3.7-flash',
                contents: [{ role: 'user', parts }],
                config: { temperature: 0.3, maxOutputTokens: 150 },
            });

            const answerText = getResponseText(result) || "I see what you mean. Let's make sure that's clear, and now let's continue our lesson.";
            setQaAnswer(answerText);

            // Deduct 50 credits for this question
            if (userProfile?.uid) {
                void deductAICredits(userProfile.uid, qaCost, 'Live Tutorial Q&A Question', appSettings);
            }

            // Speak answer to student (cached so repeat questions cost $0)
            const cleanedAnswer = cleanSpokenTextForTTS(answerText);
            const cidQA = sessionData?.course?.course_id || 'general';
            const tidQA = sessionData?.topic?.topic_id || 'core';
            unifiedVoiceRouter.playSpeech(cleanedAnswer, {
                appSettings,
                context: (sessionData?.source === 'notebook') ? 'notebook' : 'study_guide',
                withTimestamps: true,
                cacheKey: `avelut_${cidQA}_${tidQA}_qa_${simpleHash(cleanedAnswer)}`,
                onEnd: () => {
                    if (!isActiveRef.current) return;
                    setTimeout(() => {
                        if (!isActiveRef.current) return;
                        setIsAnsweringQuestion(false);
                        setQaQuestion(null);
                        setQaAnswer(null);
                        setAttachedImage(null);

                        // Resume current board
                        void presentBoard(lessonPlan, boardIndexRef.current);
                    }, 1000);
                },
            });
        } catch (err) {
            console.warn('[QA Interruption] failed:', err);
            setIsAnsweringQuestion(false);
            setQaQuestion(null);
            setQaAnswer(null);
            void presentBoard(lessonPlan, boardIndexRef.current);
        }
    }, [lessonPlan, isGeneratingLesson, sessionData, appSettings, userProfile, addToast, stopAudioImmediate, clearAllStreamTimers, presentBoard]);

    // ── Microphone Controller ───────────────────────────────────────────
    const stopMicImmediate = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch (_) {}
            recognitionRef.current = null;
        }
        setIsMicListening(false);
        setMicDisplay('');
        spokenTextRef.current = '';
    }, []);

    const toggleMic = useCallback(() => {
        if (isMicListening) {
            stopMicImmediate();
            return;
        }

        // Pause audio immediately
        stopAudioImmediate();

        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            addToast('Speech recognition not supported on this browser. Type your question below.', 'info');
            return;
        }

        try {
            const rec = new SR();
            rec.continuous = false;
            rec.interimResults = true;
            rec.lang = 'en-US';
            let speechTimeout: ReturnType<typeof setTimeout> | null = null;
            let hasSubmitted = false;

            rec.onstart = () => {
                if (isActiveRef.current) {
                    setIsMicListening(true);
                    setMicDisplay('');
                    spokenTextRef.current = '';
                }
            };

            const submitSpeech = (text: string) => {
                if (hasSubmitted) return;
                hasSubmitted = true;
                if (speechTimeout) clearTimeout(speechTimeout);
                stopMicImmediate();
                const final = text.trim();
                if (final.length > 1) {
                    addToast(`Asking: "${final}"`, 'info');
                    void handleStudentInterruptionQuestion(final, attachedImage);
                }
            };

            rec.onresult = (e: any) => {
                const resultsArr = Array.from(e.results);
                const t = resultsArr.map((r: any) => r[0].transcript).join(' ').trim();
                spokenTextRef.current = t;
                if (isActiveRef.current) setMicDisplay(t);

                if (speechTimeout) clearTimeout(speechTimeout);
                if (t.length > 1) {
                    speechTimeout = setTimeout(() => {
                        submitSpeech(spokenTextRef.current);
                    }, 1400);
                }
            };

            rec.onend = () => {
                if (!isActiveRef.current) return;
                if (!hasSubmitted && spokenTextRef.current.trim().length > 1) {
                    submitSpeech(spokenTextRef.current);
                } else {
                    stopMicImmediate();
                }
            };

            rec.onerror = () => { stopMicImmediate(); };
            recognitionRef.current = rec;
            rec.start();
        } catch (_) {
            stopMicImmediate();
        }
    }, [isMicListening, stopMicImmediate, stopAudioImmediate, addToast, attachedImage, handleStudentInterruptionQuestion]);

    // ── Navigation & Control Actions ────────────────────────────────────
    const togglePauseAI = useCallback(() => {
        if (!lessonPlan) return;
        const player = currentAudioPlayerRef?.current;
        if (isSpeaking && !isPaused && player) {
            // Real pause: freeze the live audio, no refetch.
            player.pause?.();
            setIsPaused(true);
            setIsSpeaking(false);
            isSpeakingRef.current = false;
        } else if (isPaused && player) {
            // Resume exact position without restarting.
            player.resume?.();
            setIsPaused(false);
            setIsSpeaking(true);
            isSpeakingRef.current = true;
        } else {
            setIsPaused(false);
            void presentBoard(lessonPlan, boardIndexRef.current);
        }
    }, [isSpeaking, isPaused, lessonPlan, presentBoard]);

    const toggleMute = useCallback(() => {
        setIsMuted(prev => !prev);
        if (!isMuted) {
            stopAudioImmediate();
            currentAudioPlayerRef.current = null;
            activeSegmentRef.current = null;
        }
    }, [isMuted, stopAudioImmediate]);

    const handleRestartBoard = useCallback(() => {
        if (!lessonPlan) return;
        currentAudioPlayerRef.current = null;
        activeSegmentRef.current = null;
        void presentBoard(lessonPlan, boardIndexRef.current);
    }, [lessonPlan, presentBoard]);

    const handleAdvanceNextBoard = useCallback(() => {
        if (!lessonPlan) return;
        void presentBoard(lessonPlan, boardIndexRef.current + 1);
    }, [lessonPlan, presentBoard]);

    const handlePreviousBoard = useCallback(() => {
        if (!lessonPlan) return;
        currentAudioPlayerRef.current = null;
        activeSegmentRef.current = null;
        void presentBoard(lessonPlan, Math.max(0, boardIndexRef.current - 1));
    }, [lessonPlan, presentBoard]);

    const handleGoBack = useCallback(async () => {
        setIsNavigatingBack(true);
        isActiveRef.current = false;
        stopAudioImmediate();
        clearAllStreamTimers();
        if (onBack) {
            onBack();
        } else if (onNavigate) {
            onNavigate('study_guide');
        }
    }, [onBack, onNavigate, stopAudioImmediate, clearAllStreamTimers]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const { dataUrl, mimeType } = await readImageAsDataUrl(file);
            setAttachedImage({ base64: dataUrl, mimeType });
            addToast('Work photo attached. Tap mic to ask your question!', 'info');
        } catch (_) {
            addToast('Failed to attach image.', 'error');
        }
    };

    // ── Custom Header Integration ───────────────────────────────────────
    useEffect(() => {
        if (setCustomHeaderConfig) {
            const currentBoard = lessonPlan?.boards?.[boardIndex];
            const totalBoards = lessonPlan?.boards?.length || 1;
            const topicName = lessonPlan?.topicName || sessionData?.topic?.topic_name || 'Interactive Tutorial';

            setCustomHeaderConfig({
                leftActions: (
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[calc(100vw-110px)] sm:max-w-none">
                        <button
                            onClick={handleGoBack}
                            disabled={isNavigatingBack}
                            className="w-10 h-10 rounded-full bg-white hover:bg-slate-50 border border-[#E3E9F1] flex items-center justify-center text-[#0F172A] active:scale-95 cursor-pointer transition-all shrink-0 shadow-2xs"
                            title="Back to Study Guide"
                            aria-label="Back to Study Guide"
                        >
                            <i className="bi bi-arrow-left text-base font-bold text-[#0066FF]"></i>
                        </button>
                        <div className="min-w-0 flex flex-col justify-center">
                            <span className="text-xs sm:text-sm font-bold text-[#0F172A] truncate max-w-[120px] sm:max-w-[280px] md:max-w-[400px]">
                                {topicName}
                            </span>
                            {currentBoard && (
                                <span className="text-[10px] text-[#0066FF] font-mono font-bold truncate max-w-[120px] sm:max-w-[280px]">
                                    Board {boardIndex + 1}/{totalBoards}: {currentBoard.phaseTitle}
                                </span>
                            )}
                        </div>
                    </div>
                ),
                rightActions: (
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {sessionData?.image && (
                            <button
                                onClick={() => setShowScannedImageModal(true)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#0066FF] text-xs font-bold transition-all cursor-pointer shadow-xs"
                                title="View original problem scan"
                            >
                                <i className="bi bi-image text-xs"></i>
                                <span className="hidden sm:inline">Scan</span>
                            </button>
                        )}
                        <button
                            onClick={toggleMute}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#E3E9F1] bg-white hover:bg-slate-50 text-xs font-bold text-[#0F172A] cursor-pointer transition-colors active:scale-95 shadow-xs"
                            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                        >
                            <i className={`bi ${isMuted ? 'bi-volume-mute-fill text-rose-500' : 'bi-volume-up-fill text-[#0066FF]'} text-sm`}></i>
                            <span className="text-[11px] hidden md:inline">{isMuted ? 'Muted' : 'Altair'}</span>
                        </button>
                    </div>
                ),
                hideBottomNav: true,
                className: 'bg-[#F6F6F3]/95 border-b border-[#E3E9F1] backdrop-blur-md'
            });
        }

        return () => {
            if (setCustomHeaderConfig) {
                setCustomHeaderConfig(null);
            }
        };
    }, [setCustomHeaderConfig, sessionData, lessonPlan, boardIndex, isMuted, isNavigatingBack, handleGoBack, toggleMute]);

    // ── Visual Elements ─────────────────────────────────────────────────
    const renderInlineDiagram = () => {
        if (!activeDiagramSvg) return null;
        return (
            <div className="w-full my-3 flex flex-col items-center bg-[#F8FAFC] p-3 sm:p-5 rounded-2xl border border-[#E3E9F1] shadow-xs animate-fade-in transition-all">
                <div
                    key={`svg-${diagramKey}`}
                    className="w-full max-h-[250px] sm:max-h-[300px] flex items-center justify-center py-1 overflow-visible [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[250px] sm:[&>svg]:max-h-[300px]"
                    dangerouslySetInnerHTML={{ __html: activeDiagramSvg }}
                />
            </div>
        );
    };

    const hasExplicitDiagramTag = visibleBoardLines.some(l => /\[(diagram|visual|image)\]/i.test(l));

    const totalBoards = lessonPlan?.boards?.length || 1;
    const progressPercent = Math.min(100, Math.round(((boardIndex + 1) / totalBoards) * 100));
    const currentBoard = lessonPlan?.boards?.[boardIndex];

    // ── Render ──────────────────────────────────────────────────────────
    if (useTeachingEngine) {
        return (
            <TeachingEngineSessionView
                topicTitle={sessionData?.topic?.topic_name || sessionData?.customPrompt || 'Live Tutorial'}
                courseName={sessionData?.course?.course_name || 'Academic Topic'}
                syllabusContext={sessionData?.syllabusContext}
                userId={userProfile?.uid}
                userProfile={userProfile}
                appSettings={propAppSettings}
                onClose={handleGoBack}
            />
        );
    }

    return (
        <div className="flex-1 w-full h-full flex flex-col bg-[#F6F6F3] text-[#0F172A] overflow-hidden select-none relative">

            {/* ── Progress Bar & Background Phase 2 Indicator ─────────── */}
            {lessonPlan && !isGeneratingLesson && (
                <div className="w-full shrink-0 flex flex-col">
                    <div className="h-1.5 bg-[#E3E9F1] w-full">
                        <div
                            className="h-full bg-[#0066FF] rounded-r-full transition-all duration-500"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                    {isBackgroundCompilingPhase2 && (
                        <div className="w-full bg-blue-50/90 border-b border-blue-100 px-3 py-1 flex items-center justify-between text-[11px] text-[#0066FF] font-semibold">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-[#0066FF] animate-ping" />
                                <span>Part 1 active — seamlessly compiling Part 2 (+5 mins) in background...</span>
                            </span>
                            <span className="font-mono text-[10px] bg-white border border-blue-200 px-2 py-0.5 rounded-full">
                                Auto-extending
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Single-Pass Generation Screen ───────────────────────── */}
            {isGeneratingLesson && (
                <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 text-center animate-fade-in my-auto">
                    <div className="w-20 h-20 rounded-3xl bg-white border-2 border-blue-200 flex items-center justify-center shadow-lg shadow-blue-500/10">
                        <i className="bi bi-mortarboard-fill text-3xl text-[#0066FF]"></i>
                    </div>

                    <div className="space-y-2 max-w-md">
                        <span className="text-xs font-mono font-bold tracking-widest uppercase text-[#0066FF]">
                            Avelut 2-Stage Voice Engine
                        </span>
                        <h2 className="text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight">
                            {lessonGenStep || 'Pre-compiling Part 1 (First 5 Minutes)...'}
                        </h2>
                        <p className="text-xs sm:text-sm text-[#64748B]">
                            Preparing first 5 minutes of boards, diagrams, worked examples, and voice synthesis so you can start right away.
                        </p>
                    </div>

                    <div className="w-full max-w-xs bg-[#E3E9F1] rounded-full h-2 overflow-hidden shadow-inner">
                        <div className="bg-[#0066FF] h-full rounded-full w-full animate-pulse transition-all" />
                    </div>
                </div>
            )}

            {/* ── Completion Screen ───────────────────────────────────── */}
            {isDone && !isGeneratingLesson && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center pb-24 md:pb-6 max-w-xl mx-auto animate-fade-in my-auto">
                    <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0066FF]">
                        <i className="bi bi-mortarboard-fill text-3xl"></i>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-[#0F172A]">Topic Mastered!</h3>
                        <p className="text-xs font-semibold text-[#0066FF] mt-1 uppercase tracking-wider">{sessionData?.topic?.topic_name}</p>
                    </div>
                    <p className="text-sm text-[#64748B] max-w-md leading-relaxed">{lessonPlan?.overallSummary}</p>
                    
                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-2">
                        <button
                            onClick={() => presentBoard(lessonPlan!, 0)}
                            className="w-full sm:flex-1 py-3.5 px-6 bg-white hover:bg-slate-50 border border-[#E3E9F1] text-[#0F172A] rounded-2xl font-bold text-sm shadow-xs transition-colors active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                        >
                            <i className="bi bi-arrow-counterclockwise"></i>
                            <span>Re-play Tutorial</span>
                        </button>
                        <button
                            onClick={handleGoBack}
                            className="w-full sm:w-auto px-6 py-3.5 bg-[#0066FF] hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-xs transition-colors active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                        >
                            <i className="bi bi-journal-check"></i>
                            <span>Study Guide</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ── Main Fullscreen Teaching Canvas ─────────────────────── */}
            {!isGeneratingLesson && !isDone && (
                <main className="flex-1 flex flex-col px-2 sm:px-4 pt-1.5 pb-2 w-full h-full gap-2 min-h-0 overflow-hidden">

                    {/* ── Elevated Pure White Academic Board ── */}
                    <div
                        ref={boardScrollRef}
                        className="relative flex-1 min-h-0 flex flex-col justify-start bg-white border-2 border-[#E3E9F1] rounded-2xl sm:rounded-3xl p-4 sm:p-7 shadow-lg overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-[#CBD5E1] [&::-webkit-scrollbar-thumb]:rounded-full text-[#0F172A]"
                    >
                        {/* ── Audio Generation Error / Retry Banner ── */}
                        {audioErrorBoardIdx === boardIndex && (
                            <div className="sticky top-0 z-30 mb-3.5 p-3.5 sm:p-4 rounded-2xl bg-blue-50 border-2 border-blue-200 text-[#0F172A] shadow-md animate-fade-in flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#0F172A] flex items-center justify-center shrink-0">
                                        <i className="bi bi-exclamation-triangle-fill text-base"></i>
                                    </div>
                                    <div>
                                        <p className="text-xs sm:text-sm font-bold text-[#0F172A]">Voice audio generation paused</p>
                                        <p className="text-[11px] text-[#64748B]">Board content is saved. Tap Retry to reload audio narration.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleRetryAudio}
                                    disabled={isRetryingAudio}
                                    className="px-4 py-2 bg-[#0066FF] hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer shrink-0 flex items-center gap-1.5"
                                >
                                    <i className={`bi ${isRetryingAudio ? 'bi-arrow-repeat animate-spin' : 'bi-arrow-counterclockwise'} text-sm`}></i>
                                    <span>{isRetryingAudio ? 'Retrying...' : 'Retry Audio'}</span>
                                </button>
                            </div>
                        )}

                        {/* ── Live Q&A Realtime Audio Waveform Overlay ── */}
                        {isAnsweringQuestion && (
                            <div className="sticky top-0 z-30 mb-4 p-4 sm:p-5 rounded-2xl bg-[#0F172A] text-white border-2 border-[#0066FF] shadow-xl animate-fade-in">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 text-xs font-bold text-blue-200 uppercase tracking-wider">
                                        <i className="bi bi-broadcast text-[#0066FF] animate-pulse text-sm"></i>
                                        <span>Altair Explaining Your Question</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#0066FF] animate-ping" />
                                        <span className="text-[10px] font-mono font-bold text-blue-200 uppercase tracking-wider">Live Voice</span>
                                    </div>
                                </div>

                                <p className="text-xs sm:text-sm font-medium text-blue-100 mb-3 italic">
                                    "{qaQuestion}"
                                </p>

                                {/* Realtime Audio Waveform Animation Bars */}
                                <div className="flex items-center justify-center gap-2 py-3.5 px-4 bg-black/30 rounded-xl border border-white/10 shadow-inner">
                                    <div className="flex items-center gap-1.5 h-8">
                                        <span className="w-1.5 bg-[#0066FF] rounded-full animate-[bounce_0.8s_ease-in-out_infinite] h-3" />
                                        <span className="w-1.5 bg-blue-400 rounded-full animate-[bounce_0.6s_ease-in-out_infinite_0.15s] h-6" />
                                        <span className="w-1.5 bg-white rounded-full animate-[bounce_0.75s_ease-in-out_infinite_0.3s] h-8" />
                                        <span className="w-1.5 bg-blue-300 rounded-full animate-[bounce_0.5s_ease-in-out_infinite_0.1s] h-7" />
                                        <span className="w-1.5 bg-[#0066FF] rounded-full animate-[bounce_0.7s_ease-in-out_infinite_0.25s] h-5" />
                                        <span className="w-1.5 bg-blue-400 rounded-full animate-[bounce_0.9s_ease-in-out_infinite_0.05s] h-4" />
                                    </div>
                                    <span className="text-xs font-semibold text-white ml-2 tracking-wide">
                                        {qaAnswer ? 'Speaking answer aloud...' : 'Preparing spoken explanation...'}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col h-full gap-3.5">
                            {/* ── Fixed Board Topic Header ── */}
                            <div className="w-full border-b border-[#E3E9F1] pb-3 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 shrink-0">
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] font-mono tracking-widest uppercase text-[#0066FF] font-bold">
                                        {currentBoard?.conceptName || 'Lesson Unit'}
                                    </span>
                                    <h2 className="font-bold text-xl sm:text-2xl text-[#0F172A] tracking-tight truncate">
                                        {currentBoard?.phaseTitle || lessonPlan?.topicName}
                                    </h2>
                                </div>
                                <span className="text-[11px] font-mono font-bold text-[#64748B] bg-[#F1F5F9] px-2.5 py-1 rounded-full border border-[#E3E9F1] shrink-0">
                                    Board {boardIndex + 1} of {totalBoards}
                                </span>
                            </div>

                            {/* ── Waiting for voice synthesizer ── */}
                            {visibleBoardLines.length === 0 && !isDone && (
                                <div className="flex-1 flex flex-col items-start justify-start pt-6 sm:pt-8 px-2 animate-fade-in">
                                    <div className="flex items-center gap-3 font-mono text-sm sm:text-base tracking-wide">
                                        <span className="inline-block w-3 h-5 sm:w-3.5 sm:h-6 bg-[#0066FF] rounded-xs animate-blink" />
                                        <span className="text-xs text-[#64748B] font-mono italic">
                                            {isTtsLoading ? 'Altair Voice Synthesizer active...' : 'Loading board...'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* ── Board Content Lines ── */}
                            {visibleBoardLines.length > 0 && (
                                <div className="flex-1 w-full space-y-3.5 pb-2">
                                    {visibleBoardLines.map((line, idx) => {
                                        const trimmed = line.trim();
                                        const isExplicitDiagram = /\[(diagram|visual|image)\]/i.test(trimmed);

                                        if (isExplicitDiagram) {
                                            return (
                                                <div key={`inline-diag-${idx}`}>
                                                    {renderInlineDiagram()}
                                                </div>
                                            );
                                        }

                                        const isVarLine       = trimmed.includes('→') || trimmed.includes('leads to');
                                        const isBlockFormula  = trimmed.startsWith('$$');
                                        const isWritingActive = (idx === activeWritingIndex || (idx === visibleBoardLines.length - 1 && isStreaming)) && isStreaming;

                                        const shouldAutoInsertDiagram = !hasExplicitDiagramTag && activeDiagramSvg && (
                                            idx === 0 || (visibleBoardLines.length === 1 && idx === 0)
                                        );

                                        return (
                                            <React.Fragment key={`${idx}-${line.slice(0, 15)}`}>
                                                <div className="flex items-start gap-2.5 animate-fade-in w-full">
                                                    {isBlockFormula ? (
                                                        <div className="w-full text-center text-[#0F172A] py-2.5 overflow-x-auto bg-[#F8FAFC] rounded-2xl border border-[#E3E9F1] px-4 my-1 shadow-xs">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                                {formatLatexMath(line)}
                                                            </ReactMarkdown>
                                                        </div>
                                                    ) : isVarLine ? (
                                                        <div className="font-mono text-sm sm:text-base text-[#0F172A] leading-snug pl-2 w-full font-medium">
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                                rehypePlugins={[rehypeKatex]}
                                                                components={{ p: ({ node, ...props }) => <span {...props} /> }}
                                                            >{formatLatexMath(line.trim())}</ReactMarkdown>
                                                            {isWritingActive && (
                                                                <span className="inline-block w-2 h-4 sm:w-2.5 sm:h-5 ml-1.5 bg-[#0066FF] rounded-xs animate-blink align-middle" />
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="text-base sm:text-xl text-[#0F172A] leading-relaxed tracking-tight w-full font-medium">
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                                rehypePlugins={[rehypeKatex]}
                                                                components={{ p: ({ node, ...props }) => <span {...props} /> }}
                                                            >{formatLatexMath(line)}</ReactMarkdown>
                                                            {isWritingActive && (
                                                                <span className="inline-block w-2 h-4 sm:w-2.5 sm:h-5 ml-1.5 bg-[#0066FF] rounded-xs animate-blink align-middle" />
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {shouldAutoInsertDiagram && renderInlineDiagram()}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {isMicListening && micDisplay && (
                        <div className="shrink-0 flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-[#0F172A] animate-pulse px-3.5 py-1 bg-white rounded-full w-fit mx-auto border border-[#E3E9F1] shadow-xs">
                            <i className="bi bi-mic-fill text-red-500"></i>
                            <span>"{micDisplay}..."</span>
                        </div>
                    )}

                    {/* ── Floating White Bottom Control Bar (Enlarged Buttons) ── */}
                    <div className="shrink-0 flex flex-col gap-2 bg-white/95 border border-[#E3E9F1] rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-xl backdrop-blur-md w-full mb-1 sm:mb-2 max-w-xl mx-auto">
                        
                        {attachedImage && (
                            <div className="flex items-center justify-between gap-2 p-2 px-3.5 bg-[#F8FAFC] border border-[#E3E9F1] rounded-2xl w-full animate-fade-in shadow-xs">
                                <div className="flex items-center gap-2.5">
                                    <img src={attachedImage.base64} alt="Attached work" className="w-10 h-10 object-cover rounded-xl border border-[#CBD5E1]" />
                                    <div>
                                        <p className="text-xs font-bold text-[#0F172A]">Photo Attached</p>
                                        <p className="text-[10px] text-[#64748B]">Tap mic to ask your question</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => handleStudentInterruptionQuestion('Please inspect my handwritten problem in this attached photo.', attachedImage)}
                                        className="px-3.5 py-2 bg-[#0066FF] hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                                    >
                                        Ask
                                    </button>
                                    <button
                                        onClick={() => setAttachedImage(null)}
                                        className="w-8 h-8 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] flex items-center justify-center text-xs text-[#0F172A] cursor-pointer"
                                    >
                                        <i className="bi bi-x-lg text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Centered Video-Style Controls with Enlarged Buttons ── */}
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2 sm:gap-3">
                                <button
                                    onClick={handlePreviousBoard}
                                    disabled={isGeneratingLesson || boardIndex === 0}
                                    title="Previous board"
                                    className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#F1F5F9] hover:bg-[#E3E9F1] border border-[#E3E9F1] text-[#0F172A] disabled:opacity-40 transition-all active:scale-95 cursor-pointer shadow-2xs"
                                >
                                    <i className="bi bi-chevron-left text-lg sm:text-xl"></i>
                                </button>
                                <button
                                    onClick={handleRestartBoard}
                                    disabled={isGeneratingLesson || isTtsLoading}
                                    title="Replay current board"
                                    className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#F1F5F9] hover:bg-[#E3E9F1] border border-[#E3E9F1] text-[#0F172A] transition-all active:scale-95 cursor-pointer shadow-2xs"
                                >
                                    <i className="bi bi-arrow-counterclockwise text-lg sm:text-xl"></i>
                                </button>
                            </div>

                            <div className="flex items-center gap-3 sm:gap-4">
                                <button
                                    onClick={togglePauseAI}
                                    disabled={isTtsLoading || !lessonPlan}
                                    title={isSpeaking ? "Pause speech" : "Resume speech"}
                                    className={`flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border transition-all cursor-pointer shadow-xs active:scale-95 ${
                                        isSpeaking ? 'bg-blue-50 border-blue-200 text-[#0066FF]' : 'bg-[#F1F5F9] border-[#E3E9F1] text-[#64748B]'
                                    }`}
                                >
                                    <i className={`bi ${isSpeaking ? 'bi-pause-fill text-xl sm:text-2xl' : 'bi-play-fill text-2xl sm:text-3xl'}`}></i>
                                </button>

                                {/* Center Mic Button (Enlarged) */}
                                <button
                                    onClick={toggleMic}
                                    disabled={isGeneratingLesson || !lessonPlan}
                                    title={isMicListening ? "Listening... Click to send" : "Tap mic to pause video and ask a question"}
                                    className={`flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl font-bold transition-all cursor-pointer shadow-xl active:scale-95 ${
                                        isMicListening 
                                            ? 'bg-[#0F172A] text-white animate-pulse ring-4 ring-[#0066FF]/40' 
                                            : 'bg-[#0066FF] hover:bg-blue-700 text-white shadow-blue-500/20 ring-2 ring-blue-400/30'
                                    }`}
                                >
                                    <i className={`bi ${isMicListening ? 'bi-mic-fill' : 'bi-mic'} text-2xl sm:text-3xl`}></i>
                                </button>

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    type="button"
                                    title="Snap or upload picture of your work"
                                    className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#F1F5F9] hover:bg-[#E3E9F1] border border-[#E3E9F1] text-[#0F172A] transition-all cursor-pointer shadow-2xs active:scale-95"
                                >
                                    <i className="bi bi-camera text-xl sm:text-2xl"></i>
                                </button>
                            </div>

                            <button
                                onClick={handleAdvanceNextBoard}
                                disabled={isGeneratingLesson || isTtsLoading}
                                title="Next board"
                                className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#F1F5F9] hover:bg-[#E3E9F1] border border-[#E3E9F1] text-[#0F172A] transition-all active:scale-95 cursor-pointer shadow-2xs"
                            >
                                <i className="bi bi-chevron-right text-lg sm:text-xl"></i>
                            </button>

                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleImageUpload}
                                accept="image/*"
                                className="hidden"
                            />
                        </div>
                    </div>
                </main>
            )}

            {/* ── Scanned Problem Image Modal ──────────────────────────── */}
            {showScannedImageModal && sessionData?.image && (
                <div
                    onClick={() => setShowScannedImageModal(false)}
                    className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 cursor-pointer animate-fade-in"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white border border-[#E3E9F1] rounded-3xl p-5 max-w-2xl w-full max-h-[88vh] shadow-2xl flex flex-col gap-3 relative cursor-default text-[#0F172A]"
                    >
                        <div className="flex items-center justify-between border-b border-[#E3E9F1] pb-3">
                            <h3 className="font-bold text-sm text-[#0F172A] flex items-center gap-2">
                                <i className="bi bi-image text-[#0066FF]"></i>
                                <span>Original Scanned Problem</span>
                            </h3>
                            <button
                                onClick={() => setShowScannedImageModal(false)}
                                className="w-8 h-8 rounded-full bg-[#F1F5F9] text-[#0F172A] flex items-center justify-center cursor-pointer hover:bg-[#E2E8F0]"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto flex items-center justify-center bg-black/5 rounded-2xl p-2 max-h-[62vh]">
                            <img src={sessionData.image} alt="Scanned problem" className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-md" />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Limit Exceeded Modal ─────────────────────────────────── */}
            <LimitExceededModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                cost={limitModalData.cost}
                balance={limitModalData.balance}
                onNavigate={onNavigate}
            />
        </div>
    );
};

export default VoiceTutorialPage;
