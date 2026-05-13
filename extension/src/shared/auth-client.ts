/**
 * auth-client.ts — sign-in helpers for the Chrome extension popup.
 *
 * Two flows:
 *   1. Google OAuth  — chrome.identity.launchWebAuthFlow round-trip
 *   2. Magic link    — request email link; user pastes returned JWT manually
 *
 * Both end with JWT stored at chrome.storage.local key 'authToken'.
 */

// Env var injected at build time by WXT. Default keeps local dev working.
const API_BASE: string =
  (typeof import.meta.env !== 'undefined' &&
    (import.meta.env['WXT_API_BASE'] as string | undefined)) ||
  'http://localhost:3000';

// ── Storage helpers ───────────────────────────────────────────────────────────

export async function getStoredToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get('authToken');
    return (result['authToken'] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function storeToken(token: string): Promise<void> {
  await chrome.storage.local.set({ authToken: token });
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove('authToken');
}

// ── Google OAuth via launchWebAuthFlow ────────────────────────────────────────

/**
 * Opens Google OAuth in a Chrome-managed window via launchWebAuthFlow.
 * The backend `/auth/google/extension-start` initiates the Google consent page.
 * On success, Google redirects to `https://<ext-id>.chromiumapp.org/?token=<JWT>`.
 * Chrome captures that redirect and resolves the promise with the URL.
 *
 * @returns The stored JWT.
 * @throws On user cancel, network error, or missing token in redirect URL.
 */
export async function signInWithGoogle(): Promise<string> {
  const extensionId = chrome.runtime.id;
  const startUrl = `${API_BASE}/auth/google/extension-start?extension_id=${encodeURIComponent(extensionId)}`;

  let redirectUrl: string | undefined;
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({
      url: startUrl,
      interactive: true,
    });
  } catch (cause) {
    throw Object.assign(
      new Error('Google sign-in cancelled or failed'),
      { cause },
    );
  }

  const token = extractTokenFromUrl(redirectUrl);
  if (!token) {
    throw new Error('Google sign-in succeeded but no token in redirect URL');
  }

  await storeToken(token);
  return token;
}

// ── Magic link ────────────────────────────────────────────────────────────────

/**
 * Request a magic link email. The backend stores the extensionId with the
 * token so /auth/magic-link/verify returns an HTML bridge page with the JWT.
 * The user clicks the link in email, copies the JWT, pastes it in the popup.
 *
 * @throws On network/API error.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const extensionId = chrome.runtime.id;

  const res = await fetch(`${API_BASE}/auth/magic-link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, extensionId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Magic link request failed (${res.status}): ${body}`);
  }
}

/**
 * Validate a pasted JWT by calling /auth/me, then store it if valid.
 * @returns The user email on success.
 * @throws If the token is invalid or request fails.
 */
export async function signInWithToken(rawToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${rawToken}` },
  });

  if (!res.ok) {
    throw new Error(`Token validation failed (${res.status})`);
  }

  const body = (await res.json()) as { user: { email: string } };
  await storeToken(rawToken);
  return body.user.email;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function extractTokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('token');
  } catch {
    return null;
  }
}
