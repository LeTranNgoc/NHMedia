import type { Db, ObjectId } from 'mongodb';
import { usageLogCollection } from '../db/models/usage-log.js';
import { subscriptionCollection } from '../db/models/subscription.js';
import { resolveProductIdToTier } from '../billing/tier-resolver.js';

/** Max in-memory accumulator per user per kind: 1 hour of audio / chars. Prevents unbounded growth on DB outage. */
const MAX_IN_MEMORY_SECONDS = 3600;
const MAX_IN_MEMORY_CHARS = 200_000;

/** Fallback defaults — used only when caller does not inject limits via constructor.
 *  Prod deploys MUST pass env values through to UsageTracker so `FREE_TIER_LIMIT_SECONDS=900`
 *  in .env actually takes effect (was the C1 regression). */
const DEFAULT_FREE_TIER_LIMIT_SECONDS = 36000;
const DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS = 50000;
const DEFAULT_FREE_TIER_LIMIT_TTS_CHARS = 50000;

const DEFAULT_STARTER_LIMIT_SECONDS = 18000;
const DEFAULT_STANDARD_LIMIT_SECONDS = 54000;
const DEFAULT_PRO_LIMIT_SECONDS = 144000;
const DEFAULT_UNLIMITED_LIMIT_SECONDS = 720000;

/** @deprecated Pass env-derived limits to UsageTracker constructor instead.
 *  Kept as a re-export so legacy callers compile while migrating. */
export const FREE_TIER_LIMIT_SECONDS = DEFAULT_FREE_TIER_LIMIT_SECONDS;
export const FREE_TIER_LIMIT_TRANSLATE_CHARS = DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS;
export const FREE_TIER_LIMIT_TTS_CHARS = DEFAULT_FREE_TIER_LIMIT_TTS_CHARS;

export type UsageKind = 'seconds' | 'translateChars' | 'ttsChars';
export type Tier = 'free' | 'starter' | 'standard' | 'pro' | 'unlimited';

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
  /** Monthly limit overrides for paid tiers (seconds). */
  starterSeconds?: number;
  standardSeconds?: number;
  proSeconds?: number;
  unlimitedSeconds?: number;
  /** Polar product IDs for tier lookup. */
  productIdStarter?: string;
  productIdStandard?: string;
  productIdPro?: string;
  productIdUnlimited?: string;
}

export class UsageTracker {
  /** userId → per-kind pending delta since last flush */
  private readonly pending = new Map<string, PendingEntry>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly freeTierLimits: UsageLimits;
  private readonly starterLimitSeconds: number;
  private readonly standardLimitSeconds: number;
  private readonly proLimitSeconds: number;
  private readonly unlimitedLimitSeconds: number;
  private readonly productIdStarter: string;
  private readonly productIdStandard: string;
  private readonly productIdPro: string;
  private readonly productIdUnlimited: string;

