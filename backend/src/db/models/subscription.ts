import type { Collection, Db, ObjectId } from 'mongodb';

export interface Subscription {
  _id: ObjectId;
  userId: ObjectId;
  polarSubscriptionId: string;
  tier: 'pro';
  status: 'active' | 'canceled' | 'expired';
  startedAt: Date;
  /** null while active with no end date; set when canceled/expired */
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionInsert = Omit<Subscription, '_id'>;

export function subscriptionCollection(db: Db): Collection<Subscription> {
  return db.collection<Subscription>('subscriptions');
}

/**
 * Create indexes required for Subscription collection.
 * Idempotent — safe to call on every startup.
 */
export async function createSubscriptionIndexes(db: Db): Promise<void> {
  const col = subscriptionCollection(db);
  await col.createIndex({ polarSubscriptionId: 1 }, { unique: true, background: true });
  await col.createIndex({ userId: 1 }, { background: true });
}
