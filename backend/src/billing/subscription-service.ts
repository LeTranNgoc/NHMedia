import type { Db, ObjectId } from 'mongodb';
import {
  subscriptionCollection,
  type Subscription,
  type SubscriptionTier,
} from '../db/models/subscription.js';

export class SubscriptionService {
  constructor(private readonly db: Db) {}

  /**
   * Upsert a subscription by polarSubscriptionId.
   * On insert: creates with all provided fields.
   * On update: merges provided fields (status, endsAt, updatedAt).
   */
  async upsert(params: {
    userId: ObjectId;
    polarSubscriptionId: string;
    tier: SubscriptionTier;
    polarProductId?: string;
    status: 'active' | 'canceled' | 'expired';
    startedAt: Date;
    endsAt: Date | null;
  }): Promise<void> {
    const col = subscriptionCollection(this.db);
    const now = new Date();

    // $set updates mutable fields on both insert and update.
    // $setOnInsert sets immutable fields only on initial insert.
    // Fields must NOT overlap between $set and $setOnInsert — MongoDB rejects that.
    //
    // `tier` is in $set (not $setOnInsert) so a Starter→Pro upgrade webhook
    // updates the existing row. Treating tier as an advisory cache; the
    // authoritative source is polarProductId (resolved on read).
    await col.updateOne(
      { polarSubscriptionId: params.polarSubscriptionId },
      {
        $set: {
          tier: params.tier,
          status: params.status,
          endsAt: params.endsAt,
          updatedAt: now,
          ...(params.polarProductId !== undefined ? { polarProductId: params.polarProductId } : {}),
        },
        $setOnInsert: {
          userId: params.userId,
          polarSubscriptionId: params.polarSubscriptionId,
          startedAt: params.startedAt,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  /** Find the most recent subscription for a user. Returns null if none. */
  async findByUserId(userId: ObjectId): Promise<Subscription | null> {
    const col = subscriptionCollection(this.db);
    return col.findOne({ userId }, { sort: { createdAt: -1 } });
  }

  /** Find a subscription by its Polar subscription ID. */
  async findByPolarId(polarSubscriptionId: string): Promise<Subscription | null> {
    const col = subscriptionCollection(this.db);
    return col.findOne({ polarSubscriptionId });
  }
}
