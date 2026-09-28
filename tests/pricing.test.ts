import { describe, it, expect } from 'vitest';
import {
  CANONICAL_PRICING,
  DEFAULT_USAGE_SETTINGS,
  resolvePackagePriceNgn,
  resolvePlanPriceNgn,
} from '../utils/appSettings';
import {
  getLiveMinuteAllowance,
  getLiveDurationCreditCost,
  evaluateLiveTutorialStart,
} from '../utils/liveTutorialQuota';
import type { UserProfile } from '../types';

describe('Canonical Launch Pricing Model', () => {
  it('should have exact canonical launch pricing values', () => {
    // FREE PLAN
    expect(CANONICAL_PRICING.free.priceNgn).toBe(0);
    expect(CANONICAL_PRICING.free.liveTutorialMinutes).toBe(15);
    expect(CANONICAL_PRICING.free.aiChatAccess).toBe('limited');

    // PRO PLAN
    expect(CANONICAL_PRICING.pro.priceNgn).toBe(3999);
    expect(CANONICAL_PRICING.pro.liveTutorialMinutes).toBe(180);
    expect(CANONICAL_PRICING.pro.aiChatAccess).toBe('generous');

    // PAY-AS-YOU-GO PACKAGES
    expect(CANONICAL_PRICING.packages.live_tutorial_15.priceNgn).toBe(299);
    expect(CANONICAL_PRICING.packages.live_tutorial_15.durationMinutes).toBe(15);

    expect(CANONICAL_PRICING.packages.live_tutorial_30.priceNgn).toBe(599);
    expect(CANONICAL_PRICING.packages.live_tutorial_30.durationMinutes).toBe(30);

    expect(CANONICAL_PRICING.packages.live_tutorial_60.priceNgn).toBe(1099);
    expect(CANONICAL_PRICING.packages.live_tutorial_60.durationMinutes).toBe(60);
  });

  it('should resolve package and plan prices correctly', () => {
    expect(resolvePackagePriceNgn('live_tutorial_15')).toBe(299);
    expect(resolvePackagePriceNgn('live_tutorial_30')).toBe(599);
    expect(resolvePackagePriceNgn('live_tutorial_60')).toBe(1099);
    expect(resolvePackagePriceNgn('invalid_pkg')).toBeNull();

    expect(resolvePlanPriceNgn('free')).toBe(0);
    expect(resolvePlanPriceNgn('pro')).toBe(3999);
    expect(resolvePlanPriceNgn('monthly')).toBe(3999);
    expect(resolvePlanPriceNgn('invalid_plan')).toBeNull();
  });

  it('should calculate live tutorial minute allowances accurately', () => {
    const freeUser: UserProfile = {
      uid: 'u_free',
      display_name: 'Free Student',
      subscription_status: 'free',
      current_streak: 1,
      last_activity_date: Date.now(),
      notifications_enabled: true,
    };

    const proUser: UserProfile = {
      uid: 'u_pro',
      display_name: 'Pro Student',
      subscription_status: 'pro',
      current_streak: 3,
      last_activity_date: Date.now(),
      notifications_enabled: true,
    };

    const freeAllowance = getLiveMinuteAllowance(freeUser);
    expect(freeAllowance.allowance).toBe(15);
    expect(freeAllowance.period).toBe('month');

    const proAllowance = getLiveMinuteAllowance(proUser);
    expect(proAllowance.allowance).toBe(180);
    expect(proAllowance.period).toBe('month');
  });

  it('should get correct duration credit costs', () => {
    expect(getLiveDurationCreditCost(15)).toBe(299);
    expect(getLiveDurationCreditCost(30)).toBe(599);
    expect(getLiveDurationCreditCost(60)).toBe(1099);
  });

  it('should evaluate start decisions for free and pro users correctly', () => {
    const freeUser: UserProfile = {
      uid: 'u_test_free',
      display_name: 'Free Student',
      subscription_status: 'free',
      current_streak: 1,
      last_activity_date: Date.now(),
      notifications_enabled: true,
      ai_credits_balance: 0,
    };

    // Free user starting with fresh 15 mins
    const decision = evaluateLiveTutorialStart(freeUser, 15);
    expect(decision.allowed).toBe(true);
    expect(decision.payment).toBe('included');
    expect(decision.poolAllowance).toBe(15);
  });
});
