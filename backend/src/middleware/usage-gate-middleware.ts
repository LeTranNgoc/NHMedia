import type { UsageTracker, UsageKind, Tier } from '../lib/usage-tracker.js';

export interface UsageGateResult {
  allowed: boolean;
  tier: Tier;
  /** null = unlimited; number = seconds remaining */
  secondsRemaining: number | null;
  reason?: 'quota_exceeded' | 'billing_unavailable';
  /** Which kinds have exceeded their cap. Populated when allowed=false. */
  kindExceeded?: UsageKind[];
}

/**
 * WS handshake gate — call BEFORE accepting the WebSocket connection.
 * Free tier: daily check via getToday (unchanged).
 * Paid tiers: monthly check via getMonthSeconds.
 * Returns allowed=false with reason='quota_exceeded' if cap is hit.
 *
 * Fail-closed on DB errors: if tracker.getTier or getMonthSeconds throws
 * (Mongo blip etc.), deny the session with reason='billing_unavailable'.
 * Silent fall-through to 'free' would lock out paid users; silent 0 for
 * monthSeconds would let cap-exhausted users blow past their limit.
 */
export async function checkUsageGate(
  userId: string,
  tracker: UsageTracker,
): Promise<UsageGateResult> {
  let tier: Tier;
  try {
    tier = await tracker.getTier(userId);
  } catch (err) {
    console.error(
      `[usage-gate] getTier DB error for userId=${userId} — fail-closed:`,
      err instanceof Error ? err.message : err,
    );
    return {
      allowed: false,
      tier: 'free',
      secondsRemaining: 0,
      reason: 'billing_unavailable',
    };
  }
  const limits = tracker.getLimit(tier);

  if (tier === 'free') {
    // Free tier: daily check (existing behavior)
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
    return { allowed: true, tier, secondsRemaining };
  }

  // Paid tiers: monthly check
  const cap = limits.seconds;

  // No cap → unlimited (legacy pro behavior preserved)
  if (cap === null) {
    return { allowed: true, tier, secondsRemaining: null };
  }

  let monthSeconds: number;
  try {
    monthSeconds = await tracker.getMonthSeconds(userId);
  } catch (err) {
    console.error(
      `[usage-gate] getMonthSeconds DB error for userId=${userId} — fail-closed:`,
      err instanceof Error ? err.message : err,
    );
    return {
      allowed: false,
      tier,
      secondsRemaining: 0,
      reason: 'billing_unavailable',
    };
  }

  if (monthSeconds >= cap) {
    return {
      allowed: false,
      tier,
      secondsRemaining: 0,
      reason: 'quota_exceeded',
      kindExceeded: ['seconds'],
    };
  }

  return { allowed: true, tier, secondsRemaining: cap - monthSeconds };
}
