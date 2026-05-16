import type { Collection, Db, ObjectId } from 'mongodb';

export interface User {
  _id: ObjectId;
  email: string;
  name: string | null;
  picture: string | null;
  authProviders: ('magic_link' | 'google')[];
  /** Hashed device fingerprints (IP + UA + extensionId) collected on sign-in.
   *  Used as a soft abuse signal — see `lib/fingerprint.ts`. Optional because
   *  existing rows pre-dating this feature won't have it. */
  fingerprints?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type UserInsert = Omit<User, '_id'>;

export function usersCollection(db: Db): Collection<User> {
  return db.collection<User>('users');
}
