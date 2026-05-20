// ── Billing tier ─────────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'standard' | 'pro' | 'unlimited';

export type PaidTier = Exclude<Tier, 'free'>;

// ── Tier pricing & cap metadata (single source of truth) ─────────────────────

export interface TierPricing {
  /** Display name (English; keep matching free-form Vietnamese rendering in UI) */
  displayName: string;
  /** Monthly USD price */
  priceUsd: number;
  /** Monthly cap in seconds. Drives backend `getLimit` default + FE plan card display. */
  monthlySeconds: number;
}

/**
 * Canonical tier pricing table.
 *
 * Consumers:
 * - FE plan picker (`account-view.tsx`)
 * - FE tier badge formatter (`main-view.tsx`)
 * - BE env defaults (`backend/src/config/env.ts` — `*_TIER_MONTHLY_LIMIT_SECONDS`)
 *   A backend test asserts the env defaults match the `monthlySeconds` here.
 *
 * Free tier omitted — daily cap, not monthly. Free cap lives in `FREE_TIER_LIMIT_SECONDS` (900s daily).
 */
export const PAID_TIER_PRICING: Record<PaidTier, TierPricing> = {
  starter: { displayName: 'Starter', priceUsd: 4.99, monthlySeconds: 5 * 3600 },
  standard: { displayName: 'Standard', priceUsd: 9.99, monthlySeconds: 15 * 3600 },
  pro: { displayName: 'Pro', priceUsd: 19.99, monthlySeconds: 40 * 3600 },
  unlimited: { displayName: 'Unlimited', priceUsd: 39.99, monthlySeconds: 200 * 3600 },
};

// ── Subscription status ───────────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'canceled' | 'expired';

// ── Usage summary for a single day ──────────────────────────────────────────

export interface UsageSummary {
  /** YYYY-MM-DD UTC */
  date: string;
  secondsCaptured: number;
  /** null = unlimited (pro tier) */
  limitSeconds: number | null;
  percentUsed: number | null;
}

// ── Multi-kind usage totals ───────────────────────────────────────────────────

export interface UsageTotalsResponse {
  seconds: number | null;
  translateChars: number | null;
  ttsChars: number | null;
}

// ── Billing /me response ──────────────────────────────────────────────────────

export interface BillingMeResponse {
  tier: Tier;
  /** Polar customer portal URL returned by the backend. Use instead of any hardcoded URL. */
  customerPortalUrl: string;
  usageToday: {
    /** @deprecated use limits.seconds instead */
    secondsCaptured: number;
    /** @deprecated use limits.seconds instead */
    limitSeconds: number | null;
    /** @deprecated use limits.seconds instead */
    percentUsed: number | null;
    translateChars: number;
    ttsChars: number;
  };
  limits: UsageTotalsResponse;
}

// ── Checkout response ─────────────────────────────────────────────────────────

export interface CheckoutResponse {
  url: string;
}

// ── Subscription record (shared shape) ────────────────────────────────────────

export interface SubscriptionRecord {
  userId: string;
  polarSubscriptionId: string;
  tier: Tier;
  status: SubscriptionStatus;
  startedAt: string;
  endsAt: string | null;
}
