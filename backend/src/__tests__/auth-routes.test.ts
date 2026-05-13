import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { EmailService } from '../auth/email-service.js';
import { EmailRateLimiter } from '../lib/email-rate-limiter.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let rateLimiter: EmailRateLimiter;

const TEST_ENV = {
  MONGO_URI: '',
  JWT_SECRET: 'a'.repeat(32),
  RESEND_API_KEY: 'test_resend_key',
  GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com',
  MAGIC_LINK_BASE_URL: 'http://localhost:3000',
  PORT: '3000',
  NODE_ENV: 'test',
  CORS_ORIGINS: 'chrome-extension://test',
};

const mockEmailService = {
  sendMagicLink: vi.fn().mockResolvedValue(undefined),
} as unknown as EmailService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test');

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 });
  await db
    .collection('magic_link_tokens')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  TEST_ENV.MONGO_URI = mongod.getUri();
  rateLimiter = new EmailRateLimiter(5, 60 * 60 * 1000);

  app = await buildApp({
    db,
    env: TEST_ENV,
    overrides: { emailService: mockEmailService, emailRateLimiter: rateLimiter },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('magic_link_tokens').deleteMany({});
  await db.collection('users').deleteMany({});
  vi.clearAllMocks();
  rateLimiter.reset(); // reset rate-limit counters between tests
});

// ── Health ────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with ok:true', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; mongo: string }>();
    expect(body.ok).toBe(true);
    expect(body.mongo).toBe('connected');
  });
});

// ── Magic Link Request ────────────────────────────────────────────────────────
describe('POST /auth/magic-link/request', () => {
  it('returns 204 for valid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(mockEmailService.sendMagicLink).toHaveBeenCalledOnce();
  });

  it('returns 204 for non-existent email (anti-enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'nobody@unknown-domain-xyz.tld' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 429 after 5 requests with same email within an hour', async () => {
    const email = 'ratelimit@example.com';

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/magic-link/request',
        payload: { email },
      });
      expect(res.statusCode).toBe(204);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email },
    });
    expect(sixth.statusCode).toBe(429);
  });
});

// ── Magic Link Verify ─────────────────────────────────────────────────────────
describe('GET /auth/magic-link/verify', () => {
  async function seedToken(
    overrides: Partial<{ expiresAt: Date; used: boolean; email: string }> = {},
  ) {
    const { createHash, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hash,
      email: overrides.email ?? 'verify@example.com',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
      used: overrides.used ?? false,
      createdAt: new Date(),
    });
    return raw;
  }

  it('returns 200 + JWT on valid token', async () => {
    const raw = await seedToken();
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; user: { email: string } }>();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe('verify@example.com');
  });

  it('returns 401 on already-used token', async () => {
    const raw = await seedToken({ used: true });
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on expired token', async () => {
    const raw = await seedToken({ expiresAt: new Date(Date.now() - 16 * 60 * 1000) });
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on wrong token', async () => {
    await seedToken();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/magic-link/verify?token=' + 'deadbeef'.repeat(8),
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────
describe('POST /auth/google/callback', () => {
  it('returns 401 for invalid idToken (google-auth-library rejects non-google tokens)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google/callback',
      payload: { idToken: 'invalid.google.id.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when idToken missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google/callback',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Auth Me ───────────────────────────────────────────────────────────────────
describe('GET /auth/me', () => {
  async function getJwt(email = 'me@example.com'): Promise<string> {
    const { createHash, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hash,
      email,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ token: string }>().token;
  }

  it('returns 401 when no Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + user with valid Bearer', async () => {
    const jwt = await getJwt();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { email: string } }>();
    expect(body.user.email).toBe('me@example.com');
  });

  it('returns 401 with expired JWT', async () => {
    const { JwtService } = await import('../auth/jwt-service.js');
    const jwtSvc = new JwtService(TEST_ENV.JWT_SECRET);
    const expiredToken = await jwtSvc.sign({ userId: 'u1', email: 'x@x.com' }, '-1s');
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
