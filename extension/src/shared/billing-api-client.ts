import type { BillingMeResponse, CheckoutResponse, UsageSummary } from '@translate-voice/shared';

// Env var injected at build time by WXT. Default keeps local dev working.
const API_BASE: string =
  (typeof import.meta.env !== 'undefined' && (import.meta.env['WXT_API_BASE'] as string | undefined)) ||
  'http://localhost:3000';

/**
 * Fetch wrapper for /billing/* endpoints.
 * Reads the auth token from chrome.storage.local (key: 'authToken').
 * Throws on network errors or non-2xx responses.
 */

async function getAuthToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get('authToken');
    return (result['authToken'] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options.method ?? 'GET'} ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * GET /billing/me — current subscription + today's usage.
 */
export async function getBillingMe(): Promise<BillingMeResponse> {
  return apiFetch<BillingMeResponse>('/billing/me');
}

/** Validate that a checkout URL is a legitimate Polar URL before opening it. */
function assertPolarUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[billing] checkout URL is not a valid URL: ${url}`);
  }
  // Accept polar.sh and its sandbox/staging subdomains (sandbox.polar.sh etc.)
  if (parsed.protocol !== 'https:' || !/^([a-z0-9-]+\.)?polar\.sh$/.test(parsed.hostname)) {
    throw new Error(`[billing] checkout URL hostname not trusted: ${parsed.hostname}`);
  }
}

/**
 * POST /billing/checkout — create a Polar checkout session.
 * Opens the returned URL in a new tab after validating it's a polar.sh URL.
 */
export async function startCheckout(): Promise<void> {
  const result = await apiFetch<CheckoutResponse>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ tier: 'pro' }),
  });

  assertPolarUrl(result.url);
  await chrome.tabs.create({ url: result.url });
}

/**
 * GET /billing/checkout-url — pre-built Polar hosted checkout URL.
 * customer_external_id is set server-side from JWT — no client data injected.
 * Opens the returned URL in a new tab after validating it's a polar.sh URL.
 */
export async function openCheckoutUrl(): Promise<void> {
  const result = await apiFetch<{ url: string }>('/billing/checkout-url');
  assertPolarUrl(result.url);
  await chrome.tabs.create({ url: result.url });
}

/**
 * GET /billing/usage?days=N — daily usage breakdown.
 */
export async function getUsageHistory(days = 7): Promise<UsageSummary[]> {
  return apiFetch<UsageSummary[]>(`/billing/usage?days=${days}`);
}
