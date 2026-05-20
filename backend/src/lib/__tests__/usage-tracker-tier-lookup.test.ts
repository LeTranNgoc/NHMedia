/**
 * RED phase — getTier Polar product ID → tier name lookup tests.
 * Tests will FAIL until:
 *   - UsageTracker.getTier() returns 5 tier names (free/starter/standard/pro/unlimited)
 *   - env keys POLAR_PRODUCT_ID_STARTER/STANDARD/PRO/UNLIMITED wired into UsageTracker
 *   - Unknown productId → fallback 'pro' + console.warn (legacy graceful)
 *   - canceled + endsAt future → keep paid tier name (not hardcoded 'pro')
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { UsageTracker } from '../usage-tracker.js';
import { subscriptionCollection } from '../../db/models/subscription.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_tier_lookup');
  await db.collection('subscriptions').createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('subscriptions').deleteMany({});
});

// ── Product ID constants used across all tests ────────────────────────────────

const PRODUCT_IDS = {
  starter: 'prod_starter_lookup_001',
  standard: 'prod_standard_lookup_001',
  pro: 'prod_pro_lookup_001',
  unlimited: 'prod_unlimited_lookup_001',
};

/**
 * Build a UsageTracker with product ID env values injected via constructor.
 * Mirrors how the prod entrypoint wires env.ts → UsageTracker constructor.
 */
function makeTracker(): UsageTracker {
  return new UsageTracker(db, {
    productIdStarter: PRODUCT_IDS.starter,
    productIdStandard: PRODUCT_IDS.standard,
    productIdPro: PRODUCT_IDS.pro,
    productIdUnlimited: PRODUCT_IDS.unlimited,
  } as never);
}

/** Insert an active subscription with a given Polar product ID. */
async function insertActiveSub(
  userId: ObjectId,
  polarSubId: string,
  productId: string,
): Promise<void> {
  await subscriptionCollection(db).insertOne({
    _id: new ObjectId(),
    userId,
    polarSubscriptionId: polarSubId,
    // tier field is the STORED tier — under the new model, webhook handler
    // writes the resolved tier name (not 'pro' hardcoded). Tests below
    // verify getTier re-derives from productId rather than reading stored tier.
    tier: 'pro' as const, // legacy column — getTier overrides via product ID lookup
    status: 'active',
    startedAt: new Date(),
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    polarProductId: productId, // new field written by webhook handler
  } as never);
}

/** Insert a canceled subscription with endsAt. */
async function insertCanceledSub(
  userId: ObjectId,
  polarSubId: string,
  productId: string,
  endsAt: Date,
): Promise<void> {
  await subscriptionCollection(db).insertOne({
    _id: new ObjectId(),
    userId,
    polarSubscriptionId: polarSubId,
    tier: 'pro' as const,
    status: 'canceled',
    startedAt: new Date('2026-01-01'),
    endsAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    polarProductId: productId,
  } as never);
}

// ── User without subscription → 'free' ───────────────────────────────────────

describe('getTier — no subscription', () => {
  it('returns free for user with no subscription row', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId().toString();
    const tier = await tracker.getTier(userId);
    expect(tier).toBe('free');
  });
});

// ── Product ID → tier name (parameterized) ────────────────────────────────────

const PAID_TIER_CASES = [
  { tier: 'starter', productId: PRODUCT_IDS.starter },
  { tier: 'standard', productId: PRODUCT_IDS.standard },
  { tier: 'pro', productId: PRODUCT_IDS.pro },
  { tier: 'unlimited', productId: PRODUCT_IDS.unlimited },
] as const;

describe.each(PAID_TIER_CASES)('getTier — active $tier subscription', ({ tier, productId }) => {
  it(`productId === POLAR_PRODUCT_ID_${tier.toUpperCase()} → returns '${tier}'`, async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    await insertActiveSub(userId, `sub_${tier}_001`, productId);

    const result = await tracker.getTier(userId.toString());
    expect(result).toBe(tier);
  });
});

