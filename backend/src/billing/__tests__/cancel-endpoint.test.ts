/**
 * RED phase — cancel endpoint tests.
 * Tests will FAIL until:
 *   - POST /billing/cancel route exists in billing-routes.ts
 *   - PolarClient.cancelSubscription() is implemented
 *   - SubscriptionService.findByUserId sort DESC is wired into the cancel handler
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { JwtService } from '../../auth/jwt-service.js';
import { UsageTracker } from '../../lib/usage-tracker.js';
import { subscriptionCollection } from '../../db/models/subscription.js';
import type { PolarClient } from '../polar-client.js';

const TEST_SECRET = 'a'.repeat(32);
const WEBHOOK_SECRET = 'webhook-secret-cancel-test-1234';

const TEST_ENV = {
  MONGO_URI: '',
  JWT_SECRET: TEST_SECRET,
  RESEND_API_KEY: 'test_key',
  GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com',
  MAGIC_LINK_BASE_URL: 'http://localhost:3000',
  PORT: '3000',
  NODE_ENV: 'test',
  CORS_ORIGINS: 'chrome-extension://test',
  POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let jwtService: JwtService;
let usageTracker: UsageTracker;

const mockCancelSubscription = vi.fn();

const mockPolarClient = {
  createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://polar.sh/checkout/test' }),
  getCheckoutUrl: vi.fn().mockReturnValue('https://polar.sh/checkout/test'),
  getSubscription: vi.fn().mockResolvedValue({}),
  cancelSubscription: mockCancelSubscription,
} as unknown as PolarClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_cancel_endpoint');

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 });
  await db.collection('magic_link_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('usage_log').createIndex({ userId: 1, date: 1 });
  await db.collection('subscriptions').createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
  await db.collection('webhook_events').createIndex({ key: 1 }, { unique: true });

  TEST_ENV.MONGO_URI = mongod.getUri();
  jwtService = new JwtService(TEST_SECRET);
  usageTracker = new UsageTracker(db);

  app = await buildApp({
    db,
    env: TEST_ENV,
    overrides: {
      emailService: { sendMagicLink: vi.fn() } as never,
      usageTracker,
      polarClient: mockPolarClient,
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('subscriptions').deleteMany({});
  await db.collection('webhook_events').deleteMany({});
  vi.clearAllMocks();
  mockCancelSubscription.mockResolvedValue({
    status: 'canceled',
    endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
});

// ── POST /billing/cancel ──────────────────────────────────────────────────────

describe('POST /billing/cancel', () => {
  it('returns 401 when no auth header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/cancel',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when user has no subscription', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'nosub@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('returns 200 and calls polarClient.cancelSubscription with correct polarSubscriptionId (active sub)', async () => {
    const userId = new ObjectId();
    const token = await jwtService.sign({ userId: userId.toString(), email: 'active@example.com' });
    const polarSubId = 'sub_cancel_active_001';

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: polarSubId,
      tier: 'pro',
      status: 'active',
      startedAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledOnce();
    expect(mockCancelSubscription).toHaveBeenCalledWith(polarSubId);
  });

  it('uses most-recent subscription (sort createdAt DESC) when user has multiple rows', async () => {
    const userId = new ObjectId();
    const token = await jwtService.sign({ userId: userId.toString(), email: 'multi@example.com' });

    // Older subscription (should not be used)
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_old_001',
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-01-01'),
      endsAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    // Newer subscription (most recent — this one should be canceled)
    const newerSubId = 'sub_new_001';
    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: newerSubId,
      tier: 'pro',
      status: 'active',
      startedAt: new Date('2026-04-01'),
      endsAt: null,
      createdAt: new Date('2026-04-01'),
      updatedAt: new Date('2026-04-01'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith(newerSubId);
  });

  it('returns 200 idempotent when subscription is already canceled — does NOT call Polar again', async () => {
    const userId = new ObjectId();
    const token = await jwtService.sign({
      userId: userId.toString(),
      email: 'already@example.com',
    });

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_already_canceled',
      tier: 'pro',
      status: 'canceled',
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/cancel',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // Idempotent — no second Polar call
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });
});
