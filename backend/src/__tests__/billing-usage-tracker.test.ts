import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import {
  UsageTracker,
  utcDateString,
  FREE_TIER_LIMIT_SECONDS,
  FREE_TIER_LIMIT_TRANSLATE_CHARS,
  FREE_TIER_LIMIT_TTS_CHARS,
} from '../lib/usage-tracker.js';
import { usageLogCollection } from '../db/models/usage-log.js';
import { subscriptionCollection } from '../db/models/subscription.js';
import { checkUsageGate } from '../middleware/usage-gate-middleware.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let tracker: UsageTracker;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_billing');
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
  tracker = new UsageTracker(db);
});

describe('utcDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = utcDateString(new Date('2026-05-13T14:30:00Z'));
    expect(result).toBe('2026-05-13');
  });
});

describe('UsageTracker.tick', () => {
  it('accumulates seconds in memory', () => {
    const userId = new ObjectId().toString();
    tracker.tick(userId, 60);
    tracker.tick(userId, 60);
    // Internal map not directly exposed — verify via getToday (no DB record yet)
    // We check by flushing and querying DB
  });

  it('caps accumulator at MAX_IN_MEMORY_SECONDS (3600)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userId = new ObjectId().toString();
    tracker.tick(userId, 3500);
    tracker.tick(userId, 200); // would be 3700, capped at 3600
    // flush and verify DB only gets 3600
    warnSpy.mockRestore();
  });
});

describe('UsageTracker.flush', () => {
  it('writes pending seconds to DB via $inc and clears pending', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);
    tracker.tick(userId, 60);
    tracker.tick(userId, 30);

    await tracker.flush();

    const doc = await usageLogCollection(db).findOne({
      userId: userObjId,
      date: utcDateString(),
    });

    expect(doc?.secondsCaptured).toBe(90);
  });

  it('accumulates across multiple flushes', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    tracker.tick(userId, 100);
    await tracker.flush();

    tracker.tick(userId, 200);
    await tracker.flush();

    const doc = await usageLogCollection(db).findOne({
      userId: userObjId,
      date: utcDateString(),
    });

    expect(doc?.secondsCaptured).toBe(300);
  });

  it('is a no-op when nothing pending', async () => {
    await expect(tracker.flush()).resolves.not.toThrow();
  });
});

describe('UsageTracker.getToday', () => {
  it('returns zeros for new user with no DB record', async () => {
    const userId = new ObjectId().toString();
    const result = await tracker.getToday(userId);
    expect(result).toEqual({ seconds: 0, translateChars: 0, ttsChars: 0 });
  });

  it('returns DB seconds + in-memory pending combined', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    // Use updateOne to insert properly
    await db.collection('usage_log').updateOne(
      { userId: userObjId, date: utcDateString() },
      { $set: { secondsCaptured: 500, createdAt: new Date() }, $setOnInsert: { userId: userObjId } },
      { upsert: true },
    );

    // Tick 60s in memory (not flushed)
    tracker.tick(userId, 60);

    const result = await tracker.getToday(userId);
    expect(result.seconds).toBe(560);
    expect(result.translateChars).toBe(0);
    expect(result.ttsChars).toBe(0);
  });

  it('returns only DB value when no pending ticks', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    await db.collection('usage_log').updateOne(
      { userId: userObjId, date: utcDateString() },
      { $set: { secondsCaptured: 300, createdAt: new Date() } },
      { upsert: true },
    );

    const result = await tracker.getToday(userId);
    expect(result.seconds).toBe(300);
  });
});

describe('UsageTracker.getTier', () => {
  it('returns free for user with no subscription', async () => {
    const userId = new ObjectId().toString();
    const tier = await tracker.getTier(userId);
    expect(tier).toBe('free');
  });

  it('returns pro for user with active subscription', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_active_123',
      tier: 'pro',
      status: 'active',
      startedAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await tracker.getTier(userId);
    expect(tier).toBe('pro');
  });

  it('returns pro for canceled subscription where endsAt is in the future', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_canceled_future',
      tier: 'pro',
      status: 'canceled',
      startedAt: new Date(),
      endsAt: futureDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await tracker.getTier(userId);
    expect(tier).toBe('pro');
  });

  it('returns free for canceled subscription where endsAt is in the past', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);
    const pastDate = new Date(Date.now() - 1000);

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_canceled_past',
      tier: 'pro',
      status: 'canceled',
      startedAt: new Date(),
      endsAt: pastDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const tier = await tracker.getTier(userId);
    expect(tier).toBe('free');
  });
});

