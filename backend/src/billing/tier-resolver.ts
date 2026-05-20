import type { SubscriptionTier } from '../db/models/subscription.js';

export interface TierProductIds {
  productIdStarter: string;
  productIdStandard: string;
  productIdPro: string;
  productIdUnlimited: string;
}

/**
 * Resolve a Polar product ID → internal tier name.
 *
 * Used by both:
 * - `WebhookHandler` when persisting subscription rows from Polar events
 * - `UsageTracker.getTier()` when reading the stored row back
 *
 * Both call sites MUST agree on the mapping, otherwise paid users get the
 * wrong cap. Single source of truth — do NOT duplicate this logic inline.
 *
 * Empty product ID configs (`''`) are skipped so they never match an
 * incoming productId of `''` (which can happen with malformed events).
 *
 * Fallback for unknown / missing productId: `'pro'`. This is graceful
 * for legacy rows where polarProductId was never written. A console.warn
 * is logged so the misconfig surfaces during prod debugging.
 */
export function resolveProductIdToTier(
  productId: string | undefined | null,
  productIds: TierProductIds,
): SubscriptionTier {
  if (!productId) {
    console.warn(`[tier-resolver] empty/missing product id — falling back to 'pro'`);
    return 'pro';
  }
  if (productIds.productIdStarter && productId === productIds.productIdStarter) return 'starter';
  if (productIds.productIdStandard && productId === productIds.productIdStandard) return 'standard';
  if (productIds.productIdPro && productId === productIds.productIdPro) return 'pro';
  if (productIds.productIdUnlimited && productId === productIds.productIdUnlimited)
    return 'unlimited';
  console.warn(
    `[tier-resolver] unknown product id '${productId}' — falling back to 'pro' (legacy graceful)`,
  );
  return 'pro';
}
