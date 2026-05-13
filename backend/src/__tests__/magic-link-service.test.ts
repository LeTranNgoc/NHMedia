import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { MagicLinkService } from '../auth/magic-link-service.js';
import { EmailService } from '../auth/email-service.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let svc: MagicLinkService;
let emailSvc: EmailService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test');
  // create indexes that MagicLinkService expects
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 });
  await db.collection('magic_link_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  // clean between tests
  await db.collection('magic_link_tokens').deleteMany({});
  await db.collection('users').deleteMany({});

  emailSvc = {
    sendMagicLink: vi.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;

  svc = new MagicLinkService(db, emailSvc);
});

describe('MagicLinkService.request', () => {
  it('stores hashed token and calls email service', async () => {
    await svc.request('user@example.com');
    const doc = await db.collection('magic_link_tokens').findOne({ email: 'user@example.com' });
    expect(doc).not.toBeNull();
    expect(doc!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc!.used).toBe(false);
    expect(emailSvc.sendMagicLink).toHaveBeenCalledOnce();
  });

  it('never stores raw token in DB', async () => {
    let capturedRaw: string | undefined;
    (emailSvc.sendMagicLink as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_email: string, rawToken: string) => {
        capturedRaw = rawToken;
        return Promise.resolve();
      },
    );
    await svc.request('user2@example.com');
    const doc = await db.collection('magic_link_tokens').findOne({ email: 'user2@example.com' });
    expect(doc!.tokenHash).not.toBe(capturedRaw);
  });

  it('returns 204-style void (no error) even for non-existent email (anti-enumeration)', async () => {
    // just must not throw
    await expect(svc.request('nobody@unknown.tld')).resolves.toBeUndefined();
  });
});

describe('MagicLinkService.verify', () => {
  async function createToken(overrides: Partial<{ expiresAt: Date; used: boolean }> = {}) {
    const { rawToken, hashedToken } = await svc.generateToken();
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hashedToken,
      email: 'user@example.com',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
      used: overrides.used ?? false,
      createdAt: new Date(),
    });
    return rawToken;
  }

  it('returns user on valid token (creates user if not exists)', async () => {
    const raw = await createToken();
    const result = await svc.verify(raw);
    expect(result.email).toBe('user@example.com');
  });

  it('marks token as used after first verify', async () => {
    const raw = await createToken();
    await svc.verify(raw);
    const doc = await db.collection('magic_link_tokens').findOne({ email: 'user@example.com' });
    expect(doc!.used).toBe(true);
  });

  it('throws 401 on second use (single-use)', async () => {
    const raw = await createToken();
    await svc.verify(raw);
    await expect(svc.verify(raw)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 on expired token', async () => {
    const raw = await createToken({ expiresAt: new Date(Date.now() - 16 * 60 * 1000) });
    await expect(svc.verify(raw)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 on wrong token', async () => {
    await createToken();
    await expect(svc.verify('deadbeef'.repeat(8))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 on malformed token (too short)', async () => {
    await expect(svc.verify('short')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('Race condition — simultaneous verify', () => {
  it('only first verify succeeds; second gets 401', async () => {
    // insert token directly
    const { rawToken, hashedToken } = await svc.generateToken();
    await db.collection('magic_link_tokens').insertOne({
      tokenHash: hashedToken,
      email: 'race@example.com',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false,
      createdAt: new Date(),
    });

    const [r1, r2] = await Promise.allSettled([svc.verify(rawToken), svc.verify(rawToken)]);
    const successes = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failures = [r1, r2].filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
});
