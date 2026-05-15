import type { Db, ObjectId } from 'mongodb';
import { usageLogCollection } from '../db/models/usage-log.js';
import { SubscriptionService } from '../billing/subscription-service.js';

/** Max in-memory accumulator per user per kind: 1 hour of audio / chars. Prevents unbounded growth on DB outage. */
const MAX_IN_MEMORY_SECONDS = 3600;
const MAX_IN_MEMORY_CHARS = 200_000;

/** Fallback defaults — used only when caller does not inject limits via constructor.
 *  Prod deploys MUST pass env values through to UsageTracker so `FREE_TIER_LIMIT_SECONDS=900`
 *  in .env actually takes effect (was the C1 regression). */
const DEFAULT_FREE_TIER_LIMIT_SECONDS = 36000;
const DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS = 50000;
const DEFAULT_FREE_TIER_LIMIT_TTS_CHARS = 50000;

/** @deprecated Pass env-derived limits to UsageTracker constructor instead.
 *  Kept as a re-export so legacy callers compile while migrating. */
export const FREE_TIER_LIMIT_SECONDS = DEFAULT_FREE_TIER_LIMIT_SECONDS;
export const FREE_TIER_LIMIT_TRANSLATE_CHARS = DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS;
export const FREE_TIER_LIMIT_TTS_CHARS = DEFAULT_FREE_TIER_LIMIT_TTS_CHARS;

export type UsageKind = 'seconds' | 'translateChars' | 'ttsChars';

export interface UsageTotals {
  seconds: number;
  translateChars: number;
  ttsChars: number;
}

export interface UsageLimits {
  seconds: number | null;
  translateChars: number | null;
  ttsChars: number | null;
}