  constructor(
    private readonly db: Db,
    limits: UsageTrackerLimits = {},
  ) {
    this.freeTierLimits = {
      seconds: limits.seconds ?? DEFAULT_FREE_TIER_LIMIT_SECONDS,
      translateChars: limits.translateChars ?? DEFAULT_FREE_TIER_LIMIT_TRANSLATE_CHARS,
      ttsChars: limits.ttsChars ?? DEFAULT_FREE_TIER_LIMIT_TTS_CHARS,
    };
    this.starterLimitSeconds = limits.starterSeconds ?? DEFAULT_STARTER_LIMIT_SECONDS;
    this.standardLimitSeconds = limits.standardSeconds ?? DEFAULT_STANDARD_LIMIT_SECONDS;
    this.proLimitSeconds = limits.proSeconds ?? DEFAULT_PRO_LIMIT_SECONDS;
    this.unlimitedLimitSeconds = limits.unlimitedSeconds ?? DEFAULT_UNLIMITED_LIMIT_SECONDS;
    this.productIdStarter = limits.productIdStarter ?? '';
    this.productIdStandard = limits.productIdStandard ?? '';
    this.productIdPro = limits.productIdPro ?? '';
    this.productIdUnlimited = limits.productIdUnlimited ?? '';
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
      const hasWork = delta.seconds > 0 || delta.translateChars > 0 || delta.ttsChars > 0;
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
            const existing = this.pending.get(userIdStr) ?? {
              seconds: 0,
              translateChars: 0,
              ttsChars: 0,
            };
            this.pending.set(userIdStr, {
              seconds: Math.min(existing.seconds + delta.seconds, MAX_IN_MEMORY_SECONDS),
              translateChars: Math.min(
                existing.translateChars + delta.translateChars,
                MAX_IN_MEMORY_CHARS,
              ),
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
   * Build the TierProductIds map injected at construction time.
   * Used to share the resolver with the webhook handler (same source of truth).
   */
  private getTierProductIds(): {
    productIdStarter: string;
    productIdStandard: string;
    productIdPro: string;
    productIdUnlimited: string;
  } {
    return {
      productIdStarter: this.productIdStarter,
      productIdStandard: this.productIdStandard,
      productIdPro: this.productIdPro,
      productIdUnlimited: this.productIdUnlimited,
    };
  }

  /**
   * Get the billing tier for a user.
   * Looks up the most-recent subscription (sort createdAt DESC).
   * Resolves tier from polarProductId if present; falls back to stored tier field.
   * Returns paid tier if active or canceled-but-not-yet-expired.
   *
   * Throws on DB errors so callers can fail-closed (deny session) instead of
   * silently downgrading a paid user to 'free' (which locks them out).
   * Caller MUST wrap in try/catch and map to 503/quota_exceeded as appropriate.
   */
  async getTier(userId: string): Promise<Tier> {
    const { ObjectId } = await import('mongodb');
    // Invalid userId format (non-hex) is a caller-side bug, not a DB error.
    // Treat as no-sub → 'free' rather than throwing.
    if (!ObjectId.isValid(userId)) {
      return 'free';
    }
    const col = subscriptionCollection(this.db);
    const sub = await col.findOne({ userId: new ObjectId(userId) }, { sort: { createdAt: -1 } });

    if (!sub) return 'free';

    // Determine if the subscription grants access
    const now = new Date();
    const isActive = sub.status === 'active';
    const isCanceledFuture = sub.status === 'canceled' && sub.endsAt != null && sub.endsAt > now;

    if (!isActive && !isCanceledFuture) return 'free';

    // Active or canceled-future — MUST return a paid tier. Returning 'free'
    // here would be logically contradictory (active sub but no paid quota).
    // Prefer polarProductId mapping (new model); if missing, defer to stored
    // tier, but reject 'free' as a stored value in this branch.
    if (sub.polarProductId) {
      return resolveProductIdToTier(sub.polarProductId, this.getTierProductIds());
    }

    const storedTier = sub.tier as Tier;
    if (storedTier === 'free') {
      // Contradictory state — active sub with tier='free'. Treat as malformed
      // legacy row and fall back to 'pro' (graceful — same as unknown productId).
      console.warn(
        `[usage-tracker] active sub with stored tier='free' — falling back to 'pro' (malformed legacy row, userId=${userId})`,
      );
      return 'pro';
    }
    return storedTier;
  }

  /**
   * Get the cap for a tier.
   * Free tier: daily seconds cap (900s). Paid tiers: monthly seconds cap.
   * Returns null chars for all tiers (chars not metered in current billing model).
   */
  getLimit(tier: Tier): UsageLimits {
    switch (tier) {
      case 'free':
        return this.freeTierLimits;
      case 'starter':
        return { seconds: this.starterLimitSeconds, translateChars: null, ttsChars: null };
      case 'standard':
        return { seconds: this.standardLimitSeconds, translateChars: null, ttsChars: null };
      case 'pro':
        return { seconds: this.proLimitSeconds, translateChars: null, ttsChars: null };
      case 'unlimited':
        return { seconds: this.unlimitedLimitSeconds, translateChars: null, ttsChars: null };
    }
  }

  /**
   * Get total seconds captured for a user in the current UTC calendar month.
   * Aggregates usage_log rows from firstOfMonth to firstOfNextMonth.
   * Adds in-memory pending (unflushed) seconds for today.
   *
   * Throws on DB errors so callers can fail-closed (deny session) instead of
   * silently under-counting and letting paid users blow past their cap.
   * Caller MUST wrap in try/catch and map to 503/quota_exceeded as appropriate.
   */
  async getMonthSeconds(userId: string): Promise<number> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const firstOfNextMonth = new Date(Date.UTC(year, month + 1, 1));

    // Convert date boundaries to YYYY-MM-DD strings for string-range comparison
    const firstOfMonthStr = firstOfMonth.toISOString().slice(0, 10);
    const firstOfNextMonthStr = firstOfNextMonth.toISOString().slice(0, 10);

    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(userId)) {
      return 0;
    }
    const col = usageLogCollection(this.db);
    const result = await col
      .aggregate<{ total: number }>([
        {
          $match: {
            userId: new ObjectId(userId),
            date: { $gte: firstOfMonthStr, $lt: firstOfNextMonthStr },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$secondsCaptured' },
          },
        },
      ])
      .toArray();
    const dbSeconds = result[0]?.total ?? 0;

    const inMemory = this.pending.get(userId)?.seconds ?? 0;
    return dbSeconds + inMemory;
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
