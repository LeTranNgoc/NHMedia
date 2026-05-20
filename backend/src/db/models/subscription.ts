import type { Collection, Db, ObjectId } from 'mongodb';

export type SubscriptionTier = 'free' | 'starter' | 'standard' | 'pro' | 'unlimited';

export interface Subscription {
  _id: ObjectId;
  userId: ObjectId;
  polarSubscriptionId: string;
  tier: SubscriptionTier;
  /** Polar product ID — used to re-derive tier at read time. Optional for legacy rows. */
  polarProductId?: string;
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