/** Returns YYYY-MM-DD in UTC for the current day. */
export function utcDateString(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface PendingEntry {
  seconds: number;
  translateChars: number;
  ttsChars: number;
}

export interface UsageTrackerLimits {
  seconds?: number;
  translateChars?: number;
  ttsChars?: number;
}

export class UsageTracker {
  /** userId → per-kind pending delta since last flush */
  private readonly pending = new Map<string, PendingEntry>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly freeTierLimits: UsageLimits;

  constructor(private readonly db: Db, limits: UsageTrackerLimits = {}) {
    this.freeTierLimits = {
      seconds: limits.seconds ?? DEFAULT_FREE_TIER_LIMIT_SECONDS,
      translateChars: limits.translateChars ?? DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS,
      ttsChars: limits.ttsChars ?? DEFAULT_FREE_TIER_LIMIT_TTS_CHARS,
    };
  }

  /**
   * Accumulate usage for `userId`.
   * @param kind defaults to 'seconds' for backward compatibility with 2-arg callers.
   * Capped at MAX_IN_MEMORY_* to limit memory on DB outage.
   */
  tick(userId: string, amount: number, kind: UsageKind = 'seconds'): void {
    const entry = this.pending.get(userId) ?? { seconds: 0, translateChars: 0, ttsChars: 0 };

    if (kind === 'seconds') {
      const next = entry.seconds + amount;
      if (next > MAX_IN_MEMORY_SECONDS) {
        console.warn(
          `[usage-tracker] userId=${userId} seconds accumulator exceeded ${MAX_IN_MEMORY_SECONDS} — capping`,
        );
        entry.seconds = MAX_IN_MEMORY_SECONDS;
      } else {
        entry.seconds = next;
      }
    } else if (kind === 'translateChars') {
      entry.translateChars = Math.min(entry.translateChars + amount, MAX_IN_MEMORY_CHARS);
    } else {
      entry.ttsChars = Math.min(entry.ttsChars + amount, MAX_IN_MEMORY_CHARS);
    }

    this.pending.set(userId, entry);
  }

  /**
   * Flush all pending in-memory ticks to the DB via $inc.
   * Uses upsert so the document is created if it doesn't exist yet.
   * Clears the pending map entry for each user that was flushed.
   */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const col = usageLogCollection(this.db);
    const date = utcDateString();

    // Snapshot and clear pending before async ops to avoid double-counting
    const snapshot = new Map(this.pending);
    this.pending.clear();

    const promises: Promise<void>[] = [];
    for (const [userIdStr, delta] of snapshot) {
      const hasWork =
        delta.seconds > 0 || delta.translateChars > 0 || delta.ttsChars > 0;
      if (!hasWork) continue;

      let userId: ObjectId;
      try {
        const { ObjectId } = await import('mongodb');
        userId = new ObjectId(userIdStr);
      } catch {
        console.warn(`[usage-tracker] invalid userId format: ${userIdStr}`);
        continue;
      }

      const incPayload: Record<string, number> = {};
      if (delta.seconds > 0) incPayload['secondsCaptured'] = delta.seconds;
      if (delta.translateChars > 0) incPayload['translateCharsToday'] = delta.translateChars;
      if (delta.ttsChars > 0) incPayload['ttsCharsToday'] = delta.ttsChars;

      promises.push(
        col
          .updateOne(
            { userId, date },
            {
              $inc: incPayload,
              $setOnInsert: { userId, date, createdAt: new Date() },
            },
            { upsert: true },
          )
          .then(() => undefined)
          .catch((err: unknown) => {
            console.error(
              `[usage-tracker] flush DB error for userId=${userIdStr}:`,
              err instanceof Error ? err.message : err,
            );
            // Re-add the delta back to pending on failure — bounded by MAX caps
            const existing = this.pending.get(userIdStr) ?? { seconds: 0, translateChars: 0, ttsChars: 0 };
            this.pending.set(userIdStr, {
              seconds: Math.min(existing.seconds + delta.seconds, MAX_IN_MEMORY_SECONDS),
              translateChars: Math.min(existing.translateChars + delta.translateChars, MAX_IN_MEMORY_CHARS),
              ttsChars: Math.min(existing.ttsChars + delta.ttsChars, MAX_IN_MEMORY_CHARS),
            });
          }),
      );
    }

    await Promise.all(promises);
  }

  /**
   * Get total usage today for a user — all three kinds.
   * Combines DB values + current in-memory pending deltas.
   * Old DB docs missing translateCharsToday/ttsCharsToday are treated as 0.
   */
  async getToday(userId: string): Promise<UsageTotals> {
    const col = usageLogCollection(this.db);
    const date = utcDateString();

    let dbSeconds = 0;
    let dbTranslateChars = 0;
    let dbTtsChars = 0;

    try {
      const { ObjectId } = await import('mongodb');
      const doc = await col.findOne({ userId: new ObjectId(userId), date });
      dbSeconds = doc?.secondsCaptured ?? 0;
      dbTranslateChars = doc?.translateCharsToday ?? 0;
      dbTtsChars = doc?.ttsCharsToday ?? 0;
    } catch (err) {
      console.error('[usage-tracker] getToday DB error:', err instanceof Error ? err.message : err);
    }

    const inMemory = this.pending.get(userId) ?? { seconds: 0, translateChars: 0, ttsChars: 0 };
    return {
      seconds: dbSeconds + inMemory.seconds,
      translateChars: dbTranslateChars + inMemory.translateChars,
      ttsChars: dbTtsChars + inMemory.ttsChars,
    };
  }

  /**
   * Get the billing tier for a user.
   * Routes through SubscriptionService.findByUserId which sorts by createdAt DESC,
   * ensuring a user with upgrade→cancel→resub history gets the most-recent row.
   * Returns 'pro' only if:
   *   - status === 'active', OR
   *   - status === 'canceled' but endsAt is in the future (still active until period end)
   */
  async getTier(userId: string): Promise<'free' | 'pro'> {
    try {
      const { ObjectId } = await import('mongodb');
      const subscriptionService = new SubscriptionService(this.db);
      const sub = await subscriptionService.findByUserId(new ObjectId(userId));

      if (!sub) return 'free';
      if (sub.status === 'active') return 'pro';
      if (sub.status === 'canceled' && sub.endsAt && sub.endsAt > new Date()) return 'pro';
    } catch (err) {
      console.error('[usage-tracker] getTier error:', err instanceof Error ? err.message : err);
    }
    return 'free';
  }

  /**
   * Get the daily caps for a tier.
   * Returns null for each kind that is unlimited (pro tier).
   */
  getLimit(tier: 'free' | 'pro'): UsageLimits {
    if (tier === 'pro') {
      return { seconds: null, translateChars: null, ttsChars: null };
    }
    return this.freeTierLimits;
  }

  /**
   * Start the 30-second background flush interval.
   * Call once at app startup.
   */
  startFlushInterval(intervalMs = 30_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  /** Stop the flush interval. Call during graceful shutdown. */
  stopFlushInterval(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
