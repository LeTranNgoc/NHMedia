import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { SubscriptionService } from './subscription-service.js';
import { resolveProductIdToTier, type TierProductIds } from './tier-resolver.js';

export interface WebhookEvent {
  id?: string;
  type: string;
  data?: {
    id?: string;
    customer_id?: string;
    product_id?: string;
    status?: string;
    started_at?: string | null;
    ended_at?: string | null;
    current_period_end?: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface WebhookHandlerOptions {
  webhookSecret: string;
  db: Db;
  /** Injected for tests — resolves userId from metadata.userId string */
  resolveUserId: (userIdStr: string) => ObjectId;
  /** 4 paid-tier Polar product IDs from env. Must match UsageTracker config. */
  productIds: TierProductIds;
}

/**
 * Verify a Polar webhook signature.
 *
 * Polar signs the raw request body with HMAC-SHA256 using the webhook secret.
 * The signature is provided in the `polar-signature` header as a hex digest.
 *
 * Uses timingSafeEqual to prevent timing attacks.
 * Returns false if the header is missing or the signature does not match.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  // Polar may send "sha256=<hex>" or plain "<hex>"
  const hexSig = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (hexSig.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(hexSig, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

export class WebhookHandler {
  private readonly subscriptionService: SubscriptionService;
  private readonly opts: WebhookHandlerOptions;

  constructor(opts: WebhookHandlerOptions) {
    this.opts = opts;
    this.subscriptionService = new SubscriptionService(opts.db);
  }

  /**
   * Handle a verified Polar webhook event.
   * Idempotent: dedup key persisted in webhook_events collection (TTL 30d + unique index).
   * Cross-restart safe — replaying the same event is always a no-op.
   */
  async handle(event: WebhookEvent): Promise<{ status: 'processed' | 'skipped' }> {
    const subscriptionId = event.data?.id ?? 'unknown';
    const eventId = event.id ?? 'noid';
    const dedupKey = `${subscriptionId}:${event.type}:${eventId}`;

    // Attempt to claim the dedup key first — if already claimed, skip
    const claimed = await this._claimDedupKey(dedupKey);
    if (!claimed) {
      return { status: 'skipped' };
    }

    switch (event.type) {
      case 'subscription.created':
        await this.handleCreated(event);
        break;

      case 'subscription.updated':
        await this.handleUpdated(event);
        break;

      case 'subscription.canceled':
        await this.handleCanceled(event);
        break;

      default:
        // Unknown event type — acknowledge to avoid Polar retries
        // Key already claimed above; release by noting it as skipped (still idempotent)
        return { status: 'skipped' };
    }

    return { status: 'processed' };
  }

  /**
   * Attempt to insert a dedup key into webhook_events.
   * Returns true if the key was successfully inserted (first time).
   * Returns false if the key already exists (E11000 duplicate key error).
   */
  private async _claimDedupKey(key: string): Promise<boolean> {
    try {
      await this.opts.db.collection('webhook_events').insertOne({
        key,
        processedAt: new Date(),
      });
      return true;
    } catch (err: unknown) {
      // E11000 = duplicate key — event already processed
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        return false;
      }
      // Unexpected DB error — rethrow so the webhook returns 500 and Polar retries
      throw err;
    }
  }

  /** Exposed for testing: clear the persisted dedup collection. */
  static async clearProcessedEvents(db: import('mongodb').Db): Promise<void> {
    await db.collection('webhook_events').deleteMany({});
  }

  // ── Private event handlers ────────────────────────────────────────────────

