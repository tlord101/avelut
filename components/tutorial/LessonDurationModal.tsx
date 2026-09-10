import React, { useMemo, useState } from 'react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';
import { useLessonPrep } from '../../hooks/useLessonPrep';
import { requestNotificationPermission } from '../../services/lessonPrepService';

export type LessonDurationMode = 15 | 30 | 60;

export interface LessonDurationOption {
  minutes: LessonDurationMode;
  title: string;
  subtitle: string;
  boardsCount: number;
  description: string;
  icon: string;
}

export const LESSON_DURATION_OPTIONS: LessonDurationOption[] = [
  {
    minutes: 15,
    title: 'Quick',
    subtitle: '~15 minutes',
    boardsCount: 8,
    description: 'Fast overview — core idea, key visuals, short understanding check.',
    icon: 'bi-lightning-charge',
  },
  {
    minutes: 30,
    title: 'Standard',
    subtitle: '~30 minutes',
    boardsCount: 15,
    description: 'Full concept walkthrough with step-by-step illustrations and checks.',
    icon: 'bi-book',
  },
  {
    minutes: 60,
    title: 'Full lecture',
    subtitle: '~60 minutes',
    boardsCount: 30,
    description:
      'Real lecturer style — chapters, deep dives, pauses, resume anytime.',
    icon: 'bi-mortarboard',
  },
];

export interface LessonDurationModalProps {
  isOpen: boolean;
  topicTitle?: string;
  courseName?: string;
  syllabusContext?: string;
  onClose: () => void;
  onConfirm?: (mode: LessonDurationMode) => void;
  onPrepare?: (mode: LessonDurationMode) => void;
  onOpen?: (mode: LessonDurationMode) => void;
  initialMode?: LessonDurationMode;
  resumeAvailable?: boolean;
  resumeLabel?: string;
  onResume?: () => void;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
}

