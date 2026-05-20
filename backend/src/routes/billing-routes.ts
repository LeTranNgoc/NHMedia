import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { buildAuthGuard } from '../middleware/auth-guard.js';
import type { JwtService } from '../auth/jwt-service.js';
import { UsageTracker, utcDateString } from '../lib/usage-tracker.js';
import { PolarClient } from '../billing/polar-client.js';
import { SubscriptionService } from '../billing/subscription-service.js';
import { WebhookHandler, verifyWebhookSignature } from '../billing/webhook-handler.js';
import { usageLogCollection } from '../db/models/usage-log.js';

const checkoutBodySchema = z.object({
  tier: z.enum(['starter', 'standard', 'pro', 'unlimited']),
});

export interface BillingRoutesOptions {
  db: Db;
  jwtService: JwtService;
  usageTracker: UsageTracker;
  polarClient: PolarClient;
  webhookSecret: string;
  /** Polar customer portal URL. Defaults to https://polar.sh/dashboard */
  customerPortalUrl?: string;
  /** Product ID lookup table for the 4 paid tiers */
  productIdStarter?: string;
  productIdStandard?: string;
  productIdPro?: string;
  productIdUnlimited?: string;
}

export async function billingRoutes(
  app: FastifyInstance,
  opts: BillingRoutesOptions,
): Promise<void> {
  const {
    db,
    jwtService,
    usageTracker,
    polarClient,
    webhookSecret,
    customerPortalUrl = 'https://polar.sh/dashboard',
    productIdStarter = '',
    productIdStandard = '',
    productIdPro = '',
    productIdUnlimited = '',
  } = opts;
  const authGuard = buildAuthGuard(jwtService);

  /** Map tier name → Polar product ID */
  const tierProductIdMap: Record<string, string> = {
    starter: productIdStarter,
    standard: productIdStandard,
    pro: productIdPro,
    unlimited: productIdUnlimited,
  };

  // ── GET /billing/me ─────────────────────────────────────────────────────────
  app.get(
    '/me',
    { preHandler: authGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const tier = await usageTracker.getTier(userId);
      const limits = usageTracker.getLimit(tier);
      const usage = await usageTracker.getToday(userId);

      // Backward-compat: keep legacy secondsCaptured/limitSeconds/percentUsed fields
      const percentUsed =
        limits.seconds !== null
          ? Math.min(100, Math.round((usage.seconds / limits.seconds) * 100))
          : null;

      return reply.status(200).send({
        tier,
        customerPortalUrl,
        usageToday: {
          secondsCaptured: usage.seconds,
          limitSeconds: limits.seconds,
          percentUsed,
          translateChars: usage.translateChars,
          ttsChars: usage.ttsChars,
        },
        limits: {
          seconds: limits.seconds,
          translateChars: limits.translateChars,
          ttsChars: limits.ttsChars,
        },
      });
    },
  );

  // ── GET /billing/checkout-url ───────────────────────────────────────────────
  // Returns pre-built Polar hosted checkout URL for authenticated user.
  // customer_external_id is set server-side from JWT — no client input accepted.
  app.get(
    '/checkout-url',
    { preHandler: authGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId, email } = request.user!;
      try {
        const url = polarClient.getCheckoutUrl(userId, email ?? '');
        return reply.status(200).send({ url });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        if (msg.includes('not configured')) {
          return reply.status(503).send({
            code: 'CHECKOUT_NOT_CONFIGURED',
            message: 'checkout not configured',
          });
        }
        app.log.error({ err: msg }, 'checkout-url error');
        return reply.status(503).send({
          code: 'BILLING_UNAVAILABLE',
          message: 'Billing service temporarily unavailable',
        });
      }
    },
  );

  // ── POST /billing/checkout ───────────────────────────────────────────────────
  app.post(
    '/checkout',
    { preHandler: authGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = checkoutBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid request',
        });
      }

      const { userId, email } = request.user!;
      const { tier } = parsed.data;

      const resolvedProductId = tierProductIdMap[tier];
      if (!resolvedProductId) {
        return reply.status(503).send({
          code: 'PRODUCT_NOT_CONFIGURED',
          message: `Product ID for tier '${tier}' is not configured`,
        });
      }

      try {
        const result = await polarClient.createCheckoutSession({
          userId,
          customerEmail: email,
          productId: resolvedProductId,
        });
        return reply.status(200).send({ url: result.url });
      } catch (err) {
        app.log.error({ err }, 'Polar checkout failed');
        return reply.status(503).send({
          code: 'BILLING_UNAVAILABLE',
          message: 'Billing service temporarily unavailable — please try again later',
        });
      }
    },
  );

  // ── POST /billing/cancel ─────────────────────────────────────────────────────
  app.post(
    '/cancel',
    { preHandler: authGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const subscriptionService = new SubscriptionService(db);
      const sub = await subscriptionService.findByUserId(new ObjectId(userId));

      if (!sub) {
        return reply
          .status(404)
          .send({ code: 'NO_SUBSCRIPTION', message: 'No active subscription found' });
      }

      // Already canceled — idempotent 200
      if (sub.status === 'canceled') {
        return reply.status(200).send({ status: 'canceled' });
      }

      try {
        await polarClient.cancelSubscription(sub.polarSubscriptionId);
        // Persistence is handled by webhook (subscription_canceled event) — do not update DB here
        return reply.status(200).send({ status: 'canceled' });
      } catch (err) {
        app.log.error({ err }, 'Polar cancel subscription failed');
        return reply.status(503).send({
          code: 'BILLING_UNAVAILABLE',
          message: 'Billing service temporarily unavailable — please try again later',
        });
      }
    },
  );

  // ── POST /billing/webhook ────────────────────────────────────────────────────
  // No auth guard — HMAC verified instead.
  // Raw body parsing is configured via addContentTypeParser in app.ts.
  app.post('/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const signatureHeader = request.headers['polar-signature'] as string | undefined;
    // request.rawBody is populated by the raw content-type parser in app.ts
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      return reply.status(400).send({ code: 'MISSING_BODY', message: 'Raw body required' });
    }

    const valid = verifyWebhookSignature(rawBody, signatureHeader, webhookSecret);
    if (!valid) {
      return reply
        .status(401)
        .send({ code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' });
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.status(400).send({ code: 'INVALID_JSON', message: 'Invalid JSON body' });
    }

    const handler = new WebhookHandler({
      webhookSecret,
      db,
      resolveUserId: (id) => new ObjectId(id),
      productIds: {
        productIdStarter,
        productIdStandard,
        productIdPro,
        productIdUnlimited,
      },
    });

    // Never log payload verbatim — may contain customer email
    try {
      const result = await handler.handle(event as Parameters<typeof handler.handle>[0]);
      return reply.status(200).send({ status: result.status });
    } catch (err) {
      app.log.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'webhook handler error',
      );
      return reply.status(500).send({ code: 'HANDLER_ERROR', message: 'Internal error' });
    }
  });

  // ── GET /billing/usage?days=7 ────────────────────────────────────────────────
  app.get(
    '/usage',
    { preHandler: authGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const query = request.query as Record<string, string>;
      const days = Math.min(30, Math.max(1, parseInt(query['days'] ?? '7', 10)));

      const tier = await usageTracker.getTier(userId);
      const limits = usageTracker.getLimit(tier);
      // Backward-compat: /usage only exposes seconds for now
      const limitSeconds = limits.seconds;

      // Build list of last N days in UTC descending
      const dateList: string[] = [];
      const now = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        dateList.push(utcDateString(d));
      }

      const col = usageLogCollection(db);
      const docs = await col
        .find({ userId: new ObjectId(userId), date: { $in: dateList } })
        .toArray();

      const byDate = new Map(docs.map((d) => [d.date, d.secondsCaptured]));

      // Today: add in-memory pending (seconds only for /usage endpoint)
      const todayStr = utcDateString();
      const todayTotals = await usageTracker.getToday(userId);

      const result = dateList.map((date) => {
        const seconds = date === todayStr ? todayTotals.seconds : (byDate.get(date) ?? 0);
        const percentUsed =
          limitSeconds !== null ? Math.min(100, Math.round((seconds / limitSeconds) * 100)) : null;
        return {
          date,
          secondsCaptured: seconds,
          limitSeconds,
          percentUsed,
        };
      });

      return reply.status(200).send(result);
    },
  );
}
