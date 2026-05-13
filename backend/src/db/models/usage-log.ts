import type { Collection, Db, ObjectId } from 'mongodb';

/**
 * Daily usage tracker — TTL index removes documents after 7 days.
 * secondsCaptured is incremented via $inc from UsageTracker.flush().
 */
export interface UsageLog {
  _id: ObjectId;
  userId: ObjectId;
  /** ISO date string YYYY-MM-DD UTC for grouping */
  date: string;
  /** Total seconds of audio captured today — updated via $inc */
  secondsCaptured: number;
  createdAt: Date;
}

export type UsageLogInsert = Omit<UsageLog, '_id'>;

export function usageLogCollection(db: Db): Collection<UsageLog> {
  return db.collection<UsageLog>('usage_log');
}
