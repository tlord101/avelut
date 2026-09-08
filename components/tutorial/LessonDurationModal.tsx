import React, { useMemo, useState } from 'react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';
import { isTopicStructureFetching, topicKeyFromTitle } from '../../services/liveTeachingProgressService';

export type LessonDurationMode = 15 | 30 | 60;

export interface LessonDurationOption {
  minutes: LessonDurationMode;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
}

export const LESSON_DURATION_OPTIONS: LessonDurationOption[] = [
  {
    minutes: 15,
    title: 'Quick',
    subtitle: '~15 minutes (8 boards)',
    description: 'Fast overview — core idea, key visuals, short understanding check.',
    icon: 'bi-lightning-charge',
  },
  {
    minutes: 30,
    title: 'Standard',
    subtitle: '~30 minutes (15 boards)',
    description: 'Full concept walkthrough with step-by-step illustrations and checks.',
    icon: 'bi-book',
  },
  {
    minutes: 60,
    title: 'Full lecture',
    subtitle: '~60 minutes (30 boards)',
    description:
      'Real lecturer style — chapters, deep dives, pauses, resume anytime.',
    icon: 'bi-mortarboard',
  },
];

export interface LessonDurationModalProps {
  isOpen: boolean;
  topicTitle?: string;
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
    if (userProfile && (userProfile.uid || userProfile.id)) return userProfile;
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

  const isPrefetching = useMemo(() => {
    const userId = effectiveProfile?.uid || 'anon';
    const topicKey = topicKeyFromTitle(topicTitle);
    return isTopicStructureFetching(userId, topicKey, selected);
  }, [effectiveProfile, topicTitle, selected]);

  if (!isOpen) return null;

  const periodLabel = pool.period === 'week' ? 'this week' : 'this month';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-24 sm:pb-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-neutral-200 rounded-3xl max-w-lg w-full max-h-[84vh] sm:max-h-[88vh] shadow-2xl overflow-hidden flex flex-col text-black mb-8 sm:mb-0"
      >
        <div className="p-4 sm:p-5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-black text-white flex items-center justify-center shrink-0">
              <i className="bi bi-clock-history text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black">How long should this lesson be?</h2>
              <p className="text-xs text-neutral-500">Each board takes ~2 minutes of teaching speech</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-neutral-500 hover:text-black hover:bg-neutral-50 transition-colors"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        <div className="px-5 py-2.5 bg-white border-b border-neutral-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Topic</span>
            <span className="text-xs font-bold text-black truncate block max-w-full">{topicTitle}</span>
          </div>
          <div className="shrink-0 text-right rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5">
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Included {periodLabel}</p>
            <p className="text-xs sm:text-sm font-black text-black">
              {pool.remaining}
              <span className="text-neutral-400 font-semibold text-xs"> / {pool.allowance} min</span>
            </p>
          </div>
        </div>

        {isPrefetching && (
          <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs font-semibold text-blue-700 animate-pulse">
            <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
            <span>Fetching topic teaching structure in background…</span>
          </div>
        )}

        {resumeAvailable && onResume && (
          <div className="px-5 pt-3">
            <button
              type="button"
              onClick={onResume}
              className="w-full p-3 sm:p-4 rounded-2xl border-2 border-neutral-300 bg-neutral-50 text-left hover:border-black transition-all"
            >
              <div className="flex items-center gap-2">
                <i className="bi bi-play-circle text-black text-lg"></i>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-black">Continue where you left off</p>
                  <p className="text-[11px] text-neutral-500">{resumeLabel || 'Resume saved lecture progress'}</p>
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

            return (
              <div
                key={opt.minutes}
                onClick={() => canAfford && setSelected(opt.minutes)}
                className={`p-3.5 rounded-2xl border-2 transition-all ${
                  !canAfford
                    ? 'border-neutral-100 bg-neutral-50 opacity-60 cursor-not-allowed'
                    : isSelected
                      ? 'border-black bg-neutral-50 shadow-sm cursor-pointer'
                      : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 cursor-pointer'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                      isSelected && canAfford
                        ? 'bg-black text-white'
                        : 'bg-neutral-100 text-black border border-neutral-200'
                    }`}
                  >
                    <i className={`bi ${opt.icon} text-base`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-black">{opt.title}</span>
                      <span className="text-[10px] font-semibold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-md">
                        {opt.subtitle}
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-neutral-500 mt-0.5 leading-relaxed">{opt.description}</p>
                    <p
                      className={`text-[10px] font-semibold mt-1 ${
                        optDecision.payment === 'included'
                          ? 'text-neutral-700'
                          : optDecision.payment === 'credits'
                            ? 'text-black'
                            : 'text-neutral-400'
                      }`}
                    >
                      {priceLabel}
                    </p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${
                      isSelected && canAfford
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-300 bg-white'
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
          <p className="text-[10px] sm:text-[11px] text-neutral-500 leading-relaxed">{decision.message}</p>
        </div>

        <div className="p-4 sm:p-5 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-bold text-neutral-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => decision.allowed && onConfirm(selected)}
            type="button"
            disabled={!decision.allowed}
            className="px-5 py-2.5 rounded-xl bg-black hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center space-x-2 transition-transform active:scale-95 shadow-md"
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
