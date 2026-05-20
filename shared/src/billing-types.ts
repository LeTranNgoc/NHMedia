// ── Billing tier ─────────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'standard' | 'pro' | 'unlimited';

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
