/**
 * AvelutLiveClassroomView.tsx
 *
 * Live AI classroom interface.
 *
 * Layout:
 *   - Full-screen Excalidraw board canvas
 *   - Translucent top bar: back button, LIVE badge, topic title, teacher state pill
 *   - Floating subtitle pill (scrolling teacher transcript)
 *   - Bottom HUD: text input toggle, tap-to-talk mic button, clear board
 *   - Connection error overlay with retry
 *
 * Architecture:
 *   Student mic → QwenRealtimeTeacherService → Qwen Omni Realtime → audio + board_action → AvelutBoardController → Excalidraw
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Ear,
  Pencil,
  Sparkles,
  MessageSquare,
  Send,
  AlertCircle,
  RotateCcw,
  Lock,
  ChevronUp,
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
  /** True while the student's mic is open (manual push-to-talk turn) */
  const [isTalking, setIsTalking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isHoldingMic, setIsHoldingMic] = useState(false);
  const [isLockedMic, setIsLockedMic] = useState(false);
  const [slideDistance, setSlideDistance] = useState(0);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [activeFormula, setActiveFormula] = useState<string | null>(null);

  const [teachingPlan, setTeachingPlan] = useState<TeachingPlan | null>(null);
  const serviceRef = useRef<QwenRealtimeTeacherService | null>(null);
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
        // Sync UI mic state directly with service state machine truth
        if (svc) {
          const active = svc.getIsPushToTalkActive();
          setIsTalking(active);
          if (!active) {
            setIsHoldingMic(false);
            setIsLockedMic(false);
            setSlideDistance(0);
          }
        }
        // Never leave the mic button stuck "on" if the session drops.
        if (s === 'error' || s === 'closed') {
          setIsTalking(false);
          setIsHoldingMic(false);
          setIsLockedMic(false);
          setSlideDistance(0);
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
  const pointerStartRef = useRef<{ y: number; id: number } | null>(null);

  const handleToggleMute = () => {
    const svc = serviceRef.current;
    if (!svc) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    svc.setIsMuted(nextMuted);
  };

  const handleMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const svc = serviceRef.current;
    if (!svc || teacherState === 'connecting') return;

    ensureAudioUnlocked();

    // If currently locked in hands-free recording mode, tapping sends audio
    if (isLockedMic) {
      svc.endPushToTalk();
      setIsLockedMic(false);
      setIsHoldingMic(false);
      setIsTalking(false);
      setSlideDistance(0);
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    pointerStartRef.current = { y: e.clientY, id: e.pointerId };
    setIsHoldingMic(true);
    setSlideDistance(0);

    if (!svc.getIsPushToTalkActive()) {
      svc.beginPushToTalk();
      setIsTalking(true);
    }
  };

  const handleMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isHoldingMic || isLockedMic || !pointerStartRef.current) return;

    const dy = pointerStartRef.current.y - e.clientY; // upward is positive
    const dist = Math.max(0, dy);
    setSlideDistance(dist);

    // Slide up past threshold (~65px) locks recording hands-free
    if (dist >= 65) {
      setIsLockedMic(true);
      setIsHoldingMic(false);
      setSlideDistance(0);
      try {
        e.currentTarget.releasePointerCapture(pointerStartRef.current.id);
      } catch {}
      pointerStartRef.current = null;
    }
  };

  const handleMicPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerStartRef.current && pointerStartRef.current.id === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      pointerStartRef.current = null;
    }

    if (isLockedMic) {
      // Releasing pointer while locked keeps recording hands-free until explicit tap
      return;
    }

    if (isHoldingMic) {
      setIsHoldingMic(false);
      setSlideDistance(0);
      const svc = serviceRef.current;
      if (svc && svc.getIsPushToTalkActive()) {
        svc.endPushToTalk();
        setIsTalking(false);
      }
    }
  };

  const handleMicPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    handleMicPointerUp(e);
  };

  const handleStopLockedRecording = () => {
    const svc = serviceRef.current;
    if (svc) {
      svc.endPushToTalk();
      setIsLockedMic(false);
      setIsHoldingMic(false);
      setIsTalking(false);
      setSlideDistance(0);
    }
  };

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

      {/* ── HOLD TO TALK / LOCKED FLOATING UI ──────────────────────────────── */}
      {hasStarted && teacherState !== 'connecting' && (isHoldingMic || isLockedMic) && (
        <div className="absolute bottom-28 left-0 right-0 z-30 flex flex-col items-center gap-2 pointer-events-auto animate-in fade-in slide-in-from-bottom-3">
          {isLockedMic ? (
            <button
              onClick={handleStopLockedRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-[0_0_30px_rgba(225,29,72,0.5)] border border-rose-400/50 active:scale-95 transition-all"
            >
              <Lock className="w-4 h-4 animate-bounce" />
              <span>Locked — tap to send</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/15 text-white/90 text-xs font-semibold shadow-xl">
              <div className="flex items-center gap-1 text-[#38BDF8] animate-bounce">
                <ChevronUp className="w-4 h-4" />
                <span>Slide up to lock</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MIC HINT PILL ─────────────────────────────────────────────────── */}
      {hasStarted && teacherState !== 'connecting' && !showTextInput && !isHoldingMic && !isLockedMic && (
        <div className="absolute bottom-24 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
          <span
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border backdrop-blur-md ${
              isMuted
                ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                : isDark
                  ? 'bg-white/5 border-white/10 text-white/50'
                  : 'bg-slate-900/5 border-slate-900/10 text-slate-500'
            }`}
          >
            {isMuted ? 'Local mic muted' : 'Hold mic to speak • Slide up to lock'}
          </span>
        </div>
      )}

      {/* ── BOTTOM HUD ────────────────────────────────────────────────────── */}
      <footer className="absolute bottom-5 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
        <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full ${
          isDark
            ? 'bg-[#18181B]/90 border-white/15 text-white shadow-2xl'
            : 'bg-white/95 border-slate-200/90 text-slate-900 shadow-xl'
        } border backdrop-blur-md pointer-events-auto`}>

          {/* Text input toggle */}
          <button
            onClick={() => setShowTextInput(v => !v)}
            className={`flex items-center justify-center w-11 h-11 rounded-full transition-all active:scale-90 ${
              showTextInput
                ? 'bg-[#38BDF8] text-black'
                : isDark
                  ? 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
            }`}
            aria-label="Type a message"
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          {/* Mute button (separate, beside mic) */}
          <button
            onClick={handleToggleMute}
            className={`flex items-center justify-center w-11 h-11 rounded-full transition-all active:scale-90 ${
              isMuted
                ? 'bg-rose-500/20 border border-rose-500/50 text-rose-400'
                : isDark
                  ? 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
            }`}
            aria-label={isMuted ? 'Unmute mic' : 'Mute mic'}
            title={isMuted ? 'Unmute mic' : 'Mute mic'}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Mic button — Press & hold to speak, slide up to lock
              States:
              - Idle: Default blue mic
              - Holding: White circle + red mic icon in center
              - Locked: White/red recording look + floating lock animation above
          */}
          {(() => {
            const askedQuestion = serviceRef.current?.getLastResponseAskedQuestion() ?? false;
            const isAwaitingAnswer = askedQuestion && !isTalking && !isHoldingMic && !isLockedMic;

            let buttonBg = 'bg-[#38BDF8] hover:bg-[#0284c7] text-white';
            let icon = <Mic className="w-6 h-6" />;
            let ariaLabel = 'Press and hold to speak';

            if (isHoldingMic || isLockedMic) {
              buttonBg = 'bg-white text-rose-600 shadow-[0_0_25px_rgba(255,255,255,0.8)] border-2 border-rose-500';
              icon = <Mic className="w-6 h-6 text-rose-600 animate-pulse" />;
              ariaLabel = isLockedMic ? 'Recording locked — tap to send' : 'Holding mic to speak';
            } else if (isAwaitingAnswer) {
              buttonBg = 'bg-white hover:bg-slate-100 border-2 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] text-rose-600';
              icon = <Mic className="w-6 h-6 text-rose-600 animate-pulse" />;
              ariaLabel = 'Teacher asked a question — press and hold to answer';
            }

            return (
              <div className="relative flex items-center justify-center">
                {(isHoldingMic || isLockedMic || isTalking) && audioLevel > 0.04 && (
                  <span
                    className="absolute inset-0 rounded-full bg-rose-500/40 animate-ping pointer-events-none"
                    style={{ transform: `scale(${1 + audioLevel})` }}
                  />
                )}
                {isAwaitingAnswer && (
                  <span className="absolute -inset-1 rounded-full bg-rose-500/20 animate-ping pointer-events-none" />
                )}
                <button
                  onPointerDown={handleMicPointerDown}
                  onPointerMove={handleMicPointerMove}
                  onPointerUp={handleMicPointerUp}
                  onPointerCancel={handleMicPointerCancel}
                  className={`relative z-10 flex items-center justify-center w-14 h-14 rounded-full
                               shadow-lg transition-all active:scale-95 font-bold ${buttonBg} ${
                    teacherState === 'connecting' ? 'opacity-50 pointer-events-none' : ''
                  } touch-none`}
                  style={{
                    transform: isHoldingMic && slideDistance > 0
                      ? `translateY(-${Math.min(slideDistance, 65)}px)`
                      : undefined,
                  }}
                  aria-label={ariaLabel}
                  title={ariaLabel}
                >
                  {icon}
                </button>
              </div>
            );
          })()}

          {/* Clear board */}
          <button
            onClick={handleClearBoard}
            className={`flex items-center justify-center w-11 h-11 rounded-full ${
              isDark
                ? 'bg-white/10 hover:bg-white/15 text-white/70 hover:text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
            } active:scale-90 transition-all`}
            aria-label="Clear board"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default AvelutLiveClassroomView;
