// ── Billing tier ─────────────────────────────────────────────────────────────

export type Tier = 'free' | 'pro';

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

// ── Billing /me response ──────────────────────────────────────────────────────

export interface BillingMeResponse {
  tier: Tier;
  usageToday: {
    secondsCaptured: number;
    limitSeconds: number | null;
    percentUsed: number | null;
  };
}

// ── Checkout response ─────────────────────────────────────────────────────────

export interface CheckoutResponse {
  url: string;
}

// ── Subscription record (shared shape) ────────────────────────────────────────

export interface SubscriptionRecord {
  userId: string;
  polarSubscriptionId: string;
  tier: 'pro';
  status: SubscriptionStatus;
  startedAt: string;
  endsAt: string | null;
}
