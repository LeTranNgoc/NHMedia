import { createHash } from 'node:crypto';

/**
 * SHA-256 hash of a raw token string.
 * Returns 64-char lowercase hex. Use this before storing in DB — never store raw.
 */
export function tokenHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
