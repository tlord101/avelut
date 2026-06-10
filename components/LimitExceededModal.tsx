import React, { useState } from 'react';
import type { UserProfile, AppSettings } from '../types';
import { triggerPaystackPurchase } from '../utils/usage';
import { db } from '../firebase';
import { ref as dbRef, runTransaction } from 'firebase/database';

interface LimitExceededModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  appSettings: AppSettings;
  cost: number;
  balance: number;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onSuccessPurchase: () => void;
}

export const LimitExceededModal: React.FC<LimitExceededModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  appSettings,
  cost,
  balance,
  addToast,
  onSuccessPurchase,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const refillAmount = 20; // 20 credits per refill
  const refillPrice = 500; // 500 NGN per 20 credits

  const handlePurchase = async () => {
    setIsProcessing(true);
    const publicKey = appSettings.paystack_public_key?.trim();
    const email = userProfile.email || `${userProfile.uid}@avelut.com`;

    await triggerPaystackPurchase({
      publicKey,
      email,
      amount: refillPrice,
      userId: userProfile.uid,
      purchaseType: 'additional_credits',
      metadata: { 
        refill_amount: refillAmount,
        cost_of_action: cost
      },
      addToast,
      onSuccess: async (reference) => {
        try {
          const userRef = dbRef(db, `users/${userProfile.uid}`);
          await runTransaction(userRef, (profile) => {
            if (profile) {
              const currentBalance = profile.ai_credits_balance ?? 0;
              profile.ai_credits_balance = currentBalance + refillAmount;
            }
            return profile;
          });

          addToast(`Refill successful! +${refillAmount} AI Credits added.`, 'success');
          onSuccessPurchase();
          onClose();
        } catch (e: any) {
          console.error(e);
          addToast('Payment received but credits failed to update. Contact support.', 'error');
        } finally {
          setIsProcessing(false);
        }
      },
      onCancel: () => {
        setIsProcessing(false);
      },
      onError: (err) => {
        console.error(err);
        setIsProcessing(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Dark Blur Overlay */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      
      {/* Dialog Body */}
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-[28px] p-6 shadow-2xl animate-in scale-in duration-200">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-center text-blue-600 mb-4 animate-pulse">
            ⚡
          </div>
          <h3 className="text-lg font-black text-slate-900 leading-tight">
            Out of AI Credits
          </h3>
          <p className="text-xs text-slate-500 mt-1 font-semibold">
            Top-up your balance to continue using AI features.
          </p>
        </div>

        <div className="my-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs font-semibold text-slate-700">
          <div className="flex justify-between">
            <span>Your Current Balance:</span>
            <span className="font-extrabold text-slate-900">{balance} Credits</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2">
            <span>Action Cost:</span>
            <span className="font-extrabold text-red-600">{cost} Credits</span>
          </div>
        </div>

        <div className="mb-6 bg-blue-50/50 border border-blue-200 rounded-2xl p-4 text-center">
          <span className="text-[9px] uppercase font-black tracking-widest text-blue-600 block mb-1">Instant Refill</span>
          <p className="text-xs text-slate-700 font-extrabold mb-3">
            Add {refillAmount} AI Credits to your balance.
          </p>
          <span className="text-2xl font-black text-slate-900">
            ₦{refillPrice.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="py-3 text-slate-500 hover:text-slate-800 text-xs font-black uppercase tracking-wider rounded-xl transition-all border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePurchase}
            disabled={isProcessing}
            className="py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Refill Now'}
          </button>
        </div>
      </div>
    </div>
  );
};
