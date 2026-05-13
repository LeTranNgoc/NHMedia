import { OAuth2Client } from 'google-auth-library';
import type { Db } from 'mongodb';
import type { User } from '../db/models/user.js';

export class GoogleOAuthService {
  private readonly client: OAuth2Client;

  constructor(
    private readonly db: Db,
    private readonly clientId: string,
  ) {
    this.client = new OAuth2Client(clientId);
  }

  /**
   * Verify a Google ID token (from chrome.identity or redirect flow),
   * upsert user by email, and return the user document.
   * Throws 401 for invalid/expired/wrong-audience tokens.
   */
  async verifyIdToken(idToken: string): Promise<User> {
    let email: string;
    let name: string | null;
    let picture: string | null;

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) {
        throw new Error('No email in token payload');
      }
      email = payload.email;
      name = payload.name ?? null;
      picture = payload.picture ?? null;
    } catch (cause) {
      throw Object.assign(new Error('Invalid Google ID token'), {
        statusCode: 401,
        cause,
      });
    }

    const now = new Date();
    const result = await this.db.collection<User>('users').findOneAndUpdate(
      { email },
      {
        $set: { name, picture, updatedAt: now },
        $addToSet: { authProviders: 'google' as const },
        $setOnInsert: { email, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );

    if (!result) {
      throw Object.assign(new Error('Failed to upsert user'), { statusCode: 500 });
    }

    return result as unknown as User;
  }
}
