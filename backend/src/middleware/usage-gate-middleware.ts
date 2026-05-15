import type { UsageTracker, UsageKind } from '../lib/usage-tracker.js';

export interface UsageGateResult {
  allowed: boolean;
  tier: 'free' | 'pro';
  /** null = unlimited (pro); number = seconds/chars remaining for that kind */
  secondsRemaining: number | null;
  reason?: 'quota_exceeded';
  /** Which kinds have exceeded their cap. Populated when allowed=false. */
  kindExceeded?: UsageKind[];
}

/**
 * WS handshake gate — call BEFORE accepting the WebSocket connection.
 * Checks all three usage kinds (seconds, translateChars, ttsChars) independently.
 * Returns allowed=false with reason='quota_exceeded' + kindExceeded list if any cap is hit.
 *
 * Pro users always pass. secondsRemaining is null for pro (unlimited).
 */
export async function checkUsageGate(
  userId: string,
  tracker: UsageTracker,
): Promise<UsageGateResult> {
  const tier = await tracker.getTier(userId);
  const limits = tracker.getLimit(tier);

  // Pro — all limits are null → unlimited
  if (limits.seconds === null && limits.translateChars === null && limits.ttsChars === null) {
    return { allowed: true, tier, secondsRemaining: null };
  }

  const usage = await tracker.getToday(userId);

  const exceeded: UsageKind[] = [];

  if (limits.seconds !== null && usage.seconds >= limits.seconds) {
    exceeded.push('seconds');
  }
  if (limits.translateChars !== null && usage.translateChars >= limits.translateChars) {
    exceeded.push('translateChars');
  }
  if (limits.ttsChars !== null && usage.ttsChars >= limits.ttsChars) {
    exceeded.push('ttsChars');
  }

  if (exceeded.length > 0) {
    return {
      allowed: false,
      tier,
      secondsRemaining: 0,
      reason: 'quota_exceeded',
      kindExceeded: exceeded,
    };
  }

  const secondsRemaining = limits.seconds !== null ? limits.seconds - usage.seconds : null;

  return {
    allowed: true,
    tier,
    secondsRemaining,
  };
}
