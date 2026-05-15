import type { Collection, Db, ObjectId } from 'mongodb';

/**
 * Daily usage tracker — TTL index removes documents after 7 days.
 * All numeric fields are incremented via $inc from UsageTracker.flush().
 * Old docs without translateCharsToday/ttsCharsToday read as undefined → treated as 0.
 */
export interface UsageLog {
  _id: ObjectId;
  userId: ObjectId;
  /** ISO date string YYYY-MM-DD UTC for grouping */
  date: string;
  /** Total seconds of audio captured today — updated via $inc */
  secondsCaptured: number;
  /** Total translated chars today — updated via $inc; absent on old docs (treat as 0) */
  translateCharsToday?: number;
  /** Total TTS chars today — updated via $inc; absent on old docs (treat as 0) */
  ttsCharsToday?: number;
  createdAt: Date;
}

export type UsageLogInsert = Omit<UsageLog, '_id'>;

export function usageLogCollection(db: Db): Collection<UsageLog> {
  return db.collection<UsageLog>('usage_log');
}
