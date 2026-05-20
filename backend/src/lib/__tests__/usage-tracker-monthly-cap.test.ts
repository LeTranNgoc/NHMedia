/**
 * RED phase — monthly cap tests for paid tiers.
 * Tests will FAIL until:
 *   - UsageTracker.getLimit() handles 5 tiers (free/starter/standard/pro/unlimited)
 *   - UsageTracker.getMonthSeconds(userId) is implemented
 *   - env keys STARTER/STANDARD/PRO/UNLIMITED_TIER_MONTHLY_LIMIT_SECONDS wired via constructor
 *   - usage-gate-middleware branches on free=daily vs paid=monthly
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { UsageTracker, utcDateString } from '../usage-tracker.js';
import { subscriptionCollection } from '../../db/models/subscription.js';
import { checkUsageGate } from '../../middleware/usage-gate-middleware.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_monthly_cap');
  await db.collection('usage_log').createIndex({ userId: 1, date: 1 });
  await db.collection('subscriptions').createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('usage_log').deleteMany({});
  await db.collection('subscriptions').deleteMany({});
});

// ── Helper ────────────────────────────────────────────────────────────────────

function makeTracker(limitOverrides?: Record<string, number>): UsageTracker {
  return new UsageTracker(db, limitOverrides as never);
}

/** Insert a usage_log row for a specific date with secondsCaptured. */
async function seedUsageLog(userId: ObjectId, date: string, seconds: number): Promise<void> {
  await db
    .collection('usage_log')
    .updateOne(
      { userId, date },
      { $set: { secondsCaptured: seconds, createdAt: new Date() }, $setOnInsert: { userId } },
      { upsert: true },
    );
}

/** Get current UTC month's first day string YYYY-MM-01 */
function firstOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Get a date string N days ago in UTC */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Get previous month YYYY-MM-15 (always different from current month) */
function prevMonthDate(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  d.setUTCDate(15);
  return d.toISOString().slice(0, 10);
}

// ── getLimit — 5-tier shape ───────────────────────────────────────────────────

describe('UsageTracker.getLimit — 5 tiers', () => {
  it('getLimit(free) honors injected freeTierSeconds override (prod default 900)', () => {
    // Constructor default for free seconds is 36000 (dev-friendly 10h, see DEFAULT_FREE_TIER_LIMIT_SECONDS).
    // Prod overrides via FREE_TIER_LIMIT_SECONDS=900 env → injected into constructor.
    // This test exercises the injection path so 900 reaches getLimit.
    const tracker = makeTracker({ seconds: 900 });
    const limits = tracker.getLimit('free');
    expect(limits.seconds).toBe(900);
  });

  it('getLimit(starter) = { seconds: 18000, translateChars: null, ttsChars: null }', () => {
    const tracker = makeTracker();
    const limits = tracker.getLimit('starter');
    expect(limits.seconds).toBe(18000);
    expect(limits.translateChars).toBeNull();
    expect(limits.ttsChars).toBeNull();
  });

  it('getLimit(standard) = { seconds: 54000, translateChars: null, ttsChars: null }', () => {
    const tracker = makeTracker();
    const limits = tracker.getLimit('standard');
    expect(limits.seconds).toBe(54000);
    expect(limits.translateChars).toBeNull();
    expect(limits.ttsChars).toBeNull();
  });

  it('getLimit(pro) = { seconds: 144000, translateChars: null, ttsChars: null }', () => {
    const tracker = makeTracker();
    const limits = tracker.getLimit('pro');
    // New semantic: pro is now 40h cap, NOT unlimited
    expect(limits.seconds).toBe(144000);
    expect(limits.translateChars).toBeNull();
    expect(limits.ttsChars).toBeNull();
  });

  it('getLimit(unlimited) = { seconds: 720000, translateChars: null, ttsChars: null }', () => {
    const tracker = makeTracker();
    const limits = tracker.getLimit('unlimited');
    expect(limits.seconds).toBe(720000);
    expect(limits.translateChars).toBeNull();
    expect(limits.ttsChars).toBeNull();
  });
});

// ── getLimit — env override per tier ─────────────────────────────────────────

