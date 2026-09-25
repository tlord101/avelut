import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { UserProfile, AppSettings } from '../types';
import { DEFAULT_USAGE_SETTINGS, DEFAULT_APP_SETTINGS } from './appSettings';
import { saveLocalCredits, recordLocalCreditDeduction } from '../services/creditsStorageService';
import { notifyUserCreditsUpdated } from '../lib/supabaseRealtimeDb';

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
  userName?: string;
  purchaseType: 'subscription' | 'additional_credits';
  metadata?: any;
  onSuccess: (reference: string) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: any) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const triggerPaystackPurchase = async (options: PaystackPurchaseOptions) => {
  const { publicKey, email, amount, userId, purchaseType, metadata, onSuccess, onCancel, onError, addToast } = options;

  let paymentLogId = 'pay_' + Date.now();
  if (isSupabaseConfigured && userId) {
    try {
      await supabase.from('reports').insert({
        reporter_id: userId,
        type: 'feedback',
        title: `Payment initiated: ${purchaseType}`,
        details: JSON.stringify({ amount, email, purchaseType, plan_key: metadata?.plan_key }),
      });
    } catch (err) {
      console.warn('Failed to log payment attempt:', err);
    }
  }

  const paystackMetadata = {
    ...(metadata || {}),
    payment_log_id: paymentLogId || metadata?.payment_log_id,
    custom_fields: [
      ...(Array.isArray(metadata?.custom_fields) ? metadata.custom_fields : []),
      { display_name: 'User ID', variable_name: 'user_id', value: userId },
      { display_name: 'Purchase Type', variable_name: 'purchase_type', value: purchaseType },
      ...(metadata?.plan_key ? [{ display_name: 'Plan Key', variable_name: 'plan_key', value: metadata.plan_key }] : []),
    ],
  };

  if (!publicKey) {
    const isProd = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD;
    const allowDemo = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ALLOW_DEMO_PAYMENTS === 'true';

    if (isProd && !allowDemo) {
      addToast('Payment gateway is not configured.', 'error');
      if (onError) onError(new Error('Paystack public key is missing in production'));
      throw new Error('Paystack public key is missing in production');
    }

    addToast('Demo Mode: Simulating checkout...', 'info');
    setTimeout(async () => {
      const referenceId = 'demo_' + Math.random().toString(36).substring(2, 11);
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
    if (onError) onError(new Error('Paystack script load failed'));
    return;
  }

  try {
    const handler = (window as any).PaystackPop.setup({
      key: publicKey,
      email: email,
      amount: amount * 100,
      currency: 'NGN',
      metadata: paystackMetadata,
      callback: (response: any) => {
        const runAsyncCallback = async () => {
          const reference = response?.reference || 'ref_missing';
          if (response?.status && response.status !== 'success') {
            if (onError) onError(new Error(response.message || 'Transaction was not successful'));
            return;
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
        addToast('Payment cancelled.', 'info');
        if (onCancel) onCancel();
      },
    });
    handler.openIframe();
  } catch (e: any) {
    console.error(e);
    addToast('Error during payment processing.', 'error');
    if (onError) onError(e);
  }
};

export const getFeatureCost = (
  feature:
    | 'visual_solve'
    | 'chat_interaction'
    | 'flashcard_generation'
    | 'study_guide_extraction'
    | 'ai_quiz_generation'
    | 'study_guide_lesson'
    | 'live_tutorial'
    | 'live_tutorial_15'
    | 'live_tutorial_30'
    | 'live_tutorial_60'
    | 'live_tutorial_question',
  appSettings?: AppSettings | null
): number => {
  const costs = appSettings?.usage_settings?.feature_costs as any;
  const defaults = DEFAULT_USAGE_SETTINGS.feature_costs as any;
  return costs?.[feature] ?? defaults?.[feature] ?? (feature === 'live_tutorial_question' ? 50 : 1);
};

export const getFeatureModel = (
  feature: 'visual_solve' | 'chat_interaction' | 'flashcard_generation' | 'study_guide_extraction' | 'ai_quiz_generation' | 'study_guide_lesson' | 'title_generation',
  appSettings?: AppSettings | null
): string => {
  const model = appSettings?.usage_settings?.feature_models?.[feature] || appSettings?.alibaba_model || DEFAULT_APP_SETTINGS.alibaba_model || 'qwen3.8-omni-flash';
  const clean = (model || 'qwen3.8-omni-flash')
    .replace(/^qwen\//i, '')
    .replace(/^alibaba\//i, '')
    .replace(/^google\//i, '')
    .replace(/^openai\//i, '')
    .replace(/^anthropic\//i, '')
    .trim();
  if (!clean.toLowerCase().startsWith('qwen')) {
    return 'qwen3.8-omni-flash';
  }
  return clean;
};

export const AI_COSTS = {
  get VISUAL_SOLVE() { return DEFAULT_USAGE_SETTINGS.feature_costs.visual_solve; },
  get CHAT_INTERACTION() { return DEFAULT_USAGE_SETTINGS.feature_costs.chat_interaction; },
  get FLASHCARD_GENERATION() { return DEFAULT_USAGE_SETTINGS.feature_costs.flashcard_generation; },
};

export const isExempt = (userProfile?: UserProfile | null): boolean => {
  if (!userProfile) return false;
  return !!(userProfile.is_admin || userProfile.use_personal_token || userProfile.subscription_status === 'personal_token');
};

export const isPaidSubscriber = (userProfile?: UserProfile | null): boolean => {
  if (!userProfile) return false;
  if (isExempt(userProfile)) return true;
  const status = userProfile.subscription_status;
  return status === 'weekly' || status === 'monthly' || status === 'semester' || status === 'basic' || status === 'pro' || status === 'premium';
};

/** Live tutorial access — minute pool + credits (see liveTutorialQuota.ts) */
export { hasLiveTutorialAccess } from './liveTutorialQuota';
export {
  evaluateLiveTutorialStart,
  commitLiveTutorialStart,
  getLiveMinutesRemaining,
  getLiveDurationCreditCost,
} from './liveTutorialQuota';

export const checkAICredits = (
  userProfile?: UserProfile | null,
  cost: number = 1,
  appSettings?: AppSettings | null
): { allowed: boolean; balance: number; cost: number; hasCredits?: boolean } => {
  if (!userProfile) {
    return { allowed: false, balance: 0, cost, hasCredits: false };
  }

  // Guard against callers accidentally passing user ID string instead of profile object
  if (typeof userProfile === 'string') {
    throw new Error('[Credits] checkAICredits requires a UserProfile object, not a string UID.');
  }

  if (isExempt(userProfile)) {
    return { allowed: true, balance: Infinity, cost: 0, hasCredits: true };
  }

  // Strict balance resolution: prioritize ai_credits_balance, then ai_credits, fallback to 0
  const balance = typeof userProfile.ai_credits_balance === 'number'
    ? userProfile.ai_credits_balance
    : (typeof (userProfile as any).ai_credits === 'number'
        ? (userProfile as any).ai_credits
        : 0);

  const allowed = balance >= cost;

  return { allowed, balance, cost, hasCredits: allowed };
};

export type DeductCreditsResult = {
  success: boolean;
  balance?: number;
  error?: string;
  /** true when only local cache was updated (no Supabase or offline) */
  localOnly?: boolean;
};

export const deductAICredits = async (
  userId: string,
  cost: number,
  featureName: string,
  appSettings?: AppSettings
): Promise<DeductCreditsResult> => {
  if (!userId || cost <= 0) {
    return { success: true, localOnly: true };
  }

  // Server-authoritative debit when Supabase is configured
  if (isSupabaseConfigured) {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('deduct_user_credits', {
        p_user_id: userId,
        p_amount: cost,
      });

      let updatedBalance: number | null = null;
      let serverOk = false;

      if (!rpcErr && rpcRes?.success) {
        serverOk = true;
        if (typeof rpcRes.remaining_credits === 'number') {
          updatedBalance = rpcRes.remaining_credits;
        }
      } else {
        // Fallback direct update (covers missing/old RPC)
        const { data: profile, error: selectErr } = await supabase
          .from('profiles')
          .select('ai_credits')
          .eq('id', userId)
          .maybeSingle();

        if (selectErr) {
          console.warn('[Credits] Profile select failed:', selectErr);
        }

        if (profile) {
          const currentCredits = profile.ai_credits ?? 0;
          if (currentCredits < cost) {
            return { success: false, error: 'Insufficient credits' };
          }
          const newCredits = Math.max(0, currentCredits - cost);
          const { error: updateErr } = await supabase
            .from('profiles')
            .update({ ai_credits: newCredits, updated_at: new Date().toISOString() })
            .eq('id', userId);
          if (!updateErr) {
            serverOk = true;
            updatedBalance = newCredits;
          } else {
            console.warn('[Credits] Profile update failed:', updateErr);
          }
        }
      }

      if (serverOk) {
        if (typeof updatedBalance === 'number') {
          saveLocalCredits(userId, updatedBalance, 'free').catch(console.warn);
          notifyUserCreditsUpdated(userId, updatedBalance);
        }
        void supabase.from('usage_records').insert({
          user_id: userId,
          feature: featureName,
          credits_spent: cost,
          created_at: new Date().toISOString(),
        });
        return { success: true, balance: updatedBalance ?? undefined };
      }

      const errMsg =
        (rpcErr as any)?.message ||
        (rpcRes && !rpcRes.success ? String(rpcRes.error || 'RPC failed') : 'Supabase credit debit failed');
      console.warn('[Credits] Supabase deduction failed closed:', errMsg);
      return { success: false, error: errMsg };
    } catch (err) {
      console.warn('[Credits] Supabase deduction error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Supabase credit debit error',
      };
    }
  }

  await recordLocalCreditDeduction(userId, cost, featureName).catch(console.warn);
  return { success: false, error: 'Supabase must be configured to deduct credits', localOnly: true };
};
