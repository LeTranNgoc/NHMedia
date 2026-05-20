import { Polar } from '@polar-sh/sdk';

export type PolarServer = 'sandbox' | 'production';

export interface PolarClientOptions {
  apiKey: string;
  productIdPro: string;
  /** Hosted checkout URL from Polar dashboard (e.g. https://buy.polar.sh/<slug>).
   *  Used by getCheckoutUrl(). Optional — if empty, getCheckoutUrl throws. */
  proCheckoutUrl?: string;
  /** Defaults to 'production'. Set 'sandbox' to use sandbox.polar.sh. */
  server?: PolarServer;
}

export interface CheckoutSessionParams {
  userId: string;
  customerEmail?: string;
  /** Override which product to create a checkout session for. Defaults to productIdPro. */
  productId?: string;
}

export interface CancelSubscriptionResult {
  status: 'canceled';
  endsAt: Date | null;
}

export interface CheckoutSessionResult {
  url: string;
}

/**
 * Thin wrapper around @polar-sh/sdk.
 * Isolates Polar API calls so they can be mocked in tests.
 */
export class PolarClient {
  private readonly client: Polar;
  private readonly productIdPro: string;
  private readonly proCheckoutUrl: string;

  constructor(opts: PolarClientOptions) {
    this.client = new Polar({
      accessToken: opts.apiKey,
      server: opts.server ?? 'production',
    });
    this.productIdPro = opts.productIdPro;
    this.proCheckoutUrl = opts.proCheckoutUrl ?? '';
  }

  /**
   * Create a Polar checkout session.
   * Uses params.productId if provided, otherwise falls back to productIdPro.
   * Returns the hosted checkout URL after validating it originates from polar.sh.
   * Throws on Polar API failure or if the returned URL is not on an allowed host.
   * Caller should catch and return 503.
   */
  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const productId = params.productId ?? this.productIdPro;
    const session = await this.client.checkouts.create({
      products: [productId],
      customerEmail: params.customerEmail,
      metadata: { userId: params.userId },
    });

    const url = (session as unknown as { url?: string }).url;
    if (!url) {
      throw new Error('Polar checkout session missing url');
    }

    // Validate that the URL host is *.polar.sh to prevent open-redirect if the
    // Polar SDK or a misconfigured product ever returns an attacker-controlled URL.
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.polar.sh') && parsed.hostname !== 'polar.sh') {
      throw new Error(
        `Polar checkout URL has unexpected host '${parsed.hostname}' — expected *.polar.sh`,
      );
    }

    return { url };
  }

  /**
   * Build a hosted checkout URL using the Polar dashboard checkout link.
   * Appends customer_external_id (userId from JWT) and customer_email as query params.
   * Throws if POLAR_PRO_CHECKOUT_URL is not configured — caller returns 503.
   *
   * Security: userId and email come from JWT claims on the server, never from client input.
   */
  getCheckoutUrl(userId: string, email: string): string {
    if (!this.proCheckoutUrl) {
      throw new Error('POLAR_PRO_CHECKOUT_URL is not configured');
    }
    const url = new URL(this.proCheckoutUrl);
    // Defense: env could be misconfigured to a hostile URL — would leak userId
    // via customer_external_id query param. Match createCheckoutSession's check.
    if (!url.hostname.endsWith('.polar.sh') && url.hostname !== 'polar.sh') {
      throw new Error(
        `POLAR_PRO_CHECKOUT_URL has unexpected host '${url.hostname}' — expected *.polar.sh`,
      );
    }
    url.searchParams.set('customer_external_id', userId);
    url.searchParams.set('customer_email', email);
    return url.toString();
  }

  /**
   * Retrieve a subscription by its Polar subscription ID.
   * Used for webhook reconciliation.
   */
  async getSubscription(polarSubscriptionId: string): Promise<unknown> {
    return this.client.subscriptions.get({ id: polarSubscriptionId });
  }

  /**
   * Cancel a Polar subscription by its Polar subscription ID.
   * Returns { status: 'canceled', endsAt } from the Polar response.
   * Does NOT throw on 404 (already canceled) — handles gracefully.
   */
  async cancelSubscription(polarSubscriptionId: string): Promise<CancelSubscriptionResult> {
    try {
      const result = await this.client.subscriptions.revoke({ id: polarSubscriptionId });
      const raw = result as unknown as { endsAt?: string | null; endedAt?: string | null };
      const endsAtStr = raw.endsAt ?? raw.endedAt ?? null;
      return {
        status: 'canceled',
        endsAt: endsAtStr ? new Date(endsAtStr) : null,
      };
    } catch (err: unknown) {
      // 404 = already canceled — treat gracefully
      const status =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode: number }).statusCode
          : null;
      if (status === 404) {
        return { status: 'canceled', endsAt: null };
      }
      throw err;
    }
  }
}
