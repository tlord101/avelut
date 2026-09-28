/**
 * AvelutLiveClassroomView.tsx
 *
 * Live AI classroom interface.
 *
 * Layout:
 *   - Full-screen Excalidraw board canvas
 *   - Translucent top bar: back button, LIVE badge, topic title, teacher state pill
 *   - Floating subtitle pill (scrolling teacher transcript)
 *   - Bottom HUD: text input toggle, one-click mic (wave UI while listening), clear board
 *   - Connection error overlay with retry
 *
 * Architecture:
 *   Student mic → QwenRealtimeTeacherService → Qwen Omni Realtime → audio + board_action → AvelutBoardController → Excalidraw
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Mic,
  Volume2,
  Ear,
  Pencil,
  Sparkles,
  MessageSquare,
  Send,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { ExcalidrawLiveBoard } from './ExcalidrawLiveBoard';
import {
  QwenRealtimeTeacherService,
  type TeacherState,
} from '../../../services/live-classroom/QwenRealtimeTeacherService';
import { avelutBoardController } from '../../../services/live-classroom/AvelutBoardController';
import { useTheme } from '../../../contexts/ThemeContext';
import type { UserProfile } from '../../../types';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  evaluateLiveTutorialStart,
  commitActualLiveTutorialMinutes,
  type LiveDurationMinutes,
} from '../../../utils/liveTutorialQuota';
import { deductAICredits, recordUsage } from '../../../utils/usage';
import { logTeachingEvent } from '../../../services/teachingEventLogger';
import { notifyUserCreditsUpdated } from '../../../lib/supabaseRealtimeDb';
import {
  getOrGenerateTeachingPlan,
  type TeachingPlan,
} from '../../../services/live-classroom/teachingPlanService';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AvelutLiveClassroomViewProps {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  durationMinutes?: number;
  learningPath?: string[];
  userProfile?: UserProfile | null;
  appSettings?: any;
  onClose?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}


// ─── Exact voice-recorder waveform (always-on bottom HUD) ─────────────────
// Port of voice_recorder_blue_theme: BASE_PROFILE bars, DOM refs + RAF lerp.
// - Idle / teacher speaking: waves react (teacher uses synthetic energy)
// - Student recording: mic turns RED, waves driven by real mic audioLevel
// - Tap mic to speak; silence after speech auto-submits (or max duration)

const WAVE_BASE_PROFILE = [48, 36, 44, 30, 38, 24, 30, 18, 22, 14, 16, 10, 12, 8];
const WAVE_NUM_BARS = WAVE_BASE_PROFILE.length;

const LiveVoiceWaveform: React.FC<{
  /** 0–1 mic level while student is recording */
  audioLevel: number;
  /** True while student push-to-talk is active */
  isRecording: boolean;
  /** True while the teacher is currently speaking audio */
  isTeacherSpeaking: boolean;
  onMicClick: () => void;
  disabled?: boolean;
}> = ({ audioLevel, isRecording, isTeacherSpeaking, onMicClick, disabled }) => {
  const leftBarsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rightBarsRef = useRef<(HTMLDivElement | null)[]>([]);
  const currentHeights = useRef<number[]>([...WAVE_BASE_PROFILE]);
  const rafIdRef = useRef<number | null>(null);
  const audioLevelRef = useRef(audioLevel);
  const isRecordingRef = useRef(isRecording);
  const isTeacherSpeakingRef = useRef(isTeacherSpeaking);
  audioLevelRef.current = audioLevel;
  isRecordingRef.current = isRecording;
  isTeacherSpeakingRef.current = isTeacherSpeaking;

  const updateDOM = useCallback((heights: number[]) => {
    for (let i = 0; i < WAVE_NUM_BARS; i++) {
      const rightBar = rightBarsRef.current[i];
      if (rightBar) rightBar.style.height = `${heights[i]}px`;
      const leftBar = leftBarsRef.current[WAVE_NUM_BARS - 1 - i];
      if (leftBar) leftBar.style.height = `${heights[i]}px`;
    }
  }, []);

  useEffect(() => {
    const animate = () => {
      let visual = 0;
      if (isRecordingRef.current) {
        // Student mic — punch up quiet RMS so bars feel alive
        visual = Math.min(1, Math.max(0, audioLevelRef.current) * 2.8);
      } else if (isTeacherSpeakingRef.current) {
        // Teacher talking — smooth synthetic energy (no student mic level)
        const t = performance.now() * 0.006;
        visual = 0.35 + 0.25 * Math.sin(t) + 0.15 * Math.sin(t * 2.3 + 1.1);
        visual = Math.min(1, Math.max(0.2, visual));
      } else {
        // Idle — gentle breathing on base profile
        const t = performance.now() * 0.003;
        visual = 0.06 + 0.04 * Math.sin(t);
      }

      for (let i = 0; i < WAVE_NUM_BARS; i++) {
        const centerWeight = 1 - (i / WAVE_NUM_BARS) * 0.4;
        const phase = Math.sin(performance.now() * 0.01 + i) * 0.1 + 0.9;
        const binSim =
          visual * (0.55 + 0.45 * Math.sin(performance.now() * 0.008 + i * 1.3));

        const targetHeight =
          WAVE_BASE_PROFILE[i] +
          visual * WAVE_BASE_PROFILE[i] * 1.5 * centerWeight * phase +
          binSim * WAVE_BASE_PROFILE[i] * 2.2 * centerWeight;

        const clampedTarget = Math.min(
          120,
          Math.max(WAVE_BASE_PROFILE[i], targetHeight),
        );
        const lerpFactor = visual > 0.05 ? 0.4 : 0.12;
        currentHeights.current[i] +=
          (clampedTarget - currentHeights.current[i]) * lerpFactor;
      }

      updateDOM(currentHeights.current);
      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      currentHeights.current = [...WAVE_BASE_PROFILE];
      updateDOM(currentHeights.current);
    };
  }, [updateDOM]);

  const barColor = isRecording ? 'bg-rose-500' : 'bg-blue-500';
  const btnColor = isRecording
    ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/40'
    : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/30';
  const label = isRecording
    ? 'Listening… (auto-sends when you pause)'
    : isTeacherSpeaking
      ? 'Teacher speaking…'
      : 'Tap mic to speak';

  return (
    <div className="flex flex-col items-center w-full max-w-2xl pointer-events-auto select-none">
      <div className="flex items-center justify-center gap-3 sm:gap-6 w-full px-2">
        {/* Left Waveform — edge → center */}
        <div className="flex items-center justify-end gap-1 sm:gap-1.5 h-24 flex-1">
          {WAVE_BASE_PROFILE.slice().reverse().map((baseHeight, idx) => {
            const distanceFromCenter = WAVE_NUM_BARS - 1 - idx;
            const opacity = 1 - (distanceFromCenter / WAVE_NUM_BARS) * 0.7;
            return (
              <div
                key={`left-${idx}`}
                ref={(el) => {
                  leftBarsRef.current[idx] = el;
                }}
                className={`w-1 sm:w-[5px] rounded-full transition-colors duration-300 ${barColor}`}
                style={{ height: `${baseHeight}px`, opacity }}
              />
            );
          })}
        </div>

        {/* Center: ripple rings + mic button */}
        <div className="relative flex items-center justify-center shrink-0 w-20 h-20 sm:w-24 sm:h-24">
          <div
            className={`absolute w-32 h-32 sm:w-40 sm:h-40 rounded-full pointer-events-none scale-110 transition-colors duration-500 ${
              isRecording ? 'bg-rose-500/[0.08]' : 'bg-blue-600/[0.08]'
            }`}
          />
          <div
            className={`absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full pointer-events-none scale-110 animate-pulse transition-colors duration-500 ${
              isRecording ? 'bg-rose-500/[0.12]' : 'bg-blue-600/[0.12]'
            }`}
          />
          <button
            onClick={onMicClick}
            disabled={disabled}
            className={`relative z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center
                       shadow-xl transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none
                       ${btnColor}`}
            aria-label={isRecording ? 'Stop and send' : 'Tap to speak'}
          >
            <Mic className="text-white w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2} />
          </button>
        </div>

        {/* Right Waveform — center → edge */}
        <div className="flex items-center justify-start gap-1 sm:gap-1.5 h-24 flex-1">
          {WAVE_BASE_PROFILE.map((baseHeight, idx) => {
            const opacity = 1 - (idx / WAVE_NUM_BARS) * 0.7;
            return (
              <div
                key={`right-${idx}`}
                ref={(el) => {
                  rightBarsRef.current[idx] = el;
                }}
                className={`w-1 sm:w-[5px] rounded-full transition-colors duration-300 ${barColor}`}
                style={{ height: `${baseHeight}px`, opacity }}
              />
            );
          })}
        </div>
      </div>

      <p
        className={`mt-3 text-sm sm:text-base font-medium tracking-wide transition-colors duration-300 ${
          isRecording ? 'text-rose-400' : 'text-blue-400'
        }`}
      >
        {label}
      </p>
    </div>
  );
};