// ── Unknown productId → fallback 'pro' + log warn ────────────────────────────

describe('getTier — unknown productId (legacy subscription)', () => {
  it('returns fallback tier pro and logs a warn for unrecognized productId', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await insertActiveSub(userId, 'sub_legacy_001', 'prod_old_legacy_id_not_in_env');

    const result = await tracker.getTier(userId.toString());
    expect(result).toBe('pro'); // graceful fallback for legacy subs
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.join(' ')).toMatch(/unknown.*product/i);

    warnSpy.mockRestore();
  });

  it('does NOT throw for unknown productId — returns gracefully', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    await insertActiveSub(userId, 'sub_legacy_no_throw', 'prod_completely_unknown');

    await expect(tracker.getTier(userId.toString())).resolves.not.toThrow();
  });
});

// ── Canceled + endsAt future → keep paid tier ────────────────────────────────

describe('getTier — canceled subscription with future endsAt', () => {
  it.each(PAID_TIER_CASES)(
    'canceled $tier sub with endsAt in future → still returns $tier',
    async ({ tier, productId }) => {
      const tracker = makeTracker();
      const userId = new ObjectId();
      const futureEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days

      await insertCanceledSub(userId, `sub_canceled_future_${tier}`, productId, futureEndsAt);

      const result = await tracker.getTier(userId.toString());
      expect(result).toBe(tier);
    },
  );
});

// ── Canceled + endsAt past → 'free' ──────────────────────────────────────────

describe('getTier — canceled subscription with past endsAt', () => {
  it.each(PAID_TIER_CASES)(
    'canceled $tier sub with endsAt in past → returns free',
    async ({ tier, productId }) => {
      const tracker = makeTracker();
      const userId = new ObjectId();
      const pastEndsAt = new Date(Date.now() - 1000); // 1s ago

      await insertCanceledSub(userId, `sub_canceled_past_${tier}`, productId, pastEndsAt);

      const result = await tracker.getTier(userId.toString());
      expect(result).toBe('free');
    },
  );
});

// ── Sort correctness: createdAt DESC (memory rule) ────────────────────────────

describe('getTier — sort createdAt DESC (picks most recent subscription)', () => {
  it('returns tier of newest active sub when older sub has different tier', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    // Older: starter
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_old_starter',
      tier: 'pro' as const,
      status: 'active',
      startedAt: new Date('2026-01-01'),
      endsAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      polarProductId: PRODUCT_IDS.starter,
    } as never);

    // Newer: unlimited
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_new_unlimited',
      tier: 'pro' as const,
      status: 'active',
      startedAt: new Date('2026-05-01'),
      endsAt: null,
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-01'),
      polarProductId: PRODUCT_IDS.unlimited,
    } as never);

    const result = await tracker.getTier(userId.toString());
    // Must use newest (unlimited), not oldest (starter)
    expect(result).toBe('unlimited');
  });

  it('returns free when newest row is canceled-expired even if older row was active', async () => {
    const tracker = makeTracker();
    const userId = new ObjectId();

    // Older: active standard
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_old_active_standard',
      tier: 'pro' as const,
      status: 'active',
      startedAt: new Date('2026-01-01'),
      endsAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      polarProductId: PRODUCT_IDS.standard,
    } as never);

    // Newer: canceled with past endsAt
    const pastEndsAt = new Date(Date.now() - 2000);
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_new_canceled_expired',
      tier: 'pro' as const,
      status: 'canceled',
      startedAt: new Date('2026-04-01'),
      endsAt: pastEndsAt,
      createdAt: new Date('2026-04-01'),
      updatedAt: new Date('2026-04-01'),
      polarProductId: PRODUCT_IDS.standard,
    } as never);

    const result = await tracker.getTier(userId.toString());
    expect(result).toBe('free');
  });
});