describe('UsageTracker.getLimit — env override per paid tier', () => {
  it('honors STARTER_TIER_MONTHLY_LIMIT_SECONDS via constructor injection', () => {
    const tracker = new UsageTracker(db, { starterSeconds: 9999 } as never);
    const limits = tracker.getLimit('starter');
    expect(limits.seconds).toBe(9999);
  });

  it('honors STANDARD_TIER_MONTHLY_LIMIT_SECONDS via constructor injection', () => {
    const tracker = new UsageTracker(db, { standardSeconds: 11111 } as never);
    const limits = tracker.getLimit('standard');
    expect(limits.seconds).toBe(11111);
  });

  it('honors PRO_TIER_MONTHLY_LIMIT_SECONDS via constructor injection', () => {
    const tracker = new UsageTracker(db, { proSeconds: 22222 } as never);
    const limits = tracker.getLimit('pro');
    expect(limits.seconds).toBe(22222);
  });

  it('honors UNLIMITED_TIER_MONTHLY_LIMIT_SECONDS via constructor injection', () => {
    const tracker = new UsageTracker(db, { unlimitedSeconds: 99999 } as never);
    const limits = tracker.getLimit('unlimited');
    expect(limits.seconds).toBe(99999);
  });
});

// ── getMonthSeconds — aggregation ────────────────────────────────────────────

describe('UsageTracker.getMonthSeconds', () => {
  it('returns 0 for a fresh user with no usage_log rows', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId().toString();
    const result = await tracker.getMonthSeconds(userId);
    expect(result).toBe(0);
  });

  it('aggregates seconds from multiple rows within the current UTC calendar month', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    // Two rows in current month
    await seedUsageLog(userId, utcDateString(), 3600);
    await seedUsageLog(userId, firstOfCurrentMonth(), 7200);

    const result = await tracker.getMonthSeconds(userId.toString());
    expect(result).toBe(10800);
  });

  it('ignores rows from a previous month', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    // Current month
    await seedUsageLog(userId, utcDateString(), 5000);
    // Previous month — must be excluded
    await seedUsageLog(userId, prevMonthDate(), 99999);

    const result = await tracker.getMonthSeconds(userId.toString());
    expect(result).toBe(5000);
  });

  it('adds in-memory pending (unflushed) seconds to the DB total', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    // DB: 3000s flushed already
    await seedUsageLog(userId, utcDateString(), 3000);

    // In-memory: 600s not yet flushed
    tracker.tick(userId.toString(), 600);

    const result = await tracker.getMonthSeconds(userId.toString());
    expect(result).toBe(3600);
  });

  it('returns 0 for a user whose usage_log only has rows from previous months', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    await seedUsageLog(userId, prevMonthDate(), 5000);
    await seedUsageLog(userId, daysAgo(40), 3000); // >31 days ago

    const result = await tracker.getMonthSeconds(userId.toString());
    expect(result).toBe(0);
  });

  it("returns only this user's seconds (isolation — other user rows ignored)", async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();
    const otherUserId = new ObjectId();

    await seedUsageLog(userId, utcDateString(), 1000);
    await seedUsageLog(otherUserId, utcDateString(), 99999);

    const result = await tracker.getMonthSeconds(userId.toString());
    expect(result).toBe(1000);
  });
});

// ── usage-gate-middleware — monthly cap per paid tier ─────────────────────────
// Uses in-memory mock tracker (no DB) to test gate branching logic.

type AllTier = 'free' | 'starter' | 'standard' | 'pro' | 'unlimited';

function makeMonthlyCapTracker(opts: {
  tier: AllTier;
  monthSeconds: number;
  todaySeconds?: number;
  limitSeconds: number | null;
}): UsageTracker {
  return {
    getTier: vi.fn().mockResolvedValue(opts.tier),
    getLimit: vi.fn().mockReturnValue({
      seconds: opts.limitSeconds,
      translateChars: null,
      ttsChars: null,
    }),
    getMonthSeconds: vi.fn().mockResolvedValue(opts.monthSeconds),
    getToday: vi.fn().mockResolvedValue({
      seconds: opts.todaySeconds ?? 0,
      translateChars: 0,
      ttsChars: 0,
    }),
    tick: vi.fn(),
    flush: vi.fn(),
  } as unknown as UsageTracker;
}

describe('checkUsageGate — free tier daily cap (unchanged behavior)', () => {
  it('free user 901s today → 429 (quota_exceeded)', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'free',
      monthSeconds: 901,
      todaySeconds: 901,
      limitSeconds: 900,
    });
    const result = await checkUsageGate('user_free_over', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('free user 899s today → allowed', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'free',
      monthSeconds: 899,
      todaySeconds: 899,
      limitSeconds: 900,
    });
    const result = await checkUsageGate('user_free_under', tracker);
    expect(result.allowed).toBe(true);
  });
});

