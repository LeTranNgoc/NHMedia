import type { Collection, Db, ObjectId } from 'mongodb';

export interface Session {
  _id: ObjectId;
  userId: ObjectId;
  /** Opaque session identifier stored client-side (hashed before storage) */
  sessionHash: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export type SessionInsert = Omit<Session, '_id'>;

export function sessionsCollection(db: Db): Collection<Session> {
  return db.collection<Session>('sessions');
}
