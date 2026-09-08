import React from 'react';
import type { UserProfile, AppSettings } from '../types';
import { Browser } from '@capacitor/browser';
import { isNative } from '../utils/capacitorUtils';

interface LimitExceededModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  cost: number;
  balance: number;
  addToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
  onSuccessPurchase?: () => void;
  onNavigate?: (view: string) => void;
}

export const LimitExceededModal: React.FC<LimitExceededModalProps> = ({
  isOpen,
  onClose,
  cost,
  balance,
  onNavigate,
}) => {
  if (!isOpen) return null;

  const handleUpgradeAccount = async () => {
    onClose();
    if (onNavigate) {
      onNavigate('billing');
      return;
    }
    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
    const plansUrl = `${baseUrl}/plans`;
    if (isNative()) {
      await Browser.open({ url: plansUrl });
    } else {
      window.location.href = plansUrl;
    }
  };

  const handleBuyCredits = async () => {
    onClose();
    if (onNavigate) {
      onNavigate('billing');
      return;
    }
    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
    const refillUrl = `${baseUrl}/refill-credits`;
    if (isNative()) {
      await Browser.open({ url: refillUrl });
    } else {
      window.location.href = refillUrl;
    }
  };

  const isLiveTutorial = cost >= 400;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in backdrop-blur-md">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer" onClick={onClose} />
      
      <div className="bg-white dark:bg-[#0A0A0A] rounded-[32px] w-full max-w-md relative z-10 overflow-hidden shadow-2xl border border-[#E3E9F1] dark:border-slate-800 animate-scale-in text-[#0F172A] dark:text-white">
        {/* Header banner */}
        <div className="bg-[#F6F6F3] dark:bg-slate-900/60 p-6 text-center border-b border-[#E3E9F1] dark:border-slate-800">
           <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-2xs">
              <i className="bi bi-lock-fill text-2xl"></i>
           </div>
           <h3 className="text-lg sm:text-xl font-black tracking-tight mb-1">
             {isLiveTutorial ? 'Live Tutorial Pass Required' : 'Credit Limit Reached'}
           </h3>
           <p className="text-xs text-[#64748B] dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
             {isLiveTutorial ? (
               <span>Interactive whiteboard Live Tutorials require an active plan or a single topic pass (<strong className="text-[#0F172A] dark:text-white font-bold">₦450</strong>).</span>
             ) : (
               <span>This action requires <strong className="text-[#0F172A] dark:text-white font-bold">{cost} credits</strong>, but you currently have <strong className="text-rose-600 font-bold">{balance} credits</strong>.</span>
             )}
           </p>
        </div>

        {/* Dual Actions Body */}
        <div className="p-5 sm:p-6 space-y-3">
           {/* Action 1: Upgrade to Plan */}
           <button
              onClick={handleUpgradeAccount}
              className="w-full bg-[#0066FF] hover:bg-[#002D62] text-white font-extrabold py-3.5 px-5 rounded-2xl transition-all shadow-md active:scale-[0.98] flex items-center justify-between group cursor-pointer"
           >
              <div className="flex items-center gap-3 text-left">
                 <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <i className="bi bi-stars text-base"></i>
                 </div>
                 <div>
                    <div className="text-sm font-bold leading-tight">Subscribe to Plan</div>
                    <div className="text-[11px] text-blue-100 font-medium">Weekly ₦1,200 / Monthly ₦4,000</div>
                 </div>
              </div>
              <i className="bi bi-chevron-right text-sm group-hover:translate-x-1 transition-transform"></i>
           </button>

           {/* Action 2: Pay-As-You-Go Credits */}
           <button
              onClick={handleBuyCredits}
              className="w-full bg-[#F6F6F3] dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 text-[#0F172A] dark:text-white font-bold py-3.5 px-5 rounded-2xl transition-all shadow-2xs active:scale-[0.98] flex items-center justify-between group cursor-pointer"
           >
              <div className="flex items-center gap-3 text-left">
                 <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0066FF] shrink-0 shadow-2xs">
                    <i className="bi bi-credit-card text-base"></i>
                 </div>
                 <div>
                    <div className="text-sm font-bold leading-tight">
                      {isLiveTutorial ? 'Buy Topic Pass (₦450)' : 'Refill Extra Credits'}
                    </div>
                    <div className="text-[11px] text-[#64748B] dark:text-slate-400 font-medium">Pay-as-you-go without recurring billing</div>
                 </div>
              </div>
              <i className="bi bi-chevron-right text-sm text-[#64748B] group-hover:translate-x-1 transition-transform"></i>
           </button>
           
           {/* Dismiss */}
           <button
              onClick={onClose}
              className="w-full py-2 text-center text-xs font-bold text-[#64748B] hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
           >
              Maybe Later
           </button>
        </div>
      </div>
    </div>
  );
};