  private async handleCreated(event: WebhookEvent): Promise<void> {
    const data = event.data;
    if (!data?.id) return;

    const userIdStr = data.metadata?.['userId'] as string | undefined;
    if (!userIdStr) {
      console.warn('[webhook] subscription.created missing metadata.userId — skipping');
      return;
    }

    const userId = this.opts.resolveUserId(userIdStr);
    const startedAt = data.started_at ? new Date(data.started_at) : new Date();
    const endsAt = data.current_period_end ? new Date(data.current_period_end) : null;
    const status = this.normalizeStatus(data.status ?? 'active');
    const polarProductId = data.product_id;
    const tier = polarProductId
      ? resolveProductIdToTier(polarProductId, this.opts.productIds)
      : 'pro';

    await this.subscriptionService.upsert({
      userId,
      polarSubscriptionId: data.id,
      tier,
      polarProductId,
      status,
      startedAt,
      endsAt,
    });
    console.info(
      `[webhook] subscription activated — userId=${userIdStr} sub=${data.id} tier=${tier} product=${polarProductId ?? '<none>'}`,
    );
  }

  private async handleUpdated(event: WebhookEvent): Promise<void> {
    const data = event.data;
    if (!data?.id) return;

    // Find existing subscription to preserve userId and startedAt
    const existing = await this.subscriptionService.findByPolarId(data.id);
    if (!existing) {
      // Out-of-order: canceled/updated arrived before created — tolerate gracefully
      console.warn(`[webhook] subscription.updated for unknown sub ${data.id} — ignoring`);
      return;
    }

    const endsAt = data.current_period_end ? new Date(data.current_period_end) : existing.endsAt;
    const status = this.normalizeStatus(data.status ?? existing.status);
    // Prefer the freshly-arrived product_id (handles tier upgrades like Starter→Pro).
    // Fall back to the previously-persisted polarProductId.
    const polarProductId = data.product_id ?? existing.polarProductId;
    const tier = polarProductId
      ? resolveProductIdToTier(polarProductId, this.opts.productIds)
      : (existing.tier ?? 'pro');

    await this.subscriptionService.upsert({
      userId: existing.userId,
      polarSubscriptionId: data.id,
      tier,
      polarProductId,
      status,
      startedAt: existing.startedAt,
      endsAt,
    });
  }

  private async handleCanceled(event: WebhookEvent): Promise<void> {
    const data = event.data;
    if (!data?.id) return;

    const existing = await this.subscriptionService.findByPolarId(data.id);

    if (!existing) {
      // Out-of-order: create with canceled status so we have a record
      const userIdStr = data.metadata?.['userId'] as string | undefined;
      if (!userIdStr) {
        console.warn(
          '[webhook] subscription.canceled missing metadata.userId and no existing — skipping',
        );
        return;
      }
      const userId = this.opts.resolveUserId(userIdStr);
      const endsAt = data.current_period_end ? new Date(data.current_period_end) : null;
      const polarProductId = data.product_id;
      const tier = polarProductId
        ? resolveProductIdToTier(polarProductId, this.opts.productIds)
        : 'pro';
      await this.subscriptionService.upsert({
        userId,
        polarSubscriptionId: data.id,
        tier,
        polarProductId,
        status: 'canceled',
        startedAt: new Date(),
        endsAt,
      });
      return;
    }

    // endsAt = current_period_end (user keeps paid access until billing period ends)
    const endsAt = data.current_period_end ? new Date(data.current_period_end) : existing.endsAt;
    // Preserve existing tier on cancel — don't re-resolve unless event carries product_id
    const polarProductId = data.product_id ?? existing.polarProductId;
    const tier = polarProductId
      ? resolveProductIdToTier(polarProductId, this.opts.productIds)
      : (existing.tier ?? 'pro');

    await this.subscriptionService.upsert({
      userId: existing.userId,
      polarSubscriptionId: data.id,
      tier,
      polarProductId,
      status: 'canceled',
      startedAt: existing.startedAt,
      endsAt,
    });
  }

  private normalizeStatus(raw: string): 'active' | 'canceled' | 'expired' {
    if (raw === 'canceled' || raw === 'cancelled') return 'canceled';
    if (raw === 'expired') return 'expired';
    return 'active';
  }
}
