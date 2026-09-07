import React, { useMemo, useState } from 'react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';

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
    subtitle: '~15 minutes',
    description: 'Fast overview — core idea, one key visual, short checks.',
    icon: 'bi-lightning-charge',
  },
  {
    minutes: 30,
    title: 'Standard',
    subtitle: '~30 minutes',
    description: 'Full concept walkthrough with examples and understanding checks.',
    icon: 'bi-book',
  },
  {
    minutes: 60,
    title: 'Full lecture',
    subtitle: '~60 minutes',
    description:
      'Real lecturer style — jokes, pauses, talk to you, chapters you can resume anytime.',
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

  if (!isOpen) return null;

  const periodLabel = pool.period === 'week' ? 'this week' : 'this month';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-neutral-200 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col text-black"
      >
        <div className="p-6 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-black text-white flex items-center justify-center">
              <i className="bi bi-clock-history text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black">How long should this lesson be?</h2>
              <p className="text-xs text-neutral-500">Included minutes first; longer lessons may use credits</p>
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

        <div className="px-6 py-3 bg-white border-b border-neutral-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Topic</span>
            <span className="text-xs font-bold text-black truncate block max-w-full">{topicTitle}</span>
          </div>
          <div className="shrink-0 text-right rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Included {periodLabel}</p>
            <p className="text-sm font-black text-black">
              {pool.remaining}
              <span className="text-neutral-400 font-semibold text-xs"> / {pool.allowance} min</span>
            </p>
          </div>
        </div>

        {resumeAvailable && onResume && (
          <div className="px-6 pt-4">
            <button
              type="button"
              onClick={onResume}
              className="w-full p-4 rounded-2xl border-2 border-neutral-300 bg-neutral-50 text-left hover:border-black transition-all"
            >
              <div className="flex items-center gap-2">
                <i className="bi bi-play-circle text-black text-lg"></i>
                <div>
                  <p className="text-sm font-bold text-black">Continue where you left off</p>
                  <p className="text-xs text-neutral-500">{resumeLabel || 'Resume saved lecture progress'}</p>
                </div>
              </div>
            </button>
          </div>
        )}

        <div className="p-6 space-y-3 max-h-[50vh] overflow-y-auto">
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
                ? `Included · uses ${opt.minutes} min`
                : optDecision.payment === 'credits'
                  ? `${optDecision.creditCost} credits`
                  : optDecision.message;

            return (
              <div
                key={opt.minutes}
                onClick={() => canAfford && setSelected(opt.minutes)}
                className={`p-4 rounded-2xl border-2 transition-all ${
                  !canAfford
                    ? 'border-neutral-100 bg-neutral-50 opacity-60 cursor-not-allowed'
                    : isSelected
                      ? 'border-black bg-neutral-50 shadow-sm cursor-pointer'
                      : 'border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 cursor-pointer'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                      isSelected && canAfford
                        ? 'bg-black text-white'
                        : 'bg-neutral-100 text-black border border-neutral-200'
                    }`}
                  >
                    <i className={`bi ${opt.icon} text-lg`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-black">{opt.title}</span>
                      <span className="text-[10px] font-semibold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-md">
                        {opt.subtitle}
                      </span>
                      {opt.minutes === 60 && (
                        <span className="text-[10px] font-bold text-black bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-md">
                          Lecturer style
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{opt.description}</p>
                    <p
                      className={`text-[10px] font-semibold mt-1.5 ${
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
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${
                      isSelected && canAfford
                        ? 'border-black bg-black text-white'
                        : 'border-neutral-300 bg-white'
                    }`}
                  >
                    {isSelected && canAfford && <i className="bi bi-check text-sm font-bold"></i>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 pb-2">
          <p className="text-[11px] text-neutral-500 leading-relaxed">{decision.message}</p>
        </div>

        <div className="p-6 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            type="button"
            className="px-5 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-bold text-neutral-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => decision.allowed && onConfirm(selected)}
            type="button"
            disabled={!decision.allowed}
            className="px-6 py-2.5 rounded-xl bg-black hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center space-x-2 transition-transform active:scale-95"
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
