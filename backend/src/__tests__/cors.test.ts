import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;

const TEST_ENV = {
  MONGO_URI: '',
  JWT_SECRET: 'a'.repeat(32),
  RESEND_API_KEY: 'test_resend_key',
  GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com',
  MAGIC_LINK_BASE_URL: 'http://localhost:3000',
  PORT: '3000',
  NODE_ENV: 'test',
  CORS_ORIGINS: 'chrome-extension://test,http://localhost:5173',
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('test_cors');

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 });
  await db.collection('magic_link_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  TEST_ENV.MONGO_URI = mongod.getUri();

  app = await buildApp({ db, env: TEST_ENV });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await client.close();
  await mongod.stop();
});

describe('CORS — chrome-extension:// origins', () => {
  it('allows a real extension origin (chrome-extension://abcdef12345)', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'chrome-extension://abcdef12345',
        'access-control-request-method': 'GET',
      },
    });
    // Preflight should not be blocked — access-control-allow-origin must be set
    expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef12345');
  });

  it('allows another extension origin with a different ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'chrome-extension://zyxwvutsrqpo987654321' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(
      'chrome-extension://zyxwvutsrqpo987654321',
    );
  });

  it('allows explicitly listed origin (http://localhost:5173)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('blocks an unlisted origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });
    // CORS blocked — no allow-origin header returned for unlisted origins
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
