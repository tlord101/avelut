import { db } from '../firebase';
import { ref as dbRef, push, set, update, get, runTransaction } from 'firebase/database';
import type { UserProfile, AppSettings } from '../types';
import { DEFAULT_USAGE_SETTINGS } from './appSettings';

// Load Paystack script dynamically
const loadPaystackScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if ((window as any).PaystackPop) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

interface PaystackPurchaseOptions {
  publicKey: string;
  email: string;
  amount: number;
  userId: string;
  purchaseType: 'subscription' | 'additional_credits';
  metadata?: any;
  onSuccess: (reference: string) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: any) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const triggerPaystackPurchase = async (options: PaystackPurchaseOptions) => {
  const { publicKey, email, amount, userId, purchaseType, metadata, onSuccess, onCancel, onError, addToast } = options;

  let paymentLogRef: any = null;
  try {
    paymentLogRef = push(dbRef(db, 'usage_logs/payments'));
    await set(paymentLogRef, {
      id: paymentLogRef.key,
      user_id: userId,
      email: email,
      amount: amount,
      purchase_type: purchaseType,
      metadata: metadata || {},
      status: 'initiated',
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Failed to create payment log:', err);
  }

  if (!publicKey) {
    addToast('Demo Mode: Simulating checkout...', 'info');
    setTimeout(async () => {
      const referenceId = 'demo_' + Math.random().toString(36).substring(2, 11);
      if (paymentLogRef) {
        try {
          await update(paymentLogRef, { status: 'success', reference: referenceId });
        } catch (e) {}
      }
      try {
        await onSuccess(referenceId);
      } catch (e) {
        if (onError) onError(e);
      }
    }, 2000);
    return;
  }

  const isLoaded = await loadPaystackScript();
  if (!isLoaded) {
    addToast('Could not load payment gateway.', 'error');
    if (paymentLogRef) {
      try {
        await update(paymentLogRef, { status: 'failed', error: 'Script load failed' });
      } catch (e) {}
    }
    if (onError) onError(new Error('Paystack script load failed'));
    return;
  }

  try {
    const handler = (window as any).PaystackPop.setup({
      key: publicKey,
      email: email,
      amount: amount * 100, // in kobo
      currency: 'NGN',
      callback: (response: any) => {
        const runAsyncCallback = async () => {
          const reference = response?.reference || 'ref_missing';
          if (paymentLogRef) {
            try {
              await update(paymentLogRef, { status: 'success', reference });
            } catch (e) {}
          }
          try {
            await onSuccess(reference);
          } catch (e) {
            if (onError) onError(e);
          }
        };
        void runAsyncCallback();
      },
      onClose: () => {
        const runAsyncClose = async () => {
          if (paymentLogRef) {
            try {
              await update(paymentLogRef, { status: 'cancelled' });
            } catch (e) {}
          }
          addToast('Payment cancelled.', 'info');
          if (onCancel) onCancel();
        };
        void runAsyncClose();
      },
    });
    handler.openIframe();
  } catch (e: any) {
    console.error(e);
    if (paymentLogRef) {
      try {
        await update(paymentLogRef, { status: 'failed', error: e.message });
      } catch (err) {}
    }
    addToast('Error during payment processing.', 'error');
    if (onError) onError(e);
  }
};

// Cost configuration map
export const AI_COSTS = {
  VISUAL_SOLVE: 2,
  CHAT_INTERACTION: 1,
  FLASHCARD_GENERATION: 3,
};

// Check if user is exempt from limits
const isExempt = (userProfile: UserProfile): boolean => {
  return !!(userProfile.is_admin || userProfile.use_personal_token || userProfile.subscription_status === 'personal_token');
};

/**
 * Validates if the user has enough AI credits for a given action.
 */
export const checkAICredits = (
  userProfile: UserProfile,
  cost: number,
  appSettings: AppSettings
) => {
  if (isExempt(userProfile)) {
    return { allowed: true, balance: Infinity, cost: 0 };
  }

  const planKey = (userProfile.subscription_status || 'free') as 'free' | 'basic' | 'pro';
  const usageSettings = appSettings.usage_settings || DEFAULT_USAGE_SETTINGS;
  const monthlyLimit = usageSettings.plans[planKey]?.limits?.monthly_ai_credits ?? DEFAULT_USAGE_SETTINGS.plans.free.limits.monthly_ai_credits;
  
  const balance = userProfile.ai_credits_balance ?? monthlyLimit;
  const allowed = balance >= cost;

  return { allowed, balance, cost };
};

/**
 * Safely decrements user AI credit balance in the database.
 */
export const deductAICredits = async (userId: string, cost: number, featureName: string) => {
  try {
    const userRef = dbRef(db, `users/${userId}`);
    const result = await runTransaction(userRef, (profile) => {
      if (profile) {
        const currentBalance = profile.ai_credits_balance ?? 0;
        profile.ai_credits_balance = Math.max(0, currentBalance - cost);
      }
      return profile;
    });

    if (result.committed) {
      // Log usage
      const usageLogRef = push(dbRef(db, `usage_logs/credits/${userId}`));
      await set(usageLogRef, {
        feature: featureName,
        deduction: cost,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.error('Failed to deduct AI credits:', err);
  }
};

// LEGACY trackers kept temporarily for smooth migration or removed if not referenced.
// We will replace their calls in components in the next step.
