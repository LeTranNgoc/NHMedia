import { OAuth2Client } from 'google-auth-library';
import type { Db } from 'mongodb';
import type { User } from '../db/models/user.js';

export class GoogleOAuthService {
  private readonly client: OAuth2Client;

  constructor(
    private readonly db: Db,
    private readonly clientId: string,
    clientSecret: string = '',
    redirectUri: string = '',
  ) {
    this.client = new OAuth2Client(clientId, clientSecret, redirectUri);
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

    return this.upsertUser(email, name, picture);
  }

  /**
   * Build the Google OAuth authorization URL for the extension flow.
   * @param state - Signed state string (contains extensionId + CSRF token)
   */
  buildAuthUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      // prompt=select_account ensures Google shows account picker even if signed in
      prompt: 'select_account',
    });
  }

  /**
   * Exchange an OAuth authorization code for tokens, verify the ID token,
   * upsert user, and return the user document.
   * Throws 401 on any verification failure.
   */
  async exchangeCode(code: string): Promise<User> {
    let email: string;
    let name: string | null;
    let picture: string | null;

    try {
      const { tokens } = await this.client.getToken(code);
      if (!tokens.id_token) {
        throw new Error('No id_token in code exchange response');
      }
      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
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
      throw Object.assign(new Error('Google OAuth code exchange failed'), {
        statusCode: 401,
        cause,
      });
    }

    return this.upsertUser(email, name, picture);
  }

  private async upsertUser(
    email: string,
    name: string | null,
    picture: string | null,
  ): Promise<User> {
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
