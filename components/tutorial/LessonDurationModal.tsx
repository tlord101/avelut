import React, { useMemo, useState, useEffect } from 'react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';
import { useStructurePrefetch } from '../../hooks/useStructurePrefetch';

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
  onClose: () => void;
  onConfirm: (mode: LessonDurationMode) => void;
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
  onClose,
  onConfirm,
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

  const decision = useMemo(
    () => evaluateLiveTutorialStart(effectiveProfile, selected as LiveDurationMinutes, appSettings),
    [effectiveProfile, selected, appSettings]
  );

  const { 
    statuses: prefetchStatuses, 
    isAnyPrefetching, 
    isAnyFailed, 
    retry, 
    isReadyToStart 
  } = useStructurePrefetch({ 
    topicTitle, 
    courseName, 
    userId: effectiveProfile?.uid, 
    userProfile: effectiveProfile, 
    appSettings 
  });

  if (!isOpen) return null;

  const periodLabel = pool.period === 'week' ? 'this week' : 'this month';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[env(safe-area-inset-bottom,1.5rem)] sm:pb-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#0A0A0A] border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-lg w-full max-h-[84vh] sm:max-h-[88vh] shadow-2xl overflow-hidden flex flex-col text-black dark:text-white mb-8 sm:mb-0"
      >
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0">
              <i className="bi bi-clock-history text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black dark:text-white">How long should this lesson be?</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Each board takes ~2 minutes of teaching speech</p>
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

        {/* Global prefetch status banner across 15m, 30m, 60m */}
        {isAnyPrefetching && (
          <div className="px-5 py-2 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs font-semibold text-black dark:text-white">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-black dark:border-white border-t-transparent rounded-full animate-spin shrink-0"></div>
              <span>Preparing AI structures (15m, 30m, 60m)…</span>
            </div>
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal shrink-0">Background caching</span>
          </div>
        )}

        {isAnyFailed && (
          <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/50 flex flex-col sm:flex-row sm:items-center gap-2 justify-between text-xs font-medium text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <i className="bi bi-exclamation-triangle text-amber-600 dark:text-amber-500 text-sm"></i>
              <span>⚠ AI structure generation failed for some durations. You can retry or start with a fallback structure.</span>
            </div>
          </div>
        )}

        {resumeAvailable && onResume && (
          <div className="px-5 pt-3">
            <button
              type="button"
              onClick={onResume}
              className="w-full p-3 sm:p-4 rounded-2xl border-2 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-left hover:border-black dark:hover:border-white transition-all"
            >
              <div className="flex items-center gap-2">
                <i className="bi bi-play-circle text-black dark:text-white text-lg"></i>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-black dark:text-white">Continue where you left off</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{resumeLabel || 'Resume saved lecture progress'}</p>
                </div>
              </div>
            </button>
          </div>
        )}

        <div className="p-4 sm:p-5 space-y-2.5 max-h-[38vh] sm:max-h-[46vh] overflow-y-auto">
          {LESSON_DURATION_OPTIONS.map((opt) => {
            const isSelected = selected === opt.minutes;
            const optDecision = evaluateLiveTutorialStart(
              effectiveProfile,
              opt.minutes as LiveDurationMinutes,
              appSettings
            );
            const canAfford = optDecision.allowed;
            const priceLabel =
              optDecision.payment === 'included'
                ? `Included · uses ${opt.minutes} min balance`
                : optDecision.payment === 'credits'
                  ? `${optDecision.creditCost} credits`
                  : optDecision.message;

            const status = prefetchStatuses[opt.minutes];

            return (
              <div
                key={opt.minutes}
                onClick={() => canAfford && setSelected(opt.minutes)}
                className={`p-3.5 rounded-2xl border-2 transition-all ${
                  !canAfford
                    ? 'border-neutral-100 dark:border-neutral-900 bg-neutral-50 dark:bg-neutral-900/50 opacity-60 cursor-not-allowed'
                    : isSelected
                      ? 'border-black dark:border-white bg-neutral-50 dark:bg-neutral-900 shadow-sm cursor-pointer'
                      : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0A0A0A] hover:border-neutral-400 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-900/80 cursor-pointer'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                      isSelected && canAfford
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

                      {/* Dynamic Structure Ready / Generating badge per duration mode */}
                      {status?.state === 'ready' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 px-2 py-0.5 rounded-md">
                          <i className="bi bi-check-circle-fill text-emerald-600 dark:text-emerald-400"></i> Structure Ready
                        </span>
                      ) : status?.state === 'prefetching' ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-black dark:text-white bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 rounded-md animate-pulse">
                          <div className="w-2.5 h-2.5 border-2 border-black dark:border-white border-t-transparent rounded-full animate-spin"></div>
                          Generating AI structure…
                        </span>
                      ) : status?.state === 'failed' ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 dark:text-red-300 bg-red-100/80 dark:bg-red-950/60 border border-red-300 dark:border-red-800 px-2 py-0.5 rounded-md">
                            <i className="bi bi-exclamation-circle-fill text-red-600 dark:text-red-400"></i> Failed
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              retry(opt.minutes);
                            }}
                            className="text-[10px] font-semibold text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 transition-colors"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 rounded-md">
                          <i className="bi bi-cpu text-neutral-400"></i> Will generate on start
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{opt.description}</p>
                    <p
                      className={`text-[10px] font-semibold mt-1 ${
                        optDecision.payment === 'included'
                          ? 'text-neutral-700 dark:text-neutral-300'
                          : optDecision.payment === 'credits'
                            ? 'text-black dark:text-white'
                            : 'text-neutral-400'
                      }`}
                    >
                      {priceLabel}
                    </p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${
                      isSelected && canAfford
                        ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900'
                    }`}
                  >
                    {isSelected && canAfford && <i className="bi bi-check text-xs font-bold"></i>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 pb-1">
          <p className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">{decision.message}</p>
        </div>

        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-xs font-bold text-neutral-500 dark:text-neutral-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            type="button"
            className="px-5 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 transition-transform shadow-md bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 cursor-pointer"
          >
            <span>
              {decision.payment === 'credits'
                ? `Start · ${decision.creditCost} credits`
                : 'Start lesson'}
            </span>
            <i className="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonDurationModal;
