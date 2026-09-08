import React from 'react';

export interface InsufficientCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  requiredCost: number;
  durationMinutes: 15 | 30 | 60;
  poolRemaining: number;
  onBuyCredits?: () => void;
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
  onBuyCredits,
  onTryShorter,
  affordableModes,
}) => {
  if (!isOpen) return null;

  const deficit = requiredCost - currentBalance;
  
  // Choose the longest affordable shorter mode, if any
  const shorterMode = affordableModes && affordableModes.length > 0 
    ? Math.max(...affordableModes) as 15 | 30 | 60 
    : undefined;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-24 sm:pb-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#0A0A0A] border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col text-black dark:text-white mb-8 sm:mb-0"
      >
        <div className="p-4 sm:p-5 bg-neutral-50 dark:bg-[#111111] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <i className="bi bi-exclamation-triangle-fill text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-black dark:text-white">Insufficient Credits</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{durationMinutes}m lesson requires {requiredCost} credits</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-500 dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-50 transition-colors cursor-pointer"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-1.5 p-4 bg-neutral-50 dark:bg-[#111111] rounded-2xl border border-neutral-200 dark:border-neutral-800">
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-600 dark:text-neutral-400 font-medium">Your balance</span>
              <span className="font-bold text-black dark:text-white">{currentBalance} credits</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-600 dark:text-neutral-400 font-medium">Required</span>
              <span className="font-bold text-black dark:text-white">{requiredCost} credits</span>
            </div>
            <div className="h-px w-full bg-neutral-200 dark:bg-neutral-800 my-1"></div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-rose-600 dark:text-rose-400 font-bold">Deficit</span>
              <span className="font-bold text-rose-600 dark:text-rose-400">-{deficit} credits</span>
            </div>
          </div>

          {poolRemaining > 0 && (
            <p className="text-xs text-center text-neutral-500 dark:text-neutral-400 px-2">
              You have <span className="font-bold text-black dark:text-white">{poolRemaining}</span> included minutes left.
            </p>
          )}

          <div className="space-y-2 pt-2">
            {onBuyCredits && (
              <button
                onClick={onBuyCredits}
                type="button"
                className="w-full py-3 px-4 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-200 text-sm font-bold flex items-center justify-center space-x-2 transition-transform active:scale-95 shadow-md cursor-pointer"
              >
                <i className="bi bi-credit-card"></i>
                <span>Buy Credits</span>
              </button>
            )}

            {shorterMode && onTryShorter && (
              <button
                onClick={() => onTryShorter(shorterMode)}
                type="button"
                className="w-full py-3 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-black dark:text-white text-sm font-bold flex items-center justify-center space-x-2 transition-colors cursor-pointer"
              >
                <i className="bi bi-lightning-charge"></i>
                <span>Try a {shorterMode}m lesson</span>
              </button>
            )}

            <button
              onClick={onClose}
              type="button"
              className="w-full py-2.5 text-xs font-bold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsufficientCreditsModal;
