import { Polar } from '@polar-sh/sdk';

export interface PolarClientOptions {
  apiKey: string;
  productIdPro: string;
}

export interface CheckoutSessionParams {
  userId: string;
  customerEmail?: string;
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

  constructor(opts: PolarClientOptions) {
    this.client = new Polar({ accessToken: opts.apiKey });
    this.productIdPro = opts.productIdPro;
  }

  /**
   * Create a Polar checkout session for the Pro product.
   * Returns the hosted checkout URL after validating it originates from polar.sh.
   * Throws on Polar API failure or if the returned URL is not on an allowed host.
   * Caller should catch and return 503.
   */
  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const session = await this.client.checkouts.create({
      products: [this.productIdPro],
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
   * Retrieve a subscription by its Polar subscription ID.
   * Used for webhook reconciliation.
   */
  async getSubscription(polarSubscriptionId: string): Promise<unknown> {
    return this.client.subscriptions.get({ id: polarSubscriptionId });
  }
}
