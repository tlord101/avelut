import React, { useMemo, useState } from 'react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  fetchLiveMinutePoolFromServer,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';

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
    description: 'Real lecturer style — chapters, deep dives, pauses, resume anytime.',
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
  onContinue?: (mode: LessonDurationMode) => void;
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
  onContinue,
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
  const [serverPoolTrigger, setServerPoolTrigger] = useState(0);

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
    [effectiveProfile, appSettings, serverPoolTrigger]
  );

  React.useEffect(() => {
    if (isOpen && effectiveProfile?.uid && pool.periodKey) {
      fetchLiveMinutePoolFromServer(effectiveProfile.uid, pool.periodKey).then(() => {
        setServerPoolTrigger((prev) => prev + 1);
      }).catch(console.warn);
    }
  }, [isOpen, effectiveProfile?.uid, pool.periodKey]);

  if (!isOpen) return null;

  const periodLabel = pool.period === 'week' ? 'this week' : 'this month';

  const selectedDecision = evaluateLiveTutorialStart(
    effectiveProfile,
    selected as LiveDurationMinutes,
    appSettings
  );

  const handleContinueClick = () => {
    if (onContinue) {
      onContinue(selected);
    } else if (onConfirm) {
      onConfirm(selected);
    } else if (onOpen) {
      onOpen(selected);
    } else if (onPrepare) {
      onPrepare(selected);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#0A0A0A] border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-lg w-full max-h-[86vh] sm:max-h-[90vh] shadow-2xl overflow-hidden flex flex-col text-black dark:text-white"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0">
              <i className="bi bi-clock-history text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black dark:text-white">Choose Lesson Duration</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Board-first live interactive lecture</p>
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

        {/* Resume Previous Progress Option */}
        {resumeAvailable && onResume && (
          <div className="px-5 pt-3">
            <button
              type="button"
              onClick={onResume}
              className="w-full p-3 sm:p-4 rounded-2xl border-2 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-left hover:border-black dark:hover:border-white transition-all shadow-sm cursor-pointer"
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

        {/* Duration Options */}
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto max-h-[50vh]">
          {LESSON_DURATION_OPTIONS.map((opt) => {
            const isSelected = selected === opt.minutes;
            const optDecision = evaluateLiveTutorialStart(
              effectiveProfile,
              opt.minutes as LiveDurationMinutes,
              appSettings
            );
            const canAfford = optDecision.allowed;

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
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-black dark:border-white bg-neutral-50 dark:bg-[#141414] shadow-sm'
                    : 'border-neutral-200 dark:border-[#2A2A2A] bg-white dark:bg-[#0A0A0A] hover:border-neutral-300 dark:hover:border-[#3A3A3A]'
                } ${!canAfford ? 'opacity-70' : ''}`}
              >
                <div className="flex items-center gap-3.5 flex-1 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : 'bg-neutral-100 dark:bg-[#1C1C1C] text-black dark:text-white border border-neutral-200 dark:border-[#2A2A2A]'
                    }`}
                  >
                    <i className={`bi ${opt.icon} text-base`}></i>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-bold text-black dark:text-white">{opt.title}</span>
                      <span className="text-[10px] font-semibold text-neutral-500 dark:text-[#A3A3A3] bg-neutral-100 dark:bg-[#1C1C1C] px-2 py-0.5 rounded-md">
                        {opt.subtitle} ({opt.boardsCount} boards)
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                      {opt.description}
                    </p>
                    <p className="text-[10px] font-bold mt-1 text-neutral-600 dark:text-neutral-300">
                      {priceBadge}
                    </p>
                  </div>
                </div>

                {/* Radio indicator */}
                <div className="shrink-0">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'border-black dark:border-white bg-black dark:bg-white'
                        : 'border-neutral-300 dark:border-neutral-700 bg-transparent'
                    }`}
                  >
                    {isSelected && <div className="w-2 h-2 rounded-full bg-white dark:bg-black" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: Single Primary Continue Button */}
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
            {selectedDecision.allowed ? `Ready to start ~${selected}m live tutorial` : selectedDecision.message}
          </p>
          <button
            onClick={handleContinueClick}
            type="button"
            className="px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 transition-all shadow-md flex items-center gap-2 cursor-pointer shrink-0"
          >
            <span>Continue</span>
            <i className="bi bi-arrow-right text-xs"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonDurationModal;
