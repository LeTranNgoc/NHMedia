import type { Collection, Db, ObjectId } from 'mongodb';

export interface User {
  _id: ObjectId;
  email: string;
  name: string | null;
  picture: string | null;
  authProviders: ('magic_link' | 'google')[];
  createdAt: Date;
  updatedAt: Date;
}

export type UserInsert = Omit<User, '_id'>;

export function usersCollection(db: Db): Collection<User> {
  return db.collection<User>('users');
}
