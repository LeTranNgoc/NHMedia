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
  await db.collection('magic_link_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

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

// ── Magic link with extensionId (bridge mode) ─────────────────────────────────
describe('POST /auth/magic-link/request with extensionId', () => {
  it('returns 204 and stores extensionId when allowlist is empty (dev mode)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'ext@example.com', extensionId: 'anyextensionid' },
    });
    expect(res.statusCode).toBe(204);
    expect(mockEmailService.sendMagicLink).toHaveBeenCalledOnce();
    // verify extensionId stored in token doc
    const doc = await db.collection('magic_link_tokens').findOne({ email: 'ext@example.com' });
    expect(doc?.extensionId).toBe('anyextensionid');
  });

  it('returns 403 when extensionId is not in allowlist', async () => {
    // Rebuild app with an explicit allowlist
    const { buildApp: buildAppFresh } = await import('../app.js');
    const restrictedApp = await buildAppFresh({
      db,
      env: { ...TEST_ENV, ALLOWED_EXTENSION_IDS: 'allowedid123' },
      overrides: { emailService: mockEmailService, emailRateLimiter: rateLimiter },
    });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'ext@example.com', extensionId: 'notallowed' },
    });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });
});

describe('GET /auth/magic-link/verify with extensionId (bridge mode)', () => {
  async function seedTokenWithExtension(extensionId: string) {
    const { createHash, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hash,
      email: 'bridge@example.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false,
      createdAt: new Date(),
      extensionId,
    });
    return raw;
  }

  it('returns HTML bridge page (not JSON) when extensionId stored with token', async () => {
    const raw = await seedTokenWithExtension('testextensionid123');
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.body;
    expect(html).toContain('testextensionid123.chromiumapp.org');
    expect(html).toContain('token=');
  });

  it('returns JSON (not HTML) when no extensionId stored', async () => {
    const { createHash, randomBytes } = await import('node:crypto');
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hash,
      email: 'json@example.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${raw}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.json<{ token: string }>();
    expect(typeof body.token).toBe('string');
  });
});

// ── Google OAuth extension flow ───────────────────────────────────────────────
describe('GET /auth/google/extension-start', () => {
  it('returns 400 when extension_id missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/extension-start',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 302 redirect to Google OAuth for any extension in dev mode (empty allowlist)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/extension-start?extension_id=someextensionid',
    });
    // inject does NOT follow redirects — check 302 + Location header
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toContain('accounts.google.com');
    // state param is a signed JWT — verify it decodes to extensionId
    const stateMatch = location.match(/[?&]state=([^&]+)/);
    expect(stateMatch).not.toBeNull();
    const { JwtService } = await import('../auth/jwt-service.js');
    const jwtSvc = new JwtService(TEST_ENV.JWT_SECRET);
    const payload = await jwtSvc.verifyRaw(decodeURIComponent(stateMatch![1]!));
    expect(payload['extensionId']).toBe('someextensionid');
  });

  it('returns 403 when extension_id not in allowlist', async () => {
    const { buildApp: buildAppFresh } = await import('../app.js');
    const restrictedApp = await buildAppFresh({
      db,
      env: { ...TEST_ENV, ALLOWED_EXTENSION_IDS: 'allowedext' },
      overrides: { emailService: mockEmailService, emailRateLimiter: rateLimiter },
    });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'GET',
      url: '/auth/google/extension-start?extension_id=badextension',
    });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });

  it('returns 200 redirect for allowlisted extension_id', async () => {
    const { buildApp: buildAppFresh } = await import('../app.js');
    const allowedApp = await buildAppFresh({
      db,
      env: { ...TEST_ENV, ALLOWED_EXTENSION_IDS: 'goodextension' },
      overrides: { emailService: mockEmailService, emailRateLimiter: rateLimiter },
    });
    await allowedApp.ready();

    const res = await allowedApp.inject({
      method: 'GET',
      url: '/auth/google/extension-start?extension_id=goodextension',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('accounts.google.com');
    await allowedApp.close();
  });
});

describe('GET /auth/google/callback (OAuth code flow)', () => {
  it('returns 400 when code or state missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=somecode',
      // state missing
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when state JWT is invalid/expired', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=somecode&state=not.a.valid.jwt',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('INVALID_STATE');
  });

  it('returns 400 when error param present (user denied OAuth)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('OAUTH_ERROR');
  });

  it('returns 302 to chromiumapp.org when code exchange succeeds', async () => {
    const { JwtService } = await import('../auth/jwt-service.js');

    const jwtSvc = new JwtService(TEST_ENV.JWT_SECRET);
    // State JWT uses userId/email empty stubs — same as the route handler does
    const validState = await jwtSvc.sign(
      {
        extensionId: 'testextid',
        userId: '',
        email: '',
      } as unknown as import('../auth/jwt-service.js').JwtClaims,
      '5m',
    );

    // Mock GoogleOAuthService.exchangeCode to return a user without hitting Google
    const mockGoogleService = {
      verifyIdToken: vi.fn(),
      buildAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
      exchangeCode: vi.fn().mockResolvedValue({
        _id: { toString: () => 'mockuserid' },
        email: 'oauth@example.com',
        name: 'OAuth User',
        picture: null,
        authProviders: ['google'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const { buildApp: buildAppFresh } = await import('../app.js');
    const mockedApp = await buildAppFresh({
      db,
      env: TEST_ENV,
      overrides: {
        emailService: mockEmailService,
        emailRateLimiter: rateLimiter,
        googleOAuthService: mockGoogleService,
      },
    });
    await mockedApp.ready();

    const res = await mockedApp.inject({
      method: 'GET',
      url: `/auth/google/callback?code=mockcode&state=${validState}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('testextid.chromiumapp.org');
    expect(res.headers['location']).toContain('token=');
    await mockedApp.close();
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

// ── WS ticket exchange ────────────────────────────────────────────────────────
describe('POST /auth/ws-ticket', () => {
  async function getJwt(email = 'wsticket@example.com'): Promise<string> {
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
    return res.json<{ token: string }>().token;
  }

  it('returns 401 without Bearer', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/ws-ticket' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a 1h scope:ws ticket with valid Bearer', async () => {
    const jwt = await getJwt();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/ws-ticket',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ticket: string; expiresIn: number }>();
    expect(body.expiresIn).toBe(3600);
    expect(body.ticket.split('.').length).toBe(3); // valid JWS shape

    const { JwtService } = await import('../auth/jwt-service.js');
    const jwtSvc = new JwtService(TEST_ENV.JWT_SECRET);
    const claims = await jwtSvc.verify(body.ticket);
    expect(claims.email).toBe('wsticket@example.com');
    expect(claims.scope).toBe('ws');
  });
});
