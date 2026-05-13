import type { UsageTracker } from '../lib/usage-tracker.js';

export interface UsageGateResult {
  allowed: boolean;
  tier: 'free' | 'pro';
  secondsRemaining: number | null;
  reason?: 'quota_exceeded';
}

/**
 * WS handshake gate — call BEFORE accepting the WebSocket connection.
 * Returns allowed=false with reason='quota_exceeded' if a free user has
 * consumed >= 900 seconds today.
 *
 * Pro users always pass. secondsRemaining is null for pro (unlimited).
 */
export async function checkUsageGate(
  userId: string,
  tracker: UsageTracker,
): Promise<UsageGateResult> {
  const tier = await tracker.getTier(userId);
  const limit = tracker.getLimit(tier);

  if (limit === null) {
    // Pro — unlimited
    return { allowed: true, tier, secondsRemaining: null };
  }

  const usedToday = await tracker.getToday(userId);

  if (usedToday >= limit) {
    return {
      allowed: false,
      tier,
      secondsRemaining: 0,
      reason: 'quota_exceeded',
    };
  }

  return {
    allowed: true,
    tier,
    secondsRemaining: limit - usedToday,
  };
}
