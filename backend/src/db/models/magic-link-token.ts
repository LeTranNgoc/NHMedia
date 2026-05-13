import type { Collection, Db, ObjectId } from 'mongodb';

export interface MagicLinkToken {
  _id: ObjectId;
  /** sha256 hex of the raw token — never store raw */
  tokenHash: string;
  email: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
  /** Chrome extension ID — present when magic link was requested from the extension */
  extensionId?: string;
}

export type MagicLinkTokenInsert = Omit<MagicLinkToken, '_id'>;

export function magicLinkTokensCollection(db: Db): Collection<MagicLinkToken> {
  return db.collection<MagicLinkToken>('magic_link_tokens');
}
