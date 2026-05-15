import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { WebhookHandler, verifyWebhookSignature } from '../webhook-handler.js';
import { subscriptionCollection } from '../../db/models/subscription.js';

const WEBHOOK_SECRET = 'test-webhook-secret-32-chars-long!!';
const PRO_PRODUCT_ID = 'prod_pro_test_123';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_webhook_pro_flow');

  await db.collection('subscriptions').createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
  await db.collection('webhook_events').createIndex({ key: 1 }, { unique: true });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('subscriptions').deleteMany({});
  await WebhookHandler.clearProcessedEvents(db);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandler(): WebhookHandler {
  return new WebhookHandler({
    webhookSecret: WEBHOOK_SECRET,
    db,
    resolveUserId: (id) => new ObjectId(id),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Pro subscription webhook flow', () => {
  it('subscription.created with Pro productId → upserts tier=pro in DB', async () => {
    const userId = new ObjectId().toString();
    const handler = makeHandler();

    const result = await handler.handle({
      id: 'evt_pro_001',
      type: 'subscription.created',
      data: {
        id: 'sub_pro_001',
        product_id: PRO_PRODUCT_ID,
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: '2026-06-01T00:00:00Z',
        metadata: { userId },
      },
    });

    expect(result.status).toBe('processed');

    const doc = await subscriptionCollection(db).findOne({ polarSubscriptionId: 'sub_pro_001' });
    expect(doc).not.toBeNull();
    expect(doc?.tier).toBe('pro');
    expect(doc?.status).toBe('active');
    expect(doc?.userId.toString()).toBe(userId);
  });

  it('HMAC verify: matching signature returns true, mismatched returns false', () => {
    const body = Buffer.from(
      JSON.stringify({ type: 'subscription.created', id: 'evt_hmac_test' }),
    );
    const validSig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    expect(verifyWebhookSignature(body, validSig, WEBHOOK_SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, 'deadbeef'.repeat(8), WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${validSig}`, WEBHOOK_SECRET)).toBe(true);
  });

  it('duplicate event_id → idempotent: second call returns skipped, no double upsert', async () => {
    const userId = new ObjectId().toString();
    const handler = makeHandler();
    const event = {
      id: 'evt_pro_dup_001',
      type: 'subscription.created' as const,
      data: {
        id: 'sub_pro_dup_001',
        product_id: PRO_PRODUCT_ID,
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        metadata: { userId },
      },
    };

    const first = await handler.handle(event);
    const second = await handler.handle(event);

    expect(first.status).toBe('processed');
    expect(second.status).toBe('skipped');

    const count = await db.collection('subscriptions').countDocuments();
    expect(count).toBe(1);
  });

  it('subscription.canceled → tier stays pro, status=canceled', async () => {
    const userId = new ObjectId();
    // Pre-insert an active subscription
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_pro_cancel_001',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-05-01'),
      endsAt: new Date('2026-06-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = makeHandler();
    const result = await handler.handle({
      id: 'evt_cancel_001',
      type: 'subscription.canceled',
      data: {
        id: 'sub_pro_cancel_001',
        product_id: PRO_PRODUCT_ID,
        status: 'canceled',
        current_period_end: '2026-06-01T00:00:00Z',
      },
    });

    expect(result.status).toBe('processed');
    const doc = await subscriptionCollection(db).findOne({ polarSubscriptionId: 'sub_pro_cancel_001' });
    expect(doc?.status).toBe('canceled');
    // tier preserved (cancelation doesn't change tier — access reverts at period end)
    expect(doc?.tier).toBe('pro');
  });

  it('subscription.created missing metadata.userId → skipped without DB write', async () => {
    const handler = makeHandler();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await handler.handle({
      id: 'evt_no_user_001',
      type: 'subscription.created',
      data: {
        id: 'sub_no_user_001',
        product_id: PRO_PRODUCT_ID,
        status: 'active',
        // no metadata.userId
      },
    });

    // Handler processes the event (dedup claimed) but skips DB write internally
    expect(result.status).toBe('processed');
    const count = await db.collection('subscriptions').countDocuments();
    expect(count).toBe(0);

    consoleSpy.mockRestore();
  });
});
