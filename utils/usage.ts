import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { AppSettings, UserProfile } from '../types';
import {
  getLocalCredits,
  saveLocalCredits,
  recordLocalCreditDeduction,
} from '../services/creditsStorageService';
import { notifyUserCreditsUpdated } from '../lib/backend';

export const isPaidSubscriber = (userProfile?: UserProfile | null): boolean => {
  if (!userProfile) return false;
  const plan = (userProfile.subscription_plan || '').toLowerCase();
  return plan === 'pro' || plan === 'premium' || plan === 'plus' || Boolean(userProfile.is_subscriber);
};

export const isExempt = (userProfile?: UserProfile | null): boolean => {
  if (!userProfile) return false;
  return Boolean(
    userProfile.is_admin ||
      userProfile.is_super_admin ||
      (userProfile as any).role === 'admin' ||
      (userProfile as any).role === 'super_admin'
  );
};

export const getFeatureCost = (feature: string, appSettings?: AppSettings | null): number => {
  const costs = (appSettings as any)?.feature_costs || {};
  if (typeof costs[feature] === 'number') return costs[feature];
  const defaults: Record<string, number> = {
    chat: 1,
    quiz: 5,
    flashcards: 5,
    visual_solver: 10,
    study_guide: 15,
    live_tutorial_15: 50,
    live_tutorial_30: 90,
    live_tutorial_60: 150,
  };
  return defaults[feature] ?? 1;
};

export const getFeatureModel = (feature: string, appSettings?: AppSettings | null): string => {
  const models = (appSettings as any)?.feature_models || {};
  return models[feature] || (appSettings as any)?.default_model || 'qwen-plus';
};

export {
  getLiveMinutesRemaining,
  evaluateLiveTutorialStart,
  commitLiveTutorialStart,
  hasLiveTutorialAccess,
  getLiveDurationCreditCost,
} from './liveTutorialQuota';

export const checkAICredits = (
  userProfile?: UserProfile | null,
  cost: number = 1,
  appSettings?: AppSettings | null
): { allowed: boolean; balance: number; cost: number } => {
  if (!userProfile) {
    return { allowed: false, balance: 0, cost };
  }

  if (isExempt(userProfile)) {
    return { allowed: true, balance: Infinity, cost: 0 };
  }

  const isSubscriber = isPaidSubscriber(userProfile);

  if (isSubscriber && cost <= 50) {
    return { allowed: true, balance: Infinity, cost: 0 };
  }

  // Strict balance resolution: prioritize ai_credits_balance, then ai_credits, fallback to 0
  const balance = typeof userProfile.ai_credits_balance === 'number'
    ? userProfile.ai_credits_balance
    : (typeof (userProfile as any).ai_credits === 'number'
        ? (userProfile as any).ai_credits
        : 0);

  const allowed = balance >= cost;

  return { allowed, balance, cost };
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

  // Prefer server truth when Supabase is configured, then mirror locally.
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
        // Fallback: direct update (covers missing/old RPC)
        const { data: profile, error: selectErr } = await supabase
          .from('profiles')
          .select('ai_credits')
          .eq('id', userId)
          .maybeSingle();

        if (selectErr) {
          console.warn('[Credits] Profile select failed:', selectErr);
        }

        if (profile) {
          const newCredits = Math.max(0, (profile.ai_credits ?? 50) - cost);
          const { error: updateErr } = await supabase
            .from('profiles')
            .update({ ai_credits: newCredits, updated_at: new Date().toISOString() })
            .eq('id', userId);
          if (!updateErr) {
            serverOk = true;
            updatedBalance = newCredits;
          } else {
            console.warn('[Credits] Profile update failed:', updateErr);
            // Still fall through to local so UX is not frozen offline-ish
          }
        }
      }

      if (typeof updatedBalance === 'number') {
        saveLocalCredits(userId, updatedBalance, 'free').catch(console.warn);
        notifyUserCreditsUpdated(userId, updatedBalance);
      } else if (serverOk) {
        // Server succeeded but did not return balance — still record local delta
        await recordLocalCreditDeduction(userId, cost, featureName).catch(console.warn);
      }

      if (serverOk) {
        void supabase.from('usage_records').insert({
          user_id: userId,
          feature: featureName,
          credits_spent: cost,
          created_at: new Date().toISOString(),
        });
        return { success: true, balance: updatedBalance ?? undefined };
      }

      // Server path failed entirely — keep previous local-first behavior so the user is not stuck
      await recordLocalCreditDeduction(userId, cost, featureName).catch(console.warn);
      const errMsg =
        (rpcErr as any)?.message ||
        (rpcRes && !rpcRes.success ? String(rpcRes.error || 'RPC failed') : 'Supabase credit sync failed');
      console.warn('[Credits] Supabase deduction did not succeed:', errMsg);
      return { success: false, error: errMsg, localOnly: true };
    } catch (err) {
      console.warn('[Credits] Supabase deduction error:', err);
      await recordLocalCreditDeduction(userId, cost, featureName).catch(console.warn);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Supabase credit sync error',
        localOnly: true,
      };
    }
  }

  // No Supabase — local only
  await recordLocalCreditDeduction(userId, cost, featureName).catch(console.warn);
  return { success: true, localOnly: true };
};
