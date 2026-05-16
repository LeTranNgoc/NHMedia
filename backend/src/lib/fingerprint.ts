import crypto from 'node:crypto';
import type { Db } from 'mongodb';
import { usersCollection } from '../db/models/user.js';

/**
 * Free-tier abuse guard: hash a stable "device" signature from the request.
 *
 * The fingerprint is NOT meant to be unspoofable — a determined attacker
 * cycling IPs + UA strings will get through. It catches the lazy case
 * (same machine, same IP, signing up 10 emails) which is 90 % of the
 * Deepgram-quota abuse risk for closed beta.
 */
export interface FingerprintInputs {
  ip: string;
  userAgent: string;
  extensionId?: string;
}

export function computeFingerprint(inputs: FingerprintInputs): string {
  const ipNormalized = normalizeIp(inputs.ip);
  const input = `${ipNormalized}|${inputs.userAgent}|${inputs.extensionId ?? ''}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Check whether a new sign-up from `fingerprint` is allowed, given that
 * accounts already exist sharing the same fingerprint.
 *
 * Pass `existingEmail` when the request is a sign-IN attempt (same email
 * already on file) — those bypass the cap because they're not a new account.
 *
 * Returns `{ allowed: false }` only when ALL conditions hold:
 *   - maxAccounts > 0 (feature enabled)
 *   - email is new (not already in users collection with this fingerprint)
 *   - users.countDocuments({ fingerprints: fp }) >= maxAccounts
 */
export async function checkFingerprintAllowed(opts: {
  db: Db;
  fingerprint: string;
  email: string;
  maxAccounts: number;
}): Promise<{ allowed: boolean; existingCount: number }> {
  const { db, fingerprint, email, maxAccounts } = opts;
  if (maxAccounts <= 0) return { allowed: true, existingCount: 0 };

  const users = usersCollection(db);

  // Existing user re-signing in from the same device → always allowed.
  const existing = await users.findOne(
    { email, fingerprints: fingerprint },
    { projection: { _id: 1 } },
  );
  if (existing) return { allowed: true, existingCount: 0 };

  const count = await users.countDocuments({ fingerprints: fingerprint });
  return { allowed: count < maxAccounts, existingCount: count };
}

/** Normalize IPv4-mapped IPv6 + strip port + trim spaces. */
function normalizeIp(ip: string): string {
  let v = ip.trim();
  // ::ffff:1.2.3.4 → 1.2.3.4
  if (v.startsWith('::ffff:')) v = v.slice(7);
  // strip port suffix on IPv4
  const portIdx = v.lastIndexOf(':');
  if (portIdx > 0 && /^\d+$/.test(v.slice(portIdx + 1)) && v.indexOf(':') === portIdx) {
    v = v.slice(0, portIdx);
  }
  return v;
}
