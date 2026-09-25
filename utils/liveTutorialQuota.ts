/**
 * Live tutorial minute pool + payment gate.
 *
 * Users get a fixed allowance of included minutes (monthly or weekly).
 * Starting a lesson either consumes from the pool (no credits) or charges
 * credits when the pool cannot cover the full duration.
 *
 * Credit deduction is performed by the caller (TeachingEngineSessionView)
 * via deductAICredits to avoid circular imports with usage.ts.
 */

import type { UserProfile, AppSettings } from '../types';
import { DEFAULT_USAGE_SETTINGS } from './appSettings';
import { readCachedJson, writeCachedJson } from './cache';
import { supabase } from '../lib/supabaseClient';

export type LiveDurationMinutes = 15 | 30 | 60;

export interface LiveMinutePoolState {
  periodKey: string;
  usedMinutes: number;
  updatedAt: number;
}

export interface LiveTutorialStartDecision {
  allowed: boolean;
  payment: 'included' | 'credits' | 'blocked';
  creditCost: number;
  durationMinutes: LiveDurationMinutes;
  poolAllowance: number;
  poolUsed: number;
  poolRemaining: number;
  reason?:
    | 'allowed_included'
    | 'allowed_credits'
    | 'insufficient_credits'
    | 'locked_free'
    | 'no_profile';
  message: string;
}

function isExempt(userProfile?: UserProfile | null): boolean {
  if (!userProfile) return false;
  return !!(userProfile.is_admin || userProfile.use_personal_token || userProfile.subscription_status === 'personal_token');
}

