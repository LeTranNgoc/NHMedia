import { randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { tokenHash } from '../lib/token-hash.js';
import type { EmailService } from './email-service.js';
import type { User } from '../db/models/user.js';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface GeneratedToken {
  rawToken: string;
  hashedToken: string;
}

function authError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 401 });
}

export class MagicLinkService {
  constructor(
    private readonly db: Db,
    private readonly emailService: EmailService,
    private readonly baseUrl: string = 'http://localhost:3000',
  ) {}

  /** Generate a raw token + its sha256 hash pair. Exposed for tests. */
  async generateToken(): Promise<GeneratedToken> {
    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const hashedToken = tokenHash(rawToken);
    return { rawToken, hashedToken };
  }

  /**
   * Request a magic link. Always returns void (204) — never leaks whether
   * the email exists (anti-enumeration).
   *
   * Throws 503 only if email service is down — caller should NOT store token
   * in that case (handled here: email is sent before insert returns cleanly,
   * but we store token first then send; on send failure we delete the token).
   */
  async request(email: string): Promise<void> {
    const { rawToken, hashedToken } = await this.generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

    await this.db.collection('magic_link_tokens').insertOne({
      tokenHash: hashedToken,
      email,
      expiresAt,
      used: false,
      createdAt: now,
    });

    try {
      await this.emailService.sendMagicLink(email, rawToken, this.baseUrl);
    } catch (err) {
      // Email service down — clean up orphan token then re-throw 503
      await this.db.collection('magic_link_tokens').deleteOne({ tokenHash: hashedToken });
      throw err;
    }
  }

  /**
   * Verify a raw token atomically via findOneAndUpdate.
   * Single-use: the update only matches `used: false` docs.
   * Returns the upserted/existing user.
   */
  async verify(rawToken: string): Promise<User> {
    // Basic format check: must be 64 hex chars
    if (!/^[0-9a-f]{64}$/.test(rawToken)) {
      throw authError('Invalid token format');
    }

    const hashed = tokenHash(rawToken);
    const now = new Date();

    // Atomic single-use: only matches unused, unexpired token
    const result = await this.db.collection('magic_link_tokens').findOneAndUpdate(
      {
        tokenHash: hashed,
        used: false,
        expiresAt: { $gt: now },
      },
      { $set: { used: true } },
      { returnDocument: 'after' },
    );

    if (!result) {
      throw authError('Invalid, expired, or already-used token');
    }

    const email = result['email'] as string;

    // Upsert user by email
    const upsertResult = await this.db.collection<User>('users').findOneAndUpdate(
      { email },
      {
        $set: { updatedAt: now },
        $setOnInsert: {
          email,
          name: null,
          picture: null,
          authProviders: ['magic_link'],
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    if (!upsertResult) {
      throw authError('Failed to resolve user');
    }

    return upsertResult as unknown as User;
  }
}
