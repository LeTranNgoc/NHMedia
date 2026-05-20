import { MongoClient, Db } from 'mongodb';

let _client: MongoClient | null = null;
let _db: Db | null = null;

/**
 * Connect singleton. Safe to call multiple times — only connects once.
 * Returns the Db instance for the given dbName (default: 'translate_voice').
 */
export async function connectMongo(uri: string, dbName = 'translate_voice'): Promise<Db> {
  if (_db) return _db;

  _client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  await _client.connect();
  _db = _client.db(dbName);

  await createIndexes(_db);
  return _db;
}

export async function closeMongo(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
  }
}

export function getDb(): Db {
  if (!_db) throw new Error('MongoDB not connected — call connectMongo() first');
  return _db;
}

async function createIndexes(db: Db): Promise<void> {
  // users: unique email
  await db.collection('users').createIndex({ email: 1 }, { unique: true, background: true });

  // magic_link_tokens: lookup by hash + TTL
  await db.collection('magic_link_tokens').createIndex({ tokenHash: 1 }, { background: true });
  await db
    .collection('magic_link_tokens')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });

  // usage_log: compound (userId, date) + TTL 7 days
  await db.collection('usage_log').createIndex({ userId: 1, date: 1 }, { background: true });
  await db
    .collection('usage_log')
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, background: true });

  // subscriptions: unique on polarSubscriptionId, lookup on userId sorted by
  // createdAt DESC. Compound index serves both "find subscription by userId" and
  // "most-recent sub per user" queries (`findByUserId` sorts on createdAt).
  await db
    .collection('subscriptions')
    .createIndex({ polarSubscriptionId: 1 }, { unique: true, background: true });
  await db
    .collection('subscriptions')
    .createIndex({ userId: 1, createdAt: -1 }, { background: true });

  // webhook_events: unique dedup key + TTL 30 days
  await db.collection('webhook_events').createIndex({ key: 1 }, { unique: true, background: true });
  await db
    .collection('webhook_events')
    .createIndex({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, background: true });
}
