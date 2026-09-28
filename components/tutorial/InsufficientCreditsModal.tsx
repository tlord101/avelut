import React from 'react';
import type { UserProfile, AppSettings } from '../../types';
import { CANONICAL_PRICING } from '../../utils/appSettings';

export interface InsufficientCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  requiredCost: number;
  durationMinutes: 15 | 30 | 60;
  poolRemaining: number;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
  onBuyCredits?: () => void;
  onUpgradePro?: () => void;
  onTryShorter?: (mode: 15 | 30 | 60) => void;
  affordableModes?: (15 | 30 | 60)[];
}

export const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({
  isOpen,
  onClose,
  currentBalance,
  requiredCost,
  durationMinutes,
  poolRemaining,
  userProfile,
  appSettings,
  onBuyCredits,
  onUpgradePro,
  onTryShorter,
  affordableModes,
}) => {
  if (!isOpen) return null;

  const isPro = userProfile?.subscription_status === 'pro' ||
    userProfile?.subscription_status === 'monthly' ||
    userProfile?.subscription_status === 'premium' ||
    userProfile?.subscription_status === 'semester';

  const proPriceNgn = CANONICAL_PRICING.pro.priceNgn;
  const proMinutes = CANONICAL_PRICING.pro.liveTutorialMinutes;

  const handleBuyCreditsAction = () => {
    if (onBuyCredits) {
      onBuyCredits();
    } else {
      window.location.href = '/refill-credits';
    }
  };

  const handleUpgradeProAction = () => {
    if (onUpgradePro) {
      onUpgradePro();
    } else {
      window.location.href = '/plans';
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FAFAF8] dark:bg-[#171717] border border-[#E5E5E0] dark:border-[#2A2A2A] rounded-[24px] max-w-sm w-full p-6 text-[#111111] dark:text-[#F5F5F5] flex flex-col shadow-lg"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-neutral-200/70 dark:bg-neutral-800 text-[#111111] dark:text-[#F5F5F5] flex items-center justify-center shrink-0">
              <i className="bi bi-broadcast text-base" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Live Tutorial</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-7 h-7 rounded-full bg-neutral-200/60 dark:bg-neutral-800 flex items-center justify-center text-[#666666] dark:text-[#A3A3A3] hover:text-[#111111] dark:hover:text-[#F5F5F5] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <i className="bi bi-x-lg text-xs" />
          </button>
        </div>

        <p className="text-xs text-[#666666] dark:text-[#A3A3A3] mb-4">
          You don't have enough access for this {durationMinutes}m lesson.
        </p>

        {/* Balance summary */}
        <div className="flex flex-col gap-1.5 p-3.5 bg-white dark:bg-[#0A0A0A] rounded-2xl border border-[#E5E5E0] dark:border-[#2A2A2A] mb-5 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-[#666666] dark:text-[#A3A3A3]">Included minutes remaining</span>
            <span className="font-semibold">{poolRemaining} mins</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#666666] dark:text-[#A3A3A3]">Requested lesson</span>
            <span className="font-semibold">{durationMinutes} mins</span>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {!isPro && (
            <div className="p-4 rounded-2xl border border-[#E5E5E0] dark:border-[#2A2A2A] bg-white dark:bg-[#0A0A0A] space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm block">Pro</span>
                  <span className="text-xs text-[#666666] dark:text-[#A3A3A3]">{proMinutes} live minutes included</span>
                </div>
                <span className="text-xs font-extrabold">₦{proPriceNgn.toLocaleString()} / mo</span>
              </div>
              <button
                onClick={handleUpgradeProAction}
                type="button"
                className="w-full py-2.5 px-4 rounded-xl bg-black dark:bg-white text-white dark:text-black font-bold text-xs hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <i className="bi bi-star-fill text-xs text-amber-400" />
                <span>Upgrade to Pro</span>
              </button>
            </div>
          )}

          <div className="p-4 rounded-2xl border border-[#E5E5E0] dark:border-[#2A2A2A] bg-white dark:bg-[#0A0A0A] space-y-3">
            <div>
              <span className="font-bold text-sm block">Buy Live Tutorial Credits</span>
              <span className="text-xs text-[#666666] dark:text-[#A3A3A3]">Pay-as-you-go packages:</span>
            </div>
            <div className="text-xs space-y-1 text-[#666666] dark:text-[#A3A3A3] font-medium">
              <div className="flex justify-between"><span>15 min</span><span className="font-bold text-[#111111] dark:text-[#F5F5F5]">₦299</span></div>
              <div className="flex justify-between"><span>30 min</span><span className="font-bold text-[#111111] dark:text-[#F5F5F5]">₦599</span></div>
              <div className="flex justify-between"><span>60 min</span><span className="font-bold text-[#111111] dark:text-[#F5F5F5]">₦1,099</span></div>
            </div>
            <button
              onClick={handleBuyCreditsAction}
              type="button"
              className="w-full py-2.5 px-4 rounded-xl border border-[#E5E5E0] dark:border-[#2A2A2A] bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-[#111111] dark:text-[#F5F5F5] font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <i className="bi bi-credit-card text-xs" />
              <span>Buy Credits</span>
            </button>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="w-full py-2 text-xs font-semibold text-[#666666] hover:text-[#111111] dark:text-[#A3A3A3] dark:hover:text-[#F5F5F5] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default InsufficientCreditsModal;
