/**
 * RED phase — checkout per-tier endpoint tests.
 * Tests will FAIL until:
 *   - POST /billing/checkout accepts { tier: 'starter'|'standard'|'pro'|'unlimited' }
 *   - env keys POLAR_PRODUCT_ID_STARTER/STANDARD/PRO/UNLIMITED wired into polar-client
 *   - PolarClient.createCheckoutSession resolves product ID from tier param
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db, ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { JwtService } from '../../auth/jwt-service.js';
import { UsageTracker } from '../../lib/usage-tracker.js';
import type { PolarClient } from '../polar-client.js';

const TEST_SECRET = 'a'.repeat(32);
const WEBHOOK_SECRET = 'webhook-secret-checkout-tier-1234';

// Product IDs that the endpoint should resolve tier names against
const PRODUCT_IDS = {
  starter: 'prod_starter_test_001',
  standard: 'prod_standard_test_001',
  pro: 'prod_pro_test_001',
  unlimited: 'prod_unlimited_test_001',
};

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
  // New env keys required by the implementation
  POLAR_PRODUCT_ID_STARTER: PRODUCT_IDS.starter,
  POLAR_PRODUCT_ID_STANDARD: PRODUCT_IDS.standard,
  POLAR_PRODUCT_ID_PRO: PRODUCT_IDS.pro,
  POLAR_PRODUCT_ID_UNLIMITED: PRODUCT_IDS.unlimited,
};

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let jwtService: JwtService;
let usageTracker: UsageTracker;

const mockCreateCheckoutSession = vi.fn();

const mockPolarClient = {
  createCheckoutSession: mockCreateCheckoutSession,
  getCheckoutUrl: vi.fn().mockReturnValue('https://polar.sh/checkout/test'),
  getSubscription: vi.fn().mockResolvedValue({}),
  cancelSubscription: vi.fn().mockResolvedValue({ status: 'canceled' }),
} as unknown as PolarClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_checkout_tier');

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
    env: TEST_ENV as never,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateCheckoutSession.mockResolvedValue({ url: 'https://polar.sh/checkout/test123' });
});

// ── POST /billing/checkout — tier param ───────────────────────────────────────

describe('POST /billing/checkout — no auth', () => {
  it('returns 401 when no authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'starter' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /billing/checkout — invalid tier', () => {
  it('returns 400 for tier=invalid', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'bad@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'invalid' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for tier=enterprise (unknown tier)', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'ent@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'enterprise' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when tier is missing from body', async () => {
    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'notier@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// Parameterized: each paid tier resolves the correct product ID
const PAID_TIERS = ['starter', 'standard', 'pro', 'unlimited'] as const;

describe.each(PAID_TIERS)('POST /billing/checkout — tier=%s', (tier) => {
  it(`returns 200 and passes productId for POLAR_PRODUCT_ID_${tier.toUpperCase()} to createCheckoutSession`, async () => {
    const userId = new ObjectId().toString();
    const email = `${tier}@example.com`;
    const token = await jwtService.sign({ userId, email });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('polar.sh');

    // Verify the correct product ID was resolved from the tier name
    expect(mockCreateCheckoutSession).toHaveBeenCalledOnce();
    const callArgs = mockCreateCheckoutSession.mock.calls[0]?.[0] as {
      userId: string;
      customerEmail?: string;
      productId?: string;
    };
    expect(callArgs.productId).toBe(PRODUCT_IDS[tier]);
  });

  it(`returns checkoutUrl from Polar for tier=${tier}`, async () => {
    const expectedUrl = `https://polar.sh/checkout/${tier}-session-abc`;
    mockCreateCheckoutSession.mockResolvedValueOnce({ url: expectedUrl });

    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: `url${tier}@example.com` });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(body.url).toBe(expectedUrl);
  });
});

describe('POST /billing/checkout — Polar API failure', () => {
  it('returns 503 when Polar API throws for a valid tier', async () => {
    mockCreateCheckoutSession.mockRejectedValueOnce(new Error('Polar API timeout'));

    const userId = new ObjectId().toString();
    const token = await jwtService.sign({ userId, email: 'fail@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'starter' },
    });

    expect(res.statusCode).toBe(503);
  });
});
