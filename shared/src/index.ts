export const SHARED_PACKAGE_VERSION = '0.1.0';

// ── WS protocol types ──────────────────────────────────────────────────────────
export * from './ws-protocol.js';

// ── Pipeline event types ───────────────────────────────────────────────────────
export * from './pipeline-types.js';

// ── Auth contract types ────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface MagicLinkRequest {
  email: string;
}

// ── Billing types ──────────────────────────────────────────────────────────
export * from './billing-types.js';