// ─── Teacher State Pill ───────────────────────────────────────────────────────

const TeacherStatePill: React.FC<{ state: TeacherState }> = ({ state }) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181B]/80 border border-white/10 backdrop-blur-md shadow-lg">
      {state === 'speaking' && (
        <>
          <Volume2 className="w-4 h-4 text-[#38BDF8] animate-pulse" />
          <span className="text-xs font-semibold text-[#38BDF8]">Speaking</span>
          <span className="flex gap-0.5 ml-1">
            {['-0.3s', '-0.15s', '0s'].map((d) => (
              <span key={d} className="w-0.5 h-3.5 bg-[#38BDF8] rounded-full animate-bounce" style={{ animationDelay: d }} />
            ))}
          </span>
        </>
      )}
      {state === 'listening' && (
        <>
          <Ear className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400">Listening…</span>
        </>
      )}
      {state === 'drawing' && (
        <>
          <Pencil className="w-4 h-4 text-amber-400 animate-bounce" />
          <span className="text-xs font-semibold text-amber-400">Drawing…</span>
        </>
      )}
      {state === 'connecting' && (
        <>
          <Sparkles className="w-4 h-4 text-white/50 animate-spin" />
          <span className="text-xs text-white/50">Connecting…</span>
        </>
      )}
      {state === 'connected' && (
        <>
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-emerald-400">Ready</span>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span className="text-xs font-semibold text-rose-400">Error</span>
        </>
      )}
      {state === 'closed' && (
        <>
          <span className="w-2 h-2 rounded-full bg-white/30" />
          <span className="text-xs text-white/40">Closed</span>
        </>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const AvelutLiveClassroomView: React.FC<AvelutLiveClassroomViewProps> = ({
  topicTitle,
  courseName = 'Academic Course',
  syllabusContext,
  durationMinutes = 30,
  learningPath,
  userProfile,
  appSettings,
  onClose,
  setCustomHeaderConfig,
}) => {
  const [teacherState, setTeacherState] = useState<TeacherState>('connecting');
  const [transcript, setTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  /** True while the student's mic is open (tap-to-talk active) */
  const [isTalking, setIsTalking] = useState(false);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [activeFormula, setActiveFormula] = useState<string | null>(null);

  const [teachingPlan, setTeachingPlan] = useState<TeachingPlan | null>(null);
  const serviceRef = useRef<QwenRealtimeTeacherService | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSpokenRef = useRef(false);
  const MAX_RECORDING_MS = 30_000; // hard cap auto-submit
  const SILENCE_SUBMIT_MS = 1_400; // auto-submit after this much quiet once user has spoken
  const startedSessionRef = useRef(false);
  const lessonStartTimeRef = useRef<number | null>(null);
  const hasFinalizedUsageRef = useRef(false);
  const paymentModeRef = useRef<'included' | 'credits'>('included');

  // ── Pre-generate teaching plan on mount ──────────────────────────────────
  useEffect(() => {
    let isCancelled = false;
    const dur = (durationMinutes as 15 | 30 | 60) || 30;
    getOrGenerateTeachingPlan({
      topicTitle,
      courseName,
      syllabusContext,
      durationMinutes: dur,
      userProfile,
      appSettings,
    })
      .then((plan) => {
        if (!isCancelled && plan) {
          setTeachingPlan(plan);
        }
      })
      .catch((err) => {
        console.warn('[AvelutLiveClassroomView] Teaching plan generation error:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [topicTitle, courseName, syllabusContext, durationMinutes, userProfile, appSettings]);

  // ── Hide global header/nav while in live classroom ──────────────────────
  useEffect(() => {
    setCustomHeaderConfig?.({ hideHeader: true, hideBottomNav: true });
    return () => { setCustomHeaderConfig?.(null); };
  }, [setCustomHeaderConfig]);

  // ── Store current parameters in refs to avoid re-triggering startSession ──
  const paramsRef = useRef({
    topicTitle,
    courseName,
    syllabusContext,
    durationMinutes,
    learningPath,
    teachingPlan,
    studentName: userProfile?.display_name || undefined,
    appSettings,
    userProfile,
  });

  useEffect(() => {
    paramsRef.current = {
      topicTitle,
      courseName,
      syllabusContext,
      durationMinutes,
      learningPath,
      teachingPlan,
      studentName: userProfile?.display_name || undefined,
      appSettings,
      userProfile,
    };
  }, [topicTitle, courseName, syllabusContext, durationMinutes, learningPath, teachingPlan, userProfile, appSettings]);

  // ── Start realtime session once on mount ───────────────────────────────────
  const startSession = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.endSession();
      serviceRef.current = null;
    }

    const svc = new QwenRealtimeTeacherService();
    serviceRef.current = svc;

    const {
      topicTitle: tTitle,
      courseName: cName,
      syllabusContext: sCtx,
      studentName: sName,
      durationMinutes: dMinutes,
      learningPath: lPath,
      teachingPlan: tPlan,
      appSettings: aSettings,
      userProfile: uProfile,
    } = paramsRef.current;

    svc.setCallbacks({
      onStateChange: (s) => {
        setTeacherState(s);
        if (s === 'connected') setErrorMsg(null);

        // Auto-open mic when the teacher asks the student a question
        if (
          s === 'listening' &&
          svc &&
          svc.getLastResponseAskedQuestion() &&
          !svc.getIsPushToTalkActive()
        ) {
          const started = svc.beginPushToTalk();
          if (started) {
            setIsTalking(true);
            hasSpokenRef.current = false;
            if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
            recordingTimerRef.current = setTimeout(() => {
              if (serviceRef.current?.getIsPushToTalkActive()) {
                serviceRef.current.endPushToTalk();
              }
              setIsTalking(false);
              hasSpokenRef.current = false;
              recordingTimerRef.current = null;
            }, MAX_RECORDING_MS);
          }
        }

        // Sync UI mic state with service truth
        if (svc) {
          const active = svc.getIsPushToTalkActive();
          setIsTalking(active);
          if (!active) {
            if (recordingTimerRef.current) {
              clearTimeout(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
            hasSpokenRef.current = false;
          }
        }
        // Never leave the mic button stuck "on" if the session drops
        if (s === 'error' || s === 'closed') {
          setIsTalking(false);
          hasSpokenRef.current = false;
          if (recordingTimerRef.current) {
            clearTimeout(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
      },
      onTranscript: (text, _isFinal) => {
        setTranscript(text);
      },
      onAudioLevel: (level) => setAudioLevel(level),
      onError: (err) => setErrorMsg(err.message || 'Live Teacher connection error'),
    });

    void svc.startSession(
      {
        topicTitle: tTitle,
        courseName: cName,
        syllabusContext: sCtx,
        studentName: sName,
        durationMinutes: dMinutes,
        learningPath: lPath,
        teachingPlan: tPlan,
      },
      aSettings,
      uProfile,
    );
  }, []);

  const finalizeLessonUsage = useCallback(() => {
    if (!lessonStartTimeRef.current || hasFinalizedUsageRef.current || !userProfile?.uid) return;
    hasFinalizedUsageRef.current = true;

    const elapsedMs = Date.now() - lessonStartTimeRef.current;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    // Grace period: if user left within 20s (accidental tap), do not deduct anything
    if (elapsedSeconds < 20) {
      console.log('[AvelutLiveClassroomView] Exited within 20s grace period — 0 minutes deducted');
      logTeachingEvent({
        type: 'session_error',
        topic: topicTitle || 'unknown',
        courseName,
        duration: durationMinutes,
        reason: 'grace_period_exit',
        metadata: { elapsedSeconds },
        userId: userProfile.uid,
      });
      return;
    }

    const durMode = (durationMinutes as LiveDurationMinutes) || 15;
    // Billed strictly by actual minutes spent (rounded up to nearest whole minute, capped at session duration)
    const actualMinutes = Math.min(Math.ceil(elapsedSeconds / 60), durMode);
    const paymentMode = paymentModeRef.current;

    console.log(`[AvelutLiveClassroomView] Finalizing usage: ${actualMinutes} min(s) (${elapsedSeconds}s elapsed, mode=${paymentMode})`);

    const sessionMeta = {
      session_kind: 'live_classroom',
      payment_mode: paymentMode,
      planned_duration_minutes: durMode,
      actual_minutes: actualMinutes,
      elapsed_seconds: elapsedSeconds,
      topic: topicTitle,
      course: courseName,
      // Realtime voice APIs often omit token meters; duration is the primary unit.
      // When the teacher service exposes usage later, fold prompt/completion into recordUsage.
    };

    logTeachingEvent({
      type: 'credit_deduct',
      topic: topicTitle || 'unknown',
      courseName,
      duration: actualMinutes,
      metadata: sessionMeta,
      userId: userProfile.uid,
    });

    if (paymentMode === 'included') {
      commitActualLiveTutorialMinutes(userProfile, actualMinutes, appSettings)
        .then((res) => {
          if (res.success) {
            console.log('[AvelutLiveClassroomView] Deducted actual minutes from pool:', actualMinutes, 'remaining pool:', res.remainingMinutes);
          }
        })
        .catch((err) => {
          console.warn('[AvelutLiveClassroomView] commitActualLiveTutorialMinutes error:', err);
        });
      void recordUsage({
        userId: userProfile.uid,
        feature: 'live_tutorial',
        creditsSpent: 0,
        metadata: { ...sessionMeta, remaining_pool_minutes: undefined },
      });
    } else if (paymentMode === 'credits') {
      // 10 credits per actual minute spent
      const creditCost = actualMinutes * 10;
      deductAICredits(userProfile.uid, creditCost, `live_tutorial_${actualMinutes}m`, appSettings)
        .then((res) => {
          if (res.success && typeof res.balance === 'number') {
            notifyUserCreditsUpdated(userProfile.uid, res.balance);
            console.log('[AvelutLiveClassroomView] Deducted credits for actual minutes:', creditCost, 'newBalance:', res.balance);
          }
        })
        .catch((err) => {
          console.warn('[AvelutLiveClassroomView] deductAICredits error:', err);
        });
      // deductAICredits already writes a basic usage_records row; add a richer session row.
      void recordUsage({
        userId: userProfile.uid,
        feature: 'live_tutorial_session',
        creditsSpent: creditCost,
        metadata: sessionMeta,
      });
    }
  }, [userProfile, durationMinutes, appSettings, topicTitle, courseName]);

  // Always call the latest finalizeLessonUsage from unmount-only cleanups,
  // so its closure never goes stale while keeping it out of effect deps.
  const finalizeLessonUsageRef = useRef(finalizeLessonUsage);
  finalizeLessonUsageRef.current = finalizeLessonUsage;

  // ── Mount-only: board subscription, session start, beforeunload ────────────
  // Deliberately NOT dependent on finalizeLessonUsage: identity changes of
  // userProfile/appSettings must never tear down a live lesson mid-session.
  useEffect(() => {
    avelutBoardController.setOnFormulaChange((formula) => {
      setActiveFormula(formula);
    });

    if (!startedSessionRef.current) {
      startedSessionRef.current = true;
      startSession();
    }

    const handleBeforeUnload = () => {
      finalizeLessonUsageRef.current();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [startSession]);

  // ── Unmount-only: finalize usage + close the socket ────────────────────────
  // Runs ONLY when the component truly unmounts (user exit / parent removal),
  // never because a callback identity changed mid-lesson.
  useEffect(() => {
    return () => {
      finalizeLessonUsageRef.current();
      avelutBoardController.setOnFormulaChange(null);
      if (serviceRef.current) {
        serviceRef.current.endSession();
        serviceRef.current = null;
      }
    };
  }, []);

  // Ensure AudioContext is unlocked on any user gesture
  const ensureAudioUnlocked = useCallback(() => {
    if (serviceRef.current && !serviceRef.current.isAudioUnlocked()) {
      serviceRef.current.resumeAudio().catch(() => {});
    }
  }, []);

  const handleStartLesson = async () => {
    if (!serviceRef.current) return;

    // Record session start timestamp for per-minute deduction
    if (!lessonStartTimeRef.current && userProfile?.uid) {
      lessonStartTimeRef.current = Date.now();
      const durMode = (durationMinutes as LiveDurationMinutes) || 15;
      const decision = evaluateLiveTutorialStart(userProfile, durMode, appSettings);
      paymentModeRef.current = decision.payment === 'included' ? 'included' : 'credits';
      logTeachingEvent({
        type: 'session_start',
        topic: topicTitle || 'unknown',
        courseName,
        duration: durMode,
        metadata: { payment: paymentModeRef.current },
        userId: userProfile.uid,
      });
    }

    const unlocked = await serviceRef.current.resumeAudio();
    await new Promise((r) => setTimeout(r, 80));

    if (!unlocked) {
      console.warn('[AvelutLiveClassroomView] Audio still not unlocked after resume');
    }

    serviceRef.current.triggerInitialGreeting();
    setHasStarted(true);
  };

  const handleClose = () => {
    finalizeLessonUsage();
    onClose();
  };

  const handleBoardReady = useCallback(() => {
    console.log('[AvelutLiveClassroomView] Excalidraw board ready');
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  const clearRecordingTimers = useCallback(() => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopRecordingAndSubmit = useCallback(() => {
    const svc = serviceRef.current;
    clearRecordingTimers();
    hasSpokenRef.current = false;
    if (svc?.getIsPushToTalkActive()) {
      svc.endPushToTalk();
    }
    setIsTalking(false);
  }, [clearRecordingTimers]);

  const startRecording = useCallback(() => {
    const svc = serviceRef.current;
    if (!svc || svc.getIsPushToTalkActive()) return;
    ensureAudioUnlocked();
    const started = svc.beginPushToTalk();
    if (!started) return;
    setIsTalking(true);
    hasSpokenRef.current = false;
    clearRecordingTimers();
    // Hard max so recording never runs forever
    recordingTimerRef.current = setTimeout(() => {
      stopRecordingAndSubmit();
    }, MAX_RECORDING_MS);
  }, [ensureAudioUnlocked, clearRecordingTimers, stopRecordingAndSubmit]);

  const handleMicClick = useCallback(() => {
    const svc = serviceRef.current;
    if (!svc || teacherState === 'connecting') return;
    ensureAudioUnlocked();
    if (isTalking) {
      // Manual stop → submit now
      stopRecordingAndSubmit();
    } else {
      startRecording();
    }
  }, [isTalking, teacherState, ensureAudioUnlocked, startRecording, stopRecordingAndSubmit]);

  // While recording: after user has spoken, auto-submit on sustained silence
  useEffect(() => {
    if (!isTalking) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }
    const SPEECH_THRESHOLD = 0.04;
    if (audioLevel > SPEECH_THRESHOLD) {
      hasSpokenRef.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }
    // Quiet — only arm silence timer once the user has actually spoken
    if (!hasSpokenRef.current) return;
    if (silenceTimerRef.current) return;
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      stopRecordingAndSubmit();
    }, SILENCE_SUBMIT_MS);
  }, [isTalking, audioLevel, stopRecordingAndSubmit]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearRecordingTimers();
    };
  }, [clearRecordingTimers]);

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !serviceRef.current) return;
    serviceRef.current.sendTextMessage(textInput.trim());
    setTextInput('');
    setShowTextInput(false);
  };

  const handleRetry = () => {
    setErrorMsg(null);
    setHasStarted(false);
    serviceRef.current?.endSession();
    startSession();
  };

  const handleClearBoard = () => {
    avelutBoardController.clearBoard(true);
  };


  // ── Render ───────────────────────────────────────────────────────────────
  let isDark = true;
  try {
    const themeContext = useTheme();
    if (themeContext?.mode) isDark = themeContext.mode === 'dark';
  } catch {
    if (typeof document !== 'undefined') {
      isDark = document.documentElement.classList.contains('dark');
    }
  }

  return (
    <div
      onClick={ensureAudioUnlocked}
      onTouchStart={ensureAudioUnlocked}
      className={`fixed inset-0 z-50 flex flex-col w-full h-full ${
        isDark ? 'bg-[#0A0A0A] text-[#FAFAFA]' : 'bg-[#F8FAFC] text-[#0F172A]'
      } overflow-hidden select-none`}
    >

      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <header className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2.5 ${
        isDark
          ? 'bg-gradient-to-b from-[#0A0A0A]/95 via-[#0A0A0A]/60 to-transparent'
          : 'bg-gradient-to-b from-[#F8FAFC]/95 via-[#F8FAFC]/60 to-transparent'
      } pointer-events-none`}>
        {/* Left: back + title */}
        <div className="flex items-center gap-2.5 pointer-events-auto flex-1 min-w-0 mr-2">
          <button
            onClick={handleClose}
            className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
              isDark
                ? 'bg-white/10 hover:bg-white/20 border-white/10 text-white'
                : 'bg-black/5 hover:bg-black/10 border-black/10 text-slate-800'
            } active:scale-90 transition-all backdrop-blur-md border`}
            aria-label="Leave Classroom"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-red-500 shrink-0">LIVE</span>
              <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-slate-500'} truncate max-w-[160px] sm:max-w-[260px]`}>
                • {courseName} • {durationMinutes}m
              </span>
            </div>
            <h1
              className={`text-xs sm:text-sm font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'} truncate sm:line-clamp-2 leading-tight`}
              title={topicTitle}
            >
              {topicTitle}
            </h1>
          </div>
        </div>

        {/* Right: teacher state pill */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <TeacherStatePill state={teacherState} />
        </div>
      </header>

      {/* ── TAP TO START OVERLAY ──────────────────────────────────────────── */}
      {!hasStarted && teacherState === 'connected' && !errorMsg && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in">
            <button
              onClick={handleStartLesson}
              className="flex items-center gap-3 px-8 py-4 rounded-full bg-[#38BDF8] hover:bg-[#0284c7]
                         active:scale-95 transition-all shadow-[0_0_40px_rgba(56,189,248,0.3)] text-black font-bold text-lg"
            >
              <Ear className="w-6 h-6" />
              Tap to Start Lesson
            </button>
            <p className="text-sm font-medium text-white/60">Teacher is ready</p>
          </div>
        </div>
      )}

      {/* ── ERROR OVERLAY REMOVED ─────────────────────────────────────────── */}

      {/* ── EXCALIDRAW BOARD (full-screen) ────────────────────────────────── */}
      <main className="absolute inset-0 w-full h-full">
        <ExcalidrawLiveBoard topicTitle={topicTitle} onBoardReady={handleBoardReady} className="w-full h-full" />
      </main>

      {/* ── ACTIVE KATEX FORMULA BADGE ──────────────────────────────────── */}
      {activeFormula && (
        <aside
          aria-label="Active Formula"
          className={`absolute top-14 left-3 sm:left-6 z-30 flex items-center gap-2.5 px-4 py-2 rounded-2xl ${
            isDark
              ? 'bg-[#121024]/95 border-[#FDE047]/40 shadow-2xl text-[#FDE047]'
              : 'bg-amber-50/95 border-amber-400/60 shadow-lg text-amber-950'
          } border backdrop-blur-xl animate-in fade-in slide-in-from-top-2 pointer-events-auto max-w-[90vw] sm:max-w-md overflow-hidden`}
        >
          <div className={`flex items-center justify-center w-6 h-6 rounded-lg ${
            isDark ? 'bg-[#FDE047]/20 text-[#FDE047]' : 'bg-amber-200/60 text-amber-900'
          } font-serif font-bold text-xs select-none shrink-0`}>
            ∑
          </div>
          <div
            className={`${isDark ? 'text-[#FDE047]' : 'text-amber-950'} font-semibold text-sm sm:text-base select-text overflow-x-auto py-0.5`}
            dangerouslySetInnerHTML={{
              __html: (() => {
                try {
                  let cleaned = activeFormula.replace(/^\$\$|\$\$$/g, '').trim();
                  // Format title prefix if present e.g. "Wave Speed: v = f \lambda" -> "\text{Wave Speed: } v = f \lambda"
                  const colonIdx = cleaned.indexOf(':');
                  if (colonIdx > 0 && !cleaned.slice(0, colonIdx).includes('\\')) {
                    const labelPart = cleaned.slice(0, colonIdx).trim();
                    const mathPart = cleaned.slice(colonIdx + 1).trim();
                    cleaned = `\\text{${labelPart}: } ${mathPart}`;
                  }
                  return katex.renderToString(cleaned, { displayMode: false, throwOnError: false });
                } catch {
                  return activeFormula;
                }
              })(),
            }}
          />
          <button
            onClick={() => setActiveFormula(null)}
            className={`p-1 rounded-lg ${
              isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-amber-700/60 hover:text-amber-900 hover:bg-amber-200/50'
            } transition-colors ml-1 shrink-0`}
            title="Dismiss formula"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </aside>
      )}

      {/* ── ACTIVE SVG DIAGRAM OVERLAY REMOVED (All diagrams render directly inside the board canvas) ── */}

      {/* ── SUBTITLE PILL (Hidden as requested) ─────────────────────────── */}

      {/* ── TEXT INPUT OVERLAY ────────────────────────────────────────────── */}
      {showTextInput && (
        <div className="absolute bottom-28 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md z-30
                         animate-in fade-in zoom-in-95">
          <form
            onSubmit={handleSendText}
            className="flex items-center gap-2 p-2 rounded-2xl bg-[#18181B] border border-white/15 shadow-2xl"
          >
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="Ask the teacher anything…"
              className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#38BDF8] text-black
                         font-bold disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* ── BOTTOM HUD — always-on blue wave + mic ───────────────────────── */}
      {hasStarted && teacherState !== 'connecting' && (
        <footer className="absolute bottom-4 left-0 right-0 z-20 flex justify-center px-3 pointer-events-none">
          <LiveVoiceWaveform
            audioLevel={audioLevel}
            isRecording={isTalking}
            isTeacherSpeaking={teacherState === 'speaking'}
            onMicClick={handleMicClick}
            disabled={teacherState === 'connecting'}
          />
        </footer>
      )}

    </div>
  );
};

export default AvelutLiveClassroomView;
