import type { Db, ObjectId } from 'mongodb';
import { usageLogCollection } from '../db/models/usage-log.js';
import { SubscriptionService } from '../billing/subscription-service.js';

/** Max in-memory accumulator per user: 1 hour of audio. Prevents unbounded growth on DB outage. */
const MAX_IN_MEMORY_SECONDS = 3600;

/** Daily free tier cap in seconds (15 min). */
export const FREE_TIER_LIMIT_SECONDS = 900;

/** Returns YYYY-MM-DD in UTC for the current day. */
export function utcDateString(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class UsageTracker {
  /** userId (string) → seconds accumulated since last flush */
  private readonly pending = new Map<string, number>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db) {}

  /**
   * Accumulate `seconds` of captured audio for `userId`.
   * Capped at MAX_IN_MEMORY_SECONDS to limit memory on DB outage.
   */
  tick(userId: string, seconds: number): void {
    const current = this.pending.get(userId) ?? 0;
    const next = current + seconds;
    if (next > MAX_IN_MEMORY_SECONDS) {
      console.warn(
        `[usage-tracker] userId=${userId} in-memory accumulator exceeded ${MAX_IN_MEMORY_SECONDS}s — capping`,
      );
      this.pending.set(userId, MAX_IN_MEMORY_SECONDS);
    } else {
      this.pending.set(userId, next);
    }
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
      if (delta <= 0) continue;
      let userId: ObjectId;
      try {
        const { ObjectId } = await import('mongodb');
        userId = new ObjectId(userIdStr);
      } catch {
        console.warn(`[usage-tracker] invalid userId format: ${userIdStr}`);
        continue;
      }

      promises.push(
        col
          .updateOne(
            { userId, date },
            {
              $inc: { secondsCaptured: delta },
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
            // Re-add the delta back to pending on failure — bounded by MAX cap
            const existing = this.pending.get(userIdStr) ?? 0;
            const restored = Math.min(existing + delta, MAX_IN_MEMORY_SECONDS);
            this.pending.set(userIdStr, restored);
          }),
      );
    }

    await Promise.all(promises);
  }

  /**
   * Get total seconds captured today for a user.
   * Combines DB value + current in-memory pending delta.
   */
  async getToday(userId: string): Promise<number> {
    const col = usageLogCollection(this.db);
    const date = utcDateString();

    let dbSeconds = 0;
    try {
      const { ObjectId } = await import('mongodb');
      const doc = await col.findOne({ userId: new ObjectId(userId), date });
      dbSeconds = doc?.secondsCaptured ?? 0;
    } catch (err) {
      console.error('[usage-tracker] getToday DB error:', err instanceof Error ? err.message : err);
    }

    const inMemory = this.pending.get(userId) ?? 0;
    return dbSeconds + inMemory;
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
   * Get the daily cap in seconds for a tier.
   * Returns null for unlimited (pro).
   */
  getLimit(tier: 'free' | 'pro'): number | null {
    return tier === 'free' ? FREE_TIER_LIMIT_SECONDS : null;
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
