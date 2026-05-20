import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import {
  verifyWebhookSignature,
  WebhookHandler,
  type WebhookEvent,
} from '../billing/webhook-handler.js';
import { subscriptionCollection } from '../db/models/subscription.js';

const TEST_SECRET = 'test-webhook-secret-1234';

function makeSignature(body: string | Buffer, secret = TEST_SECRET): string {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return createHmac('sha256', secret).update(buf).digest('hex');
}

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_webhook');
  await db.collection('subscriptions').createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
  await db.collection('webhook_events').createIndex({ key: 1 }, { unique: true });
  await db
    .collection('webhook_events')
    .createIndex({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('subscriptions').deleteMany({});
  await WebhookHandler.clearProcessedEvents(db);
});

// ── verifyWebhookSignature ───────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    const sig = makeSignature(body);
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it('accepts sha256= prefix format', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    const sig = `sha256=${makeSignature(body)}`;
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    const sig = makeSignature(body);
    const tampered = Buffer.from('{"type":"subscription.created","extra":1}', 'utf8');
    expect(verifyWebhookSignature(tampered, sig, TEST_SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    const sig = makeSignature(body, 'wrong-secret');
    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it('returns false when signature header is missing', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    expect(verifyWebhookSignature(body, undefined, TEST_SECRET)).toBe(false);
  });

  it('returns false for empty signature header', () => {
    const body = Buffer.from('{"type":"subscription.created"}', 'utf8');
    expect(verifyWebhookSignature(body, '', TEST_SECRET)).toBe(false);
  });
});

// ── WebhookHandler.handle ────────────────────────────────────────────────────

function makeHandler() {
  return new WebhookHandler({
    webhookSecret: TEST_SECRET,
    db,
    resolveUserId: (id) => new ObjectId(id),
    productIds: {
      productIdStarter: 'prod_starter_test',
      productIdStandard: 'prod_standard_test',
      productIdPro: 'prod_pro_test',
      productIdUnlimited: 'prod_unlimited_test',
    },
  });
}

describe('WebhookHandler.handle — subscription.created', () => {
  it('inserts a new pro subscription row', async () => {
    const handler = makeHandler();
    const userId = new ObjectId().toString();

    const event: WebhookEvent = {
      id: 'evt_001',
      type: 'subscription.created',
      data: {
        id: 'sub_polar_001',
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: '2026-06-01T00:00:00Z',
        metadata: { userId },
      },
    };

    const result = await handler.handle(event);
    expect(result.status).toBe('processed');

    const doc = await subscriptionCollection(db).findOne({
      polarSubscriptionId: 'sub_polar_001',
    });
    expect(doc).not.toBeNull();
    expect(doc?.tier).toBe('pro');
    expect(doc?.status).toBe('active');
    expect(doc?.userId.toString()).toBe(userId);
  });
});

describe('WebhookHandler.handle — subscription.canceled', () => {
  it('sets status=canceled and endsAt from current_period_end', async () => {
    const handler = makeHandler();
    const userId = new ObjectId().toString();
    const userObjId = new ObjectId(userId);

    // Pre-insert existing active subscription
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId: userObjId,
      polarSubscriptionId: 'sub_polar_002',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-05-01'),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const event: WebhookEvent = {
      id: 'evt_cancel_001',
      type: 'subscription.canceled',
      data: {
        id: 'sub_polar_002',
        status: 'canceled',
        current_period_end: '2026-06-01T00:00:00Z',
        metadata: { userId },
      },
    };

    await handler.handle(event);

    const doc = await subscriptionCollection(db).findOne({
      polarSubscriptionId: 'sub_polar_002',
    });
    expect(doc?.status).toBe('canceled');
    expect(doc?.endsAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('WebhookHandler.handle — idempotency', () => {
  it('processes the same event only once (5 replays = 1 DB row)', async () => {
    const handler = makeHandler();
    const userId = new ObjectId().toString();

    const event: WebhookEvent = {
      id: 'evt_idem_001',
      type: 'subscription.created',
      data: {
        id: 'sub_polar_idem',
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        metadata: { userId },
      },
    };

    // Replay 5 times
    for (let i = 0; i < 5; i++) {
      await handler.handle(event);
    }

    const count = await subscriptionCollection(db).countDocuments({
      polarSubscriptionId: 'sub_polar_idem',
    });
    expect(count).toBe(1);
  });

  it('returns skipped for duplicate event', async () => {
    const handler = makeHandler();
    const userId = new ObjectId().toString();

    const event: WebhookEvent = {
      id: 'evt_skip_001',
      type: 'subscription.created',
      data: {
        id: 'sub_polar_skip',
        status: 'active',
        metadata: { userId },
      },
    };

    const first = await handler.handle(event);
    expect(first.status).toBe('processed');

    const second = await handler.handle(event);
    expect(second.status).toBe('skipped');
  });
});

describe('WebhookHandler.handle — cross-restart idempotency (persisted dedup)', () => {
  it('replaying same event via 3 separate handler instances processes only once', async () => {
    const userId = new ObjectId().toString();

    const event: WebhookEvent = {
      id: 'evt_persist_001',
      type: 'subscription.created',
      data: {
        id: 'sub_persist_001',
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        metadata: { userId },
      },
    };

    // Simulate 3 separate handler instances (e.g. 3 process restarts each replaying the event)
    const handler1 = makeHandler();
    const handler2 = makeHandler();
    const handler3 = makeHandler();

    const r1 = await handler1.handle(event);
    const r2 = await handler2.handle(event);
    const r3 = await handler3.handle(event);

    expect(r1.status).toBe('processed');
    expect(r2.status).toBe('skipped');
    expect(r3.status).toBe('skipped');

    // Only one subscription row created
    const count = await subscriptionCollection(db).countDocuments({
      polarSubscriptionId: 'sub_persist_001',
    });
    expect(count).toBe(1);
  });
});

describe('WebhookHandler.handle — out-of-order canceled before created', () => {
  it('creates subscription with canceled status when no existing record', async () => {
    const handler = makeHandler();
    const userId = new ObjectId().toString();

    const event: WebhookEvent = {
      id: 'evt_ooo_001',
      type: 'subscription.canceled',
      data: {
        id: 'sub_polar_ooo',
        status: 'canceled',
        current_period_end: '2026-06-01T00:00:00Z',
        metadata: { userId },
      },
    };

    await handler.handle(event);

    const doc = await subscriptionCollection(db).findOne({
      polarSubscriptionId: 'sub_polar_ooo',
    });
    expect(doc?.status).toBe('canceled');
  });
});