function isPaidSubscriber(userProfile?: UserProfile | null): boolean {
  if (!userProfile) return false;
  if (isExempt(userProfile)) return true;
  const status = userProfile.subscription_status;
  return status === 'weekly' || status === 'monthly' || status === 'semester' || status === 'basic' || status === 'pro' || status === 'premium';
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function weekKey(d = new Date()): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function storageKey(uid: string): string {
  return `avelut_live_minutes_${uid}`;
}

function resolveTierKey(userProfile?: UserProfile | null): string {
  if (!userProfile) return 'free';
  if (isExempt(userProfile)) return 'monthly';
  const status = (userProfile.subscription_status || 'free').toLowerCase();
  if (status === 'pro' || status === 'premium') return 'monthly';
  if (status === 'basic') return 'weekly';
  if (status === 'weekly' || status === 'monthly' || status === 'semester' || status === 'free') return status;
  return 'free';
}

function getTierConfig(userProfile?: UserProfile | null, appSettings?: AppSettings | null) {
  const tiers = (appSettings?.usage_settings?.tiers || DEFAULT_USAGE_SETTINGS.tiers) as any;
  const key = resolveTierKey(userProfile);
  return tiers[key] || tiers.free || DEFAULT_USAGE_SETTINGS.tiers.free;
}

export function getLiveMinuteAllowance(
  userProfile?: UserProfile | null,
  appSettings?: AppSettings | null
): { allowance: number; period: 'month' | 'week'; periodKey: string } {
  const tier = getTierConfig(userProfile, appSettings);
  const key = resolveTierKey(userProfile);

  if (key === 'weekly' || key === 'basic') {
    const allowance =
      typeof tier.live_tutorial_minutes_pool === 'number'
        ? tier.live_tutorial_minutes_pool
        : typeof tier.live_tutorial_included_minutes === 'number'
          ? tier.live_tutorial_included_minutes
          : 105;
    return { allowance, period: 'week', periodKey: weekKey() };
  }

  const allowance =
    typeof tier.live_tutorial_minutes_pool === 'number'
      ? tier.live_tutorial_minutes_pool
      : typeof tier.live_tutorial_included_minutes === 'number'
        ? tier.live_tutorial_included_minutes
        : key === 'free'
          ? 15
          : 450;

  return { allowance, period: 'month', periodKey: monthKey() };
}

export function getLiveMinutePoolState(userId: string, periodKey: string): LiveMinutePoolState {
  const raw = readCachedJson<LiveMinutePoolState | null>(storageKey(userId), null);
  if (!raw || raw.periodKey !== periodKey) {
    return { periodKey, usedMinutes: 0, updatedAt: Date.now() };
  }
  return raw;
}

export async function fetchLiveMinutePoolFromServer(
  userId: string,
  periodKey: string
): Promise<number> {
  if (!userId) return 0;
  try {
    const { data, error } = await supabase
      .from('live_minute_pools')
      .select('used_minutes')
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .maybeSingle();

    if (error) {
      console.warn('[liveTutorialQuota] fetchLiveMinutePoolFromServer error:', error);
      return getLiveMinutePoolState(userId, periodKey).usedMinutes;
    }

    const usedMinutes = data?.used_minutes ?? 0;
    const nextState: LiveMinutePoolState = {
      periodKey,
      usedMinutes,
      updatedAt: Date.now(),
    };
    writeCachedJson(storageKey(userId), nextState);
    return usedMinutes;
  } catch (err) {
    console.warn('[liveTutorialQuota] fetchLiveMinutePoolFromServer exception:', err);
    return getLiveMinutePoolState(userId, periodKey).usedMinutes;
  }
}

export function getLiveMinutesRemaining(
  userProfile?: UserProfile | null,
  appSettings?: AppSettings | null
): { remaining: number; used: number; allowance: number; period: 'month' | 'week'; periodKey: string } {
  const { allowance, period, periodKey } = getLiveMinuteAllowance(userProfile, appSettings);
  if (!userProfile?.uid) {
    return { remaining: 0, used: 0, allowance, period, periodKey };
  }
  if (isExempt(userProfile)) {
    return { remaining: allowance, used: 0, allowance, period, periodKey };
  }
  const state = getLiveMinutePoolState(userProfile.uid, periodKey);
  const used = Math.max(0, state.usedMinutes || 0);
  const remaining = Math.max(0, allowance - used);
  return { remaining, used, allowance, period, periodKey };
}

export function getLiveDurationCreditCost(
  minutes: LiveDurationMinutes,
  appSettings?: AppSettings | null
): number {
  const costs = (appSettings?.usage_settings?.feature_costs || DEFAULT_USAGE_SETTINGS.feature_costs) as any;
  if (minutes === 15) return costs.live_tutorial_15 ?? costs.live_tutorial ?? 150;
  if (minutes === 30) return costs.live_tutorial_30 ?? 350;
  return costs.live_tutorial_60 ?? 650;
}

export function evaluateLiveTutorialStart(
  userProfile: UserProfile | null | undefined,
  minutes: LiveDurationMinutes,
  appSettings?: AppSettings | null
): LiveTutorialStartDecision {
  if (!userProfile) {
    return {
      allowed: false,
      payment: 'blocked',
      creditCost: 0,
      durationMinutes: minutes,
      poolAllowance: 0,
      poolUsed: 0,
      poolRemaining: 0,
      reason: 'no_profile',
      message: 'Sign in to start a live tutorial.',
    };
  }

  if (isExempt(userProfile)) {
    const pool = getLiveMinutesRemaining(userProfile, appSettings);
    return {
      allowed: true,
      payment: 'included',
      creditCost: 0,
      durationMinutes: minutes,
      poolAllowance: pool.allowance,
      poolUsed: pool.used,
      poolRemaining: pool.remaining,
      reason: 'allowed_included',
      message: 'Admin / personal token — unlimited for testing.',
    };
  }

  const pool = getLiveMinutesRemaining(userProfile, appSettings);
  const creditCost = getLiveDurationCreditCost(minutes, appSettings);
  const balance = userProfile.ai_credits_balance ?? 0;

  // If user has ANY included minutes remaining, allow them to start
  if (pool.remaining > 0) {
    return {
      allowed: true,
      payment: 'included',
      creditCost: 0,
      durationMinutes: minutes,
      poolAllowance: pool.allowance,
      poolUsed: pool.used,
      poolRemaining: pool.remaining,
      reason: 'allowed_included',
      message: `${pool.remaining} live minutes left in your ${pool.period} pool. Billed per actual minute spent.`,
    };
  }

  // If pool is exhausted, allow pay-as-you-go with credits at 10 credits / minute
  if (balance >= 10) {
    return {
      allowed: true,
      payment: 'credits',
      creditCost,
      durationMinutes: minutes,
      poolAllowance: pool.allowance,
      poolUsed: pool.used,
      poolRemaining: pool.remaining,
      reason: 'allowed_credits',
      message: `Pool exhausted. Billed at 10 credits / minute from your balance (${balance} credits available).`,
    };
  }

  if (!isPaidSubscriber(userProfile) && pool.remaining <= 0) {
    return {
      allowed: false,
      payment: 'blocked',
      creditCost,
      durationMinutes: minutes,
      poolAllowance: pool.allowance,
      poolUsed: pool.used,
      poolRemaining: pool.remaining,
      reason: 'locked_free',
      message: `Free trial minutes used up. Upgrade to Pro for 450 monthly live minutes or buy credits (10 credits / min).`,
    };
  }

  return {
    allowed: false,
    payment: 'blocked',
    creditCost,
    durationMinutes: minutes,
    poolAllowance: pool.allowance,
    poolUsed: pool.used,
    poolRemaining: pool.remaining,
    reason: 'insufficient_credits',
    message: `Need at least 10 credits to start a live tutorial (you have ${balance}). Included minutes left: ${pool.remaining}.`,
  };
}

/**
 * Persist actual minute usage to the pool when a session completes or exits.
 * If user spent 4 minutes, p_minutes = 4.
 */
export async function commitActualLiveTutorialMinutes(
  userProfile: UserProfile,
  actualMinutes: number,
  appSettings?: AppSettings | null
): Promise<{ success: boolean; remainingMinutes?: number; error?: string }> {
  if (actualMinutes <= 0 || !userProfile.uid) return { success: true };
  if (isExempt(userProfile)) return { success: true };

  const { periodKey, allowance } = getLiveMinuteAllowance(userProfile, appSettings);
  try {
    const { data, error } = await supabase.rpc('consume_live_tutorial_minutes', {
      p_user_id: userProfile.uid,
      p_period_key: periodKey,
      p_minutes: actualMinutes,
      p_allowance: allowance,
    });

    if (error || data?.success === false) {
      const errMsg = data?.error || error?.message || 'Failed to consume live tutorial minutes';
      console.warn('[liveTutorialQuota] commitActualLiveTutorialMinutes RPC error:', errMsg);
      return { success: false, error: errMsg };
    }

    const remaining = data?.remaining_minutes;
    const nextUsed = Math.max(0, allowance - (typeof remaining === 'number' ? remaining : 0));
    writeCachedJson(storageKey(userProfile.uid), {
      periodKey,
      usedMinutes: nextUsed,
      updatedAt: Date.now(),
    });
    return { success: true, remainingMinutes: remaining };
  } catch (err: any) {
    console.warn('[liveTutorialQuota] commitActualLiveTutorialMinutes exception:', err);
    return { success: false, error: err?.message || 'Exception during minute consumption' };
  }
}

/** Persist included-minute usage. Legacy wrapper for commitActualLiveTutorialMinutes. */
export async function commitLiveTutorialStart(
  userProfile: UserProfile,
  decision: LiveTutorialStartDecision,
  appSettings?: AppSettings | null
): Promise<{ success: boolean; error?: string }> {
  if (!decision.allowed || !userProfile.uid) return { success: false, error: 'Not allowed' };
  if (isExempt(userProfile)) return { success: true };

  if (decision.payment === 'included') {
    return commitActualLiveTutorialMinutes(userProfile, decision.durationMinutes, appSettings);
  }
  return { success: true };
}

export function hasLiveTutorialAccess(
  userProfile?: UserProfile | null,
  appSettings?: AppSettings | null
): { allowed: boolean; reason?: string; remainingMinutes?: number } {
  if (!userProfile) return { allowed: false, reason: 'locked_free', remainingMinutes: 0 };
  if (isExempt(userProfile)) return { allowed: true, reason: 'allowed', remainingMinutes: 9999 };

  const pool = getLiveMinutesRemaining(userProfile, appSettings);
  const balance = userProfile.ai_credits_balance ?? 0;
  const minCredit = getLiveDurationCreditCost(15, appSettings);

  if (pool.remaining >= 15 || balance >= minCredit || isPaidSubscriber(userProfile)) {
    return { allowed: true, reason: 'allowed', remainingMinutes: pool.remaining };
  }

  return { allowed: false, reason: 'locked_free', remainingMinutes: pool.remaining };
}
