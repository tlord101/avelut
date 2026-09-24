/**
 * AvelutLiveClassroomView.tsx
 *
 * Live AI classroom interface.
 *
 * Layout:
 *   - Full-screen Excalidraw board canvas
 *   - Translucent top bar: back button, LIVE badge, topic title, teacher state pill
 *   - Floating subtitle pill (scrolling teacher transcript)
 *   - Bottom HUD: text input toggle, large mic button, clear board
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
  Ear,
  Pencil,
  Sparkles,
  MessageSquare,
  Send,
  AlertCircle,
  RotateCcw,
  Maximize2,
  Minimize2,
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
  commitLiveTutorialStart,
  type LiveDurationMinutes,
} from '../../../utils/liveTutorialQuota';
import { deductAICredits } from '../../../utils/usage';
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
  const [isMuted, setIsMuted] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [activeFormula, setActiveFormula] = useState<string | null>(null);

  const [teachingPlan, setTeachingPlan] = useState<TeachingPlan | null>(null);
  const serviceRef = useRef<QwenRealtimeTeacherService | null>(null);
  const startedSessionRef = useRef(false);
  const startCommittedRef = useRef(false);

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

  useEffect(() => {
    avelutBoardController.setOnFormulaChange((formula) => {
      setActiveFormula(formula);
    });

    if (!startedSessionRef.current) {
      startedSessionRef.current = true;
      startSession();
    }
    return () => {
      avelutBoardController.setOnFormulaChange(null);
      if (serviceRef.current) {
        serviceRef.current.endSession();
        serviceRef.current = null;
      }
    };
  }, [startSession]);

  // Ensure AudioContext is unlocked on any user gesture
  const ensureAudioUnlocked = useCallback(() => {
    if (serviceRef.current && !serviceRef.current.isAudioUnlocked()) {
      serviceRef.current.resumeAudio().catch(() => {});
    }
  }, []);

  const handleStartLesson = async () => {
    if (!serviceRef.current) return;

    // ── Commit Lesson Cost (Pool minute or Credit debit) ───────────────────
    if (!startCommittedRef.current && userProfile?.uid) {
      startCommittedRef.current = true;
      const durMode = (durationMinutes as LiveDurationMinutes) || 30;
      const decision = evaluateLiveTutorialStart(userProfile, durMode, appSettings);

      if (decision.allowed) {
        if (decision.payment === 'included') {
          commitLiveTutorialStart(userProfile, decision, appSettings).catch((err) => {
            console.warn('[AvelutLiveClassroomView] commitLiveTutorialStart error:', err);
          });
        } else if (decision.payment === 'credits' && decision.creditCost > 0) {
          deductAICredits(userProfile.uid, decision.creditCost, `live_tutorial_${durMode}`, appSettings)
            .then((res) => {
              if (res.success && typeof res.balance === 'number') {
                notifyUserCreditsUpdated(userProfile.uid, res.balance);
              }
            })
            .catch((err) => {
              console.warn('[AvelutLiveClassroomView] deductAICredits error:', err);
            });
        }
      }
    }

    const unlocked = await serviceRef.current.resumeAudio();
    await new Promise((r) => setTimeout(r, 80));

    if (!unlocked) {
      console.warn('[AvelutLiveClassroomView] Audio still not unlocked after resume');
    }

    serviceRef.current.triggerInitialGreeting();
    setHasStarted(true);
  };

  const handleBoardReady = useCallback(() => {
    console.log('[AvelutLiveClassroomView] Excalidraw board ready');
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleToggleMute = () => {
    if (!serviceRef.current) return;
    const muted = serviceRef.current.toggleMute();
    setIsMuted(muted);
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
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <button
            onClick={onClose}
            className={`flex items-center justify-center w-9 h-9 rounded-full ${
              isDark
                ? 'bg-white/10 hover:bg-white/20 border-white/10 text-white'
                : 'bg-black/5 hover:bg-black/10 border-black/10 text-slate-800'
            } active:scale-90 transition-all backdrop-blur-md border`}
            aria-label="Leave Classroom"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-red-500">LIVE</span>
              <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-slate-500'} truncate max-w-[140px] sm:max-w-[240px]`}>
                • {courseName} • {durationMinutes}m
              </span>
            </div>
            <h1 className={`text-sm font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'} truncate max-w-[180px] sm:max-w-sm leading-tight`}>
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

      {/* ── BOTTOM HUD ────────────────────────────────────────────────────── */}
      <footer className="absolute bottom-5 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
        <div className={`flex items-center gap-3 px-4 py-2 rounded-full ${
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

          {/* Mic button with audio level pulse ring */}
          <div className="relative flex items-center justify-center">
            {!isMuted && audioLevel > 0.04 && (
              <span
                className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping pointer-events-none"
                style={{ transform: `scale(${1 + audioLevel})` }}
              />
            )}
            <button
              onClick={handleToggleMute}
              className={`relative z-10 flex items-center justify-center w-14 h-14 rounded-full
                           shadow-lg transition-all active:scale-90 font-bold ${
                isMuted
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black'
              }`}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
          </div>

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
