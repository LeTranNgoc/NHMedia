import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { JwtService } from '../auth/jwt-service.js';
import {
  UsageTracker,
  FREE_TIER_LIMIT_SECONDS,
  FREE_TIER_LIMIT_TRANSLATE_CHARS,
  FREE_TIER_LIMIT_TTS_CHARS,
} from '../lib/usage-tracker.js';
import { subscriptionCollection } from '../db/models/subscription.js';
import type { PolarClient } from '../billing/polar-client.js';

const TEST_SECRET = 'a'.repeat(32);
const WEBHOOK_SECRET = 'webhook-secret-test-1234';

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

function makeSignature(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
}

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let jwtService: JwtService;
let usageTracker: UsageTracker;

const mockPolarClient: PolarClient = {
  createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://polar.sh/checkout/test123' }),
  getCheckoutUrl: vi.fn().mockImplementation((userId: string, email: string) =>
    `https://buy.polar.sh/test-product?customer_external_id=${userId}&customer_email=${encodeURIComponent(email)}`,
  ),
  getSubscription: vi.fn().mockResolvedValue({}),
} as unknown as PolarClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_billing_routes');

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 });
  await db
    .collection('magic_link_tokens')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('usage_log').createIndex({ userId: 1, date: 1 });
  await db
    .collection('subscriptions')
    .createIndex({ polarSubscriptionId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ userId: 1 });
  await db.collection('webhook_events').createIndex({ key: 1 }, { unique: true });
  await db.collection('webhook_events').createIndex({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

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
  await db.collection('usage_log').deleteMany({});
  await db.collection('subscriptions').deleteMany({});
  await db.collection('webhook_events').deleteMany({});
  vi.clearAllMocks();
});

// ── GET /billing/me ──────────────────────────────────────────────────────────

describe('GET /billing/me', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns free tier with 0 usage for a fresh user', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'test@example.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/billing/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      tier: string;
      usageToday: {
        secondsCaptured: number;
        limitSeconds: number;
        percentUsed: number;
        translateChars: number;
        ttsChars: number;
      };
      limits: { seconds: number; translateChars: number; ttsChars: number };
    }>();
    expect(body.tier).toBe('free');
    // Legacy fields
    expect(body.usageToday.secondsCaptured).toBe(0);
    expect(body.usageToday.limitSeconds).toBe(FREE_TIER_LIMIT_SECONDS);
    expect(body.usageToday.percentUsed).toBe(0);
    // New fields
    expect(body.usageToday.translateChars).toBe(0);
    expect(body.usageToday.ttsChars).toBe(0);
    expect(body.limits.seconds).toBe(FREE_TIER_LIMIT_SECONDS);
    expect(body.limits.translateChars).toBe(FREE_TIER_LIMIT_TRANSLATE_CHARS);
    expect(body.limits.ttsChars).toBe(FREE_TIER_LIMIT_TTS_CHARS);
  });

  it('returns pro tier for user with active subscription', async () => {
    const userId = new ObjectId();
    const token = await jwtService.sign({ userId: userId.toString(), email: 'pro@example.com' });

    await subscriptionCollection(db).insertOne({
      _id: new ObjectId(),
      userId,
      polarSubscriptionId: 'sub_pro_test',
      tier: 'pro',
      status: 'active',
      startedAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/billing/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      tier: string;
      usageToday: { limitSeconds: null; percentUsed: null };
      limits: { seconds: null; translateChars: null; ttsChars: null };
    }>();
    expect(body.tier).toBe('pro');
    expect(body.usageToday.limitSeconds).toBeNull();
    expect(body.usageToday.percentUsed).toBeNull();
    expect(body.limits.seconds).toBeNull();
    expect(body.limits.translateChars).toBeNull();
    expect(body.limits.ttsChars).toBeNull();
  });
});

// ── POST /billing/checkout ───────────────────────────────────────────────────

describe('POST /billing/checkout', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'pro' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns Polar checkout URL for authenticated user', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'checkout@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'pro' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(body.url).toBe('https://polar.sh/checkout/test123');
    expect(mockPolarClient.createCheckoutSession).toHaveBeenCalledWith({
      userId,
      customerEmail: 'checkout@example.com',
    });
  });

  it('returns 503 when Polar API is unavailable', async () => {
    vi.mocked(mockPolarClient.createCheckoutSession).mockRejectedValueOnce(
      new Error('Polar API down'),
    );

    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'fail@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'pro' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('returns 400 for invalid tier', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'bad@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'enterprise' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── POST /billing/webhook ────────────────────────────────────────────────────

describe('POST /billing/webhook', () => {
  it('returns 401 for missing signature', async () => {
    const body = JSON.stringify({ type: 'subscription.created', id: 'evt1' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for wrong signature', async () => {
    const body = JSON.stringify({ type: 'subscription.created', id: 'evt2' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'polar-signature': 'wrong-signature-hex',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 and upserts subscription for valid signed event', async () => {
    const userId = new ObjectId().toString();
    const body = JSON.stringify({
      id: 'evt_valid_001',
      type: 'subscription.created',
      data: {
        id: 'sub_webhook_valid',
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        metadata: { userId },
      },
    });

    const sig = makeSignature(body);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'polar-signature': sig,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const doc = await subscriptionCollection(db).findOne({
      polarSubscriptionId: 'sub_webhook_valid',
    });
    expect(doc?.status).toBe('active');
    expect(doc?.tier).toBe('pro');
  });
});

// ── GET /billing/checkout-url ────────────────────────────────────────────────

describe('GET /billing/checkout-url', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/checkout-url' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with url containing userId and email query params for authenticated user', async () => {
    const userId = new ObjectId().toString();
    const email = 'upgrade@example.com';
    const token = await jwtService.sign({ userId, email });

    const res = await app.inject({
      method: 'GET',
      url: '/billing/checkout-url',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain(`customer_external_id=${userId}`);
    expect(body.url).toContain(`customer_email=${encodeURIComponent(email)}`);
    expect(mockPolarClient.getCheckoutUrl).toHaveBeenCalledWith(userId, email);
  });

  it('returns 503 when getCheckoutUrl throws (not configured)', async () => {
    vi.mocked(mockPolarClient.getCheckoutUrl).mockImplementationOnce(() => {
      throw new Error('POLAR_PRO_CHECKOUT_URL is not configured');
    });

    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'noconfig@example.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/billing/checkout-url',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json<{ code: string; message: string }>();
    expect(body.code).toBe('CHECKOUT_NOT_CONFIGURED');
  });
});

// ── GET /billing/usage ───────────────────────────────────────────────────────

describe('GET /billing/usage', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/usage' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 7 days of usage (zeros for new user)', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'usage@example.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/billing/usage?days=7',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ date: string; secondsCaptured: number }>>() ;
    expect(body).toHaveLength(7);
    expect(body.every((d) => d.secondsCaptured === 0)).toBe(true);
  });
});