export const LessonDurationModal: React.FC<LessonDurationModalProps> = ({
  isOpen,
  topicTitle = 'Live Tutorial',
  courseName,
  syllabusContext,
  onClose,
  onConfirm,
  onPrepare,
  onOpen,
  initialMode = 15,
  resumeAvailable = false,
  resumeLabel,
  onResume,
  userProfile,
  appSettings,
}) => {
  const [selected, setSelected] = useState<LessonDurationMode>(initialMode);

  const effectiveProfile = useMemo(() => {
    if (userProfile && (userProfile.uid || (userProfile as any).id)) return userProfile;
    if (typeof window !== 'undefined') {
      const winProf = (window as any).__userProfile;
      if (winProf && (winProf.uid || winProf.id)) return winProf;
      try {
        const cached = localStorage.getItem('avelut_user_profile') || localStorage.getItem('user_profile');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return userProfile;
  }, [userProfile]);

  const pool = useMemo(
    () => getLiveMinutesRemaining(effectiveProfile, appSettings),
    [effectiveProfile, appSettings]
  );

  const { statuses: prepStatuses, isAnyPreparing, startPrep } = useLessonPrep({
    topicTitle,
    courseName,
    syllabusContext,
    userId: effectiveProfile?.uid,
    userProfile: effectiveProfile,
    appSettings,
  });

  if (!isOpen) return null;

  const periodLabel = pool.period === 'week' ? 'this week' : 'this month';

  const handleActionClick = (e: React.MouseEvent, mode: LessonDurationMode, state: string) => {
    e.stopPropagation();
    setSelected(mode);

    if (state === 'ready') {
      if (onOpen) onOpen(mode);
      else if (onConfirm) onConfirm(mode);
      return;
    }

    if (state === 'preparing') {
      // Already preparing — do nothing or show toast
      return;
    }

    // Request notification permission once on user tap
    requestNotificationPermission();

    // Trigger Prepare / Retry
    if (onPrepare) {
      onPrepare(mode);
    } else {
      void startPrep(mode);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[env(safe-area-inset-bottom,1.5rem)] sm:pb-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#0A0A0A] border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-lg w-full max-h-[84vh] sm:max-h-[88vh] shadow-2xl overflow-hidden flex flex-col text-black dark:text-white mb-8 sm:mb-0"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0">
              <i className="bi bi-clock-history text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black dark:text-white">Choose Lesson Duration</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Prepare in background &bull; Open when ready</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-500 dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-50 transition-colors"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        {/* Topic & Minutes Balance Banner */}
        <div className="px-5 py-2.5 bg-white dark:bg-[#0A0A0A] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider block">Topic</span>
            <span className="text-xs font-bold text-black dark:text-white truncate block max-w-full">{topicTitle}</span>
          </div>
          <div className="shrink-0 text-right rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-1.5">
            <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Included {periodLabel}</p>
            <p className="text-xs sm:text-sm font-black text-black dark:text-white">
              {pool.remaining}
              <span className="text-neutral-400 font-semibold text-xs"> / {pool.allowance} min</span>
            </p>
          </div>
        </div>

        {/* Reassuring notice while any prep is running */}
        {isAnyPreparing && (
          <div className="px-5 py-2.5 bg-brand-50 dark:bg-brand-950/40 border-b border-brand-200 dark:border-brand-900/50 flex items-center justify-between text-xs text-brand-900 dark:text-brand-200">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-brand-600 dark:border-brand-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
              <span className="font-semibold">Preparing lesson in background. You can leave anytime!</span>
            </div>
            <span className="text-[10px] text-brand-600 dark:text-brand-400 font-medium shrink-0">~2–4 min</span>
          </div>
        )}

        {/* Resume Previous Progress Option */}
        {resumeAvailable && onResume && (
          <div className="px-5 pt-3">
            <button
              type="button"
              onClick={onResume}
              className="w-full p-3 sm:p-4 rounded-2xl border-2 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-left hover:border-black dark:hover:border-white transition-all shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0">
                  <i className="bi bi-play-circle text-lg"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-black dark:text-white">Continue where you left off</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">{resumeLabel || 'Resume saved lecture progress'}</p>
                </div>
                <i className="bi bi-chevron-right text-neutral-400"></i>
              </div>
            </button>
          </div>
        )}

        {/* Duration Options with Dedicated Actions */}
        <div className="p-4 sm:p-5 space-y-3 max-h-[46vh] sm:max-h-[52vh] overflow-y-auto">
          {LESSON_DURATION_OPTIONS.map((opt) => {
            const isSelected = selected === opt.minutes;
            const optDecision = evaluateLiveTutorialStart(
              effectiveProfile,
              opt.minutes as LiveDurationMinutes,
              appSettings
            );
            const canAfford = optDecision.allowed;
            const prepStatus = prepStatuses[opt.minutes];
            const state = prepStatus?.state || 'idle';

            const priceBadge =
              optDecision.payment === 'included'
                ? `Included (${opt.minutes}m balance)`
                : optDecision.payment === 'credits'
                  ? `${optDecision.creditCost} credits`
                  : optDecision.message;

            return (
              <div
                key={opt.minutes}
                onClick={() => setSelected(opt.minutes)}
                className={`p-4 rounded-2xl border-2 transition-all flex flex-col gap-3 ${
                  !canAfford && state !== 'ready'
                    ? 'border-neutral-200 dark:border-neutral-800/60 bg-neutral-50 dark:bg-neutral-900/40 opacity-75'
                    : state === 'ready'
                      ? 'border-emerald-500/80 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-sm'
                      : state === 'preparing'
                        ? 'border-brand-500/70 bg-brand-50/30 dark:bg-brand-950/20'
                        : isSelected
                          ? 'border-black dark:border-white bg-neutral-50 dark:bg-neutral-900 shadow-sm'
                          : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0A0A0A] hover:border-neutral-300 dark:hover:border-neutral-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                        state === 'ready'
                          ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-black'
                          : state === 'preparing'
                            ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-black'
                            : isSelected && canAfford
                              ? 'bg-black text-white dark:bg-white dark:text-black'
                              : 'bg-neutral-100 dark:bg-neutral-800 text-black dark:text-white border border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      <i className={`bi ${opt.icon} text-base`}></i>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs sm:text-sm font-bold text-black dark:text-white">{opt.title}</span>
                        <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md">
                          {opt.subtitle} ({opt.boardsCount} boards)
                        </span>

                        {/* State badges */}
                        {state === 'ready' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 px-2 py-0.5 rounded-md">
                            <i className="bi bi-check-circle-fill text-emerald-600 dark:text-emerald-400"></i> Ready
                          </span>
                        )}
                        {state === 'preparing' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-800 dark:text-brand-300 bg-brand-100 dark:bg-brand-950/80 border border-brand-300 dark:border-brand-800 px-2 py-0.5 rounded-md animate-pulse">
                            <i className="bi bi-hourglass-split"></i> Preparing
                          </span>
                        )}
                        {state === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 px-2 py-0.5 rounded-md">
                            <i className="bi bi-exclamation-circle-fill text-rose-600 dark:text-rose-400"></i> Failed
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                        {opt.description}
                      </p>

                      <p className="text-[10px] font-bold mt-1 text-neutral-600 dark:text-neutral-300">
                        {priceBadge}
                      </p>
                    </div>
                  </div>

                  {/* Primary Action Button Per Duration Row */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {state === 'ready' ? (
                      <button
                        type="button"
                        onClick={(e) => handleActionClick(e, opt.minutes, 'ready')}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white cursor-pointer"
                      >
                        <i className="bi bi-play-fill text-base"></i>
                        <span>Open lesson</span>
                      </button>
                    ) : state === 'preparing' ? (
                      <button
                        type="button"
                        disabled
                        className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
                      >
                        <div className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Preparing…</span>
                      </button>
                    ) : state === 'failed' ? (
                      <button
                        type="button"
                        onClick={(e) => handleActionClick(e, opt.minutes, 'failed')}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all shadow-sm cursor-pointer"
                      >
                        <i className="bi bi-arrow-counterclockwise"></i>
                        <span>Retry prepare</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!canAfford}
                        onClick={(e) => canAfford && handleActionClick(e, opt.minutes, 'idle')}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm ${
                          canAfford
                            ? 'bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 cursor-pointer'
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'
                        }`}
                      >
                        <span>Prepare lesson</span>
                        <i className="bi bi-arrow-right text-xs"></i>
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Details When Preparing */}
                {state === 'preparing' && (
                  <div className="bg-brand-50/80 dark:bg-brand-950/50 border border-brand-200/80 dark:border-brand-900/60 rounded-xl p-2.5 text-xs text-brand-900 dark:text-brand-200 space-y-1.5 animate-fade-in">
                    <div className="flex items-center justify-between text-[11px] font-semibold">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-brand-500 animate-ping"></span>
                        {prepStatus?.message || '1/3 Planning lesson structure…'}
                      </span>
                      <span className="text-[10px] text-brand-600 dark:text-brand-400">
                        {prepStatus?.etaMinutes || '~2–4 min'}
                      </span>
                    </div>

                    {/* Progress Bar (board-level i/N when available) */}
                    <div className="w-full bg-brand-200 dark:bg-brand-900 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-brand-600 dark:bg-brand-400 h-1.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${
                            typeof prepStatus?.progressPercent === 'number'
                              ? prepStatus.progressPercent
                              : prepStatus?.step === 3
                                ? 90
                                : prepStatus?.step === 2
                                  ? 60
                                  : 30
                          }%`,
                        }}
                      ></div>
                    </div>

                    {typeof prepStatus?.boardIndex === 'number' && prepStatus?.totalBoards ? (
                      <p className="text-[10px] font-bold text-brand-700 dark:text-brand-300/90">
                        Board {Math.min(prepStatus.boardIndex, prepStatus.totalBoards)} of {prepStatus.totalBoards} prepared on device
                      </p>
                    ) : null}

                    <p className="text-[10px] text-brand-700 dark:text-brand-300/80 leading-relaxed">
                      &bull; This usually takes about 2–4 minutes.<br />
                      &bull; You can leave this page and keep using the app.<br />
                      &bull; We’ll notify you when this lesson is ready.
                    </p>
                  </div>
                )}

                {/* Failed Error Message */}
                {state === 'failed' && prepStatus?.error && (
                  <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                    {prepStatus.error}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer (No global Start lesson button) */}
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Lessons run automatically after preparation finishes.
          </p>
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-xs font-bold text-neutral-700 dark:text-neutral-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonDurationModal;