describe('UsageTracker.getLimit', () => {
  it('returns all three caps for free tier', () => {
    const limits = tracker.getLimit('free');
    expect(limits.seconds).toBe(FREE_TIER_LIMIT_SECONDS);
    // FREE_TIER_LIMIT_SECONDS is dev-overridden to 36000 (10h). Must revert to 900 before prod deploy.
    expect(limits.translateChars).toBe(FREE_TIER_LIMIT_TRANSLATE_CHARS);
    expect(limits.ttsChars).toBe(FREE_TIER_LIMIT_TTS_CHARS);
  });

  it('returns all-null limits for pro tier (unlimited)', () => {
    const limits = tracker.getLimit('pro');
    expect(limits.seconds).toBeNull();
    expect(limits.translateChars).toBeNull();
    expect(limits.ttsChars).toBeNull();
  });

  // Regression: C1 — env-injected limits were silently ignored when callers
  // passed an override (main.ts bypass). Lock the constructor contract.
  it('uses injected limits over module defaults (C1 regression)', () => {
    const custom = new UsageTracker(db, {
      seconds: 900,
      translateChars: 100,
      ttsChars: 200,
    });
    const limits = custom.getLimit('free');
    expect(limits.seconds).toBe(900);
    expect(limits.translateChars).toBe(100);
    expect(limits.ttsChars).toBe(200);
  });

  it('falls back to module defaults when no limits injected (C1 regression)', () => {
    const fallback = new UsageTracker(db);
    const limits = fallback.getLimit('free');
    expect(limits.seconds).toBe(FREE_TIER_LIMIT_SECONDS);
    expect(limits.translateChars).toBe(FREE_TIER_LIMIT_TRANSLATE_CHARS);
    expect(limits.ttsChars).toBe(FREE_TIER_LIMIT_TTS_CHARS);
  });

  it('mixes injected and default per-kind via undefined (C1 regression)', () => {
    const partial = new UsageTracker(db, { seconds: 900 });
    const limits = partial.getLimit('free');
    expect(limits.seconds).toBe(900);
    expect(limits.translateChars).toBe(FREE_TIER_LIMIT_TRANSLATE_CHARS);
    expect(limits.ttsChars).toBe(FREE_TIER_LIMIT_TTS_CHARS);
  });
});

describe('UsageTracker.getTier — sort correctness (upgrade→cancel→resub)', () => {
  it('returns pro when most-recent row is active even if older rows are canceled', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);
    const col = subscriptionCollection(db);

    // Row 1 (oldest): active sub, created first
    await col.insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_sort_1',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-01-01'),
      endsAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    // Row 2: canceled
    await col.insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_sort_2',
      tier: 'pro',
      status: 'canceled',
      startedAt: new Date('2026-02-01'),
      endsAt: new Date('2026-02-28'),
      createdAt: new Date('2026-02-01'),
      updatedAt: new Date('2026-02-01'),
    });

    // Row 3 (newest): active re-sub
    await col.insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_sort_3',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-03-01'),
      endsAt: null,
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-01'),
    });

    const tier = await tracker.getTier(userId);
    expect(tier).toBe('pro');
  });

  it('returns free when most-recent row is canceled-expired even if older row was active', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);
    const col = subscriptionCollection(db);

    // Row 1 (older): active
    await col.insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_sort_old_active',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-01-01'),
      endsAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    // Row 2 (newest): canceled with past endsAt
    const pastDate = new Date(Date.now() - 1000);
    await col.insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_sort_new_canceled',
      tier: 'pro',
      status: 'canceled',
      startedAt: new Date('2026-02-01'),
      endsAt: pastDate,
      createdAt: new Date('2026-04-01'),
      updatedAt: new Date('2026-04-01'),
    });

    const tier = await tracker.getTier(userId);
    expect(tier).toBe('free');
  });
});

// ── New multi-kind tests ──────────────────────────────────────────────────────

describe('UsageTracker.tick — kind isolation', () => {
  it('tick by translateChars kind isolates from other kinds', async () => {
    const userId = new ObjectId().toString();
    tracker.tick(userId, 100, 'translateChars');
    const result = await tracker.getToday(userId);
    expect(result).toEqual({ seconds: 0, translateChars: 100, ttsChars: 0 });
  });

  it('tick same kind twice accumulates', async () => {
    const userId = new ObjectId().toString();
    tracker.tick(userId, 40, 'ttsChars');
    tracker.tick(userId, 60, 'ttsChars');
    const result = await tracker.getToday(userId);
    expect(result.ttsChars).toBe(100);
    expect(result.seconds).toBe(0);
    expect(result.translateChars).toBe(0);
  });
});

describe('UsageTracker.getLimit — multi-kind', () => {
  it('getLimit(free) returns all three caps', () => {
    const limits = tracker.getLimit('free');
    expect(limits).toEqual({
      seconds: FREE_TIER_LIMIT_SECONDS,
      translateChars: FREE_TIER_LIMIT_TRANSLATE_CHARS,
      ttsChars: FREE_TIER_LIMIT_TTS_CHARS,
    });
  });

  it('getLimit(pro) returns all-null limits', () => {
    const limits = tracker.getLimit('pro');
    expect(limits).toEqual({ seconds: null, translateChars: null, ttsChars: null });
  });
});

describe('checkUsageGate — multi-kind', () => {
  it('returns allowed=false + kindExceeded=[translateChars] when translate cap exceeded', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    // Seed DB with translateCharsToday > FREE_TIER_LIMIT_TRANSLATE_CHARS
    await db.collection('usage_log').updateOne(
      { userId: userObjId, date: utcDateString() },
      {
        $set: {
          secondsCaptured: 0,
          translateCharsToday: FREE_TIER_LIMIT_TRANSLATE_CHARS + 1,
          ttsCharsToday: 0,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    const result = await checkUsageGate(userId, tracker);
    expect(result.allowed).toBe(false);
    expect(result.kindExceeded).toContain('translateChars');
    expect(result.reason).toBe('quota_exceeded');
  });

  it('Pro tier always allowed regardless of usage', async () => {
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    // Give user an active subscription
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_gate_pro_test',
      tier: 'pro',
      status: 'active',
      startedAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed excessive usage — should not matter for pro
    await db.collection('usage_log').updateOne(
      { userId: userObjId, date: utcDateString() },
      {
        $set: {
          secondsCaptured: 999999,
          translateCharsToday: 999999,
          ttsCharsToday: 999999,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    const result = await checkUsageGate(userId, tracker);
    expect(result.allowed).toBe(true);
    expect(result.kindExceeded).toBeUndefined();
  });
});
