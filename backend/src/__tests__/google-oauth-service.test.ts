import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { GoogleOAuthService } from '../auth/google-oauth-service.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let svc: GoogleOAuthService;

const MOCK_CLIENT_ID = 'mock-client-id.apps.googleusercontent.com';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test');
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.collection('users').deleteMany({});
  svc = new GoogleOAuthService(db, MOCK_CLIENT_ID);
});

describe('GoogleOAuthService.verifyIdToken', () => {
  it('creates user on first login and returns user doc', async () => {
    vi.spyOn(svc, 'verifyIdToken').mockResolvedValueOnce({
      _id: expect.any(Object) as unknown as import('mongodb').ObjectId,
      email: 'google@example.com',
      name: 'Google User',
      picture: 'https://example.com/pic.jpg',
      authProviders: ['google'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await svc.verifyIdToken('valid.id.token');
    expect(user.email).toBe('google@example.com');
  });

  it('upserts existing user on re-login', async () => {
    // pre-insert user
    await db.collection('users').insertOne({
      email: 'existing@example.com',
      name: 'Existing User',
      picture: null,
      authProviders: ['google'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.spyOn(svc, 'verifyIdToken').mockResolvedValueOnce({
      _id: expect.any(Object) as unknown as import('mongodb').ObjectId,
      email: 'existing@example.com',
      name: 'Existing User',
      picture: 'https://example.com/new-pic.jpg',
      authProviders: ['google'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await svc.verifyIdToken('valid.id.token.2');
    expect(user.email).toBe('existing@example.com');
    const count = await db.collection('users').countDocuments({ email: 'existing@example.com' });
    expect(count).toBe(1); // no duplicate
  });

  it('throws 401 on invalid/expired idToken', async () => {
    vi.spyOn(svc, 'verifyIdToken').mockRejectedValueOnce(
      Object.assign(new Error('Token expired'), { statusCode: 401 }),
    );
    await expect(svc.verifyIdToken('expired.token')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 on wrong audience', async () => {
    vi.spyOn(svc, 'verifyIdToken').mockRejectedValueOnce(
      Object.assign(new Error('Wrong audience'), { statusCode: 401 }),
    );
    await expect(svc.verifyIdToken('wrong-audience.token')).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
