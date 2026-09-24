import React, { useMemo, useState, useEffect } from 'react';
import { Lock, CheckCircle2, Sparkles, Clock, X, ChevronRight, Zap } from 'lucide-react';
import type { UserProfile, AppSettings } from '../../types';
import {
  evaluateLiveTutorialStart,
  getLiveMinutesRemaining,
  fetchLiveMinutePoolFromServer,
  type LiveDurationMinutes,
} from '../../utils/liveTutorialQuota';

export type LessonDurationMode = 15 | 30 | 60;

export interface LessonDurationItem {
  minutes: LessonDurationMode;
  name: string;
  tagline: string;
  description: string;
}

export const DURATION_OPTIONS: LessonDurationItem[] = [
  {
    minutes: 15,
    name: 'Quick Overview',
    tagline: '15 Minutes',
    description: 'Fast, high-impact intuition with key visual takeaways.',
  },
  {
    minutes: 30,
    name: 'Standard Masterclass',
    tagline: '30 Minutes',
    description: 'Complete concept breakdown, diagrams, and practical examples.',
  },
  {
    minutes: 60,
    name: 'Deep Dive Lecture',
    tagline: '60 Minutes',
    description: 'Full academic mastery with derivations, drills, and deep Q&A.',
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
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
  onBuyCredits?: () => void;
}

export const LessonDurationModal: React.FC<LessonDurationModalProps> = ({
  isOpen,
  topicTitle = 'Live Interactive Tutorial',
  courseName,
  onClose,
  onConfirm,
  onContinue,
  onPrepare,
  onOpen,
  initialMode = 15,
  userProfile,
  appSettings,
  onBuyCredits,
}) => {
  const [selectedMode, setSelectedMode] = useState<LessonDurationMode>(initialMode);
  const [serverPoolTrigger, setServerPoolTrigger] = useState(0);

  // Sync server minute pool when modal opens
  useEffect(() => {
    if (isOpen && userProfile?.uid) {
      const pool = getLiveMinutesRemaining(userProfile, appSettings);
      if (pool.periodKey) {
        fetchLiveMinutePoolFromServer(userProfile.uid, pool.periodKey)
          .then(() => setServerPoolTrigger((prev) => prev + 1))
          .catch(() => {});
      }
    }
  }, [isOpen, userProfile, appSettings]);

  // Evaluate decisions for all 3 duration options
  const decisions = useMemo(() => {
    const map: Record<LessonDurationMode, ReturnType<typeof evaluateLiveTutorialStart>> = {
      15: evaluateLiveTutorialStart(userProfile, 15, appSettings),
      30: evaluateLiveTutorialStart(userProfile, 30, appSettings),
      60: evaluateLiveTutorialStart(userProfile, 60, appSettings),
    };
    return map;
  }, [userProfile, appSettings, serverPoolTrigger]);

  if (!isOpen) return null;

  const activeDecision = decisions[selectedMode];
  const isSelectedLocked = !activeDecision?.allowed;

  const handleStart = () => {
    if (isSelectedLocked) {
      if (onBuyCredits) {
        onBuyCredits();
      } else {
        // Fallback: close and notify
        onClose();
      }
      return;
    }

    if (onConfirm) {
      onConfirm(selectedMode);
    } else if (onContinue) {
      onContinue(selectedMode);
    } else if (onOpen) {
      onOpen(selectedMode);
    } else if (onPrepare) {
      onPrepare(selectedMode);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#0F0F12] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between p-5 pb-3 border-b border-white/5">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/20">
                <Sparkles className="w-3 h-3" /> Live Classroom
              </span>
              {courseName && (
                <span className="text-xs text-white/40 truncate max-w-[160px]">
                  {courseName}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight line-clamp-1">
              {topicTitle}
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Select session duration to begin
            </p>
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Duration Options List */}
        <div className="p-5 space-y-3">
          {DURATION_OPTIONS.map((item) => {
            const decision = decisions[item.minutes];
            const isAllowed = decision?.allowed;
            const isSelected = selectedMode === item.minutes;
            const isIncluded = decision?.payment === 'included';

            return (
              <button
                key={item.minutes}
                type="button"
                onClick={() => setSelectedMode(item.minutes)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'bg-[#18181D] border-[#38BDF8] shadow-[0_0_20px_rgba(56,189,248,0.15)] ring-1 ring-[#38BDF8]'
                    : 'bg-[#141418]/60 border-white/5 hover:bg-[#18181D]/80 hover:border-white/10'
                }`}
              >
                {/* Left info */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`flex items-center justify-center w-11 h-11 rounded-xl shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#38BDF8] text-black font-bold'
                        : isAllowed
                        ? 'bg-white/10 text-white'
                        : 'bg-white/5 text-white/30'
                    }`}
                  >
                    <Clock className="w-5 h-5" />
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span
                      className={`text-sm font-bold tracking-tight truncate ${
                        isSelected ? 'text-white' : 'text-white/90'
                      }`}
                    >
                      {item.name}
                    </span>

                    {/* Small label underneath */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-semibold text-[#38BDF8]">
                        {item.tagline}
                      </span>

                      <span className="text-[11px] text-white/40">•</span>

                      {isIncluded ? (
                        <span className="text-[11px] font-medium text-emerald-400">
                          Included with Plan
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-white/50">
                          {decision?.creditCost} credits
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Status / Padlock icon */}
                <div className="flex items-center shrink-0 pl-2">
                  {!isAllowed ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Locked</span>
                    </div>
                  ) : isSelected ? (
                    <CheckCircle2 className="w-5 h-5 text-[#38BDF8]" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-white/20" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Balance Status Footer */}
        <div className="px-5 pb-2 text-xs text-white/40 flex items-center justify-between">
          <span>Your Credit Balance:</span>
          <span className="font-semibold text-white/70">
            {userProfile?.ai_credits_balance ?? 0} credits
          </span>
        </div>

        {/* Central Action Button */}
        <div className="p-5 pt-2">
          <button
            type="button"
            onClick={handleStart}
            className={`w-full flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl font-bold text-sm tracking-wide transition-all shadow-lg active:scale-[0.98] ${
              isSelectedLocked
                ? 'bg-white/10 hover:bg-white/15 text-white border border-white/15 hover:border-white/25 shadow-white/5'
                : 'bg-[#38BDF8] hover:bg-[#0284c7] text-black shadow-[0_0_25px_rgba(56,189,248,0.3)]'
            }`}
          >
            {isSelectedLocked ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Get Credits to Unlock ({activeDecision?.creditCost} Credits)</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>Start Lesson ({selectedMode} Minutes)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonDurationModal;