describe('checkUsageGate — starter monthly cap', () => {
  it('starter 18001s this month → 429', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'starter',
      monthSeconds: 18001,
      limitSeconds: 18000,
    });
    const result = await checkUsageGate('user_starter_over', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('starter 17999s this month → allowed', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'starter',
      monthSeconds: 17999,
      limitSeconds: 18000,
    });
    const result = await checkUsageGate('user_starter_under', tracker);
    expect(result.allowed).toBe(true);
  });

  it('starter exactly 18000s → 429 (boundary at cap)', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'starter',
      monthSeconds: 18000,
      limitSeconds: 18000,
    });
    const result = await checkUsageGate('user_starter_exact', tracker);
    expect(result.allowed).toBe(false);
  });
});

describe('checkUsageGate — standard monthly cap', () => {
  it('standard 54001s this month → 429', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'standard',
      monthSeconds: 54001,
      limitSeconds: 54000,
    });
    const result = await checkUsageGate('user_standard_over', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('standard 53999s this month → allowed', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'standard',
      monthSeconds: 53999,
      limitSeconds: 54000,
    });
    const result = await checkUsageGate('user_standard_under', tracker);
    expect(result.allowed).toBe(true);
  });
});

describe('checkUsageGate — pro monthly cap (semantic change: was unlimited, now 40h)', () => {
  it('pro 144001s this month → 429', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'pro',
      monthSeconds: 144001,
      limitSeconds: 144000,
    });
    const result = await checkUsageGate('user_pro_over', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('pro 143999s this month → allowed', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'pro',
      monthSeconds: 143999,
      limitSeconds: 144000,
    });
    const result = await checkUsageGate('user_pro_under', tracker);
    expect(result.allowed).toBe(true);
  });
});

describe('checkUsageGate — unlimited monthly cap', () => {
  it('unlimited 720001s this month → 429', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'unlimited',
      monthSeconds: 720001,
      limitSeconds: 720000,
    });
    const result = await checkUsageGate('user_unlimited_over', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('unlimited 719999s this month → allowed', async () => {
    const tracker = makeMonthlyCapTracker({
      tier: 'unlimited',
      monthSeconds: 719999,
      limitSeconds: 720000,
    });
    const result = await checkUsageGate('user_unlimited_under', tracker);
    expect(result.allowed).toBe(true);
  });
});

// ── Regression: fail-closed on DB error (H2 + H3 review fixes) ────────────────

describe('checkUsageGate — fail-closed on tracker DB error', () => {
  it('H3 regression: getTier throws → returns billing_unavailable + denies', async () => {
    const tracker = {
      getTier: vi.fn().mockRejectedValue(new Error('mongo connection lost')),
      getLimit: vi.fn(),
      getMonthSeconds: vi.fn(),
      getToday: vi.fn(),
      tick: vi.fn(),
      flush: vi.fn(),
    } as unknown as UsageTracker;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await checkUsageGate('user_db_err', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('billing_unavailable');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('H2 regression: getMonthSeconds throws → returns billing_unavailable + denies (paid tier)', async () => {
    const tracker = {
      getTier: vi.fn().mockResolvedValue('pro'),
      getLimit: vi.fn().mockReturnValue({ seconds: 144000, translateChars: null, ttsChars: null }),
      getMonthSeconds: vi.fn().mockRejectedValue(new Error('mongo aggregation failed')),
      getToday: vi.fn(),
      tick: vi.fn(),
      flush: vi.fn(),
    } as unknown as UsageTracker;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await checkUsageGate('user_db_err_paid', tracker);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('billing_unavailable');
    expect(result.tier).toBe('pro');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── Regression: C2 active sub with malformed legacy tier='free' ───────────────

describe('UsageTracker.getTier — C2 regression (active sub + storedTier=free)', () => {
  it('active sub with stored tier=free (no polarProductId) → returns pro + warns', async () => {
    const tracker = makeTracker({
      productIdStarter: 'prod_starter_test',
      productIdStandard: 'prod_standard_test',
      productIdPro: 'prod_pro_test',
      productIdUnlimited: 'prod_unlimited_test',
    } as never);
    const userId = new ObjectId();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_legacy_free_active',
      tier: 'free',
      status: 'active',
      startedAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await tracker.getTier(userId.toString());
    expect(result).toBe('pro');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
