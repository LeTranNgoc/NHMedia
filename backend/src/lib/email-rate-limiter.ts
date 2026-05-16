import Redis from 'ioredis';

/**
 * Async rate-limiter interface. Both backends share this signature so the
 * route layer doesn't need to know which one is in play.
 */
export interface RateLimiter {
  check(key: string): Promise<boolean>;
  reset(): Promise<void>;
}

/**
 * Simple in-memory per-key rate limiter. Used in dev/test, and as the
 * default in single-instance prod when REDIS_URL is empty.
 *
 * NOT safe across multiple backend processes — they each hold their own
 * counts. Switch to Redis the moment you scale past one Fly machine OR
 * after a service-worker-restart-style cold-start could let an abuser
 * race the counter back to zero (the original "in-memory survives a
 * restart" complaint from deployment-guide §9).
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly timeWindowMs: number,
  ) {}

  async check(key: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.counts.get(key);

    if (!entry || now >= entry.resetAt) {
      this.counts.set(key, { count: 1, resetAt: now + this.timeWindowMs });
      return true;
    }

    if (entry.count >= this.max) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  async reset(): Promise<void> {
    this.counts.clear();
  }
}

/**
 * Redis-backed rate limiter. Uses INCR + EXPIRE-on-first-set so the count
 * key auto-expires at the end of the window.
 *
 * Key shape: `rl:email:<sha256-of-email>` — we don't store the raw email so
 * Redis read-only access via dashboards can't enumerate user emails.
 *
 * Hash is done lazily inside the limiter so callers stay clean (pass raw
 * email/IP keys, get backend-agnostic limiting).
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly windowSec: number;

  constructor(
    private readonly redis: Redis,
    private readonly max: number,
    timeWindowMs: number,
    private readonly keyPrefix: string = 'rl:email',
  ) {
    this.windowSec = Math.max(1, Math.floor(timeWindowMs / 1000));
  }

  async check(key: string): Promise<boolean> {
    const redisKey = await this.redisKey(key);
    // Pipeline INCR + EXPIRE in one round trip. EXPIRE is only set on first
    // INCR (when the key transitions from missing to 1).
    const pipeline = this.redis.multi();
    pipeline.incr(redisKey);
    pipeline.expire(redisKey, this.windowSec, 'NX');
    const results = await pipeline.exec();
    if (!results) return true; // exec returned null — connection issue, fail open

    const count = results[0]?.[1] as number | undefined;
    if (typeof count !== 'number') return true;
    return count <= this.max;
  }

  async reset(): Promise<void> {
    // Used by tests — scan + delete keys with our prefix.
    const stream = this.redis.scanStream({ match: `${this.keyPrefix}:*`, count: 100 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await this.redis.del(...keys);
    }
  }

  private async redisKey(key: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
    return `${this.keyPrefix}:${hash}`;
  }
}

/**
 * Factory — returns InMemoryRateLimiter when redisUrl is empty, else builds
 * a RedisRateLimiter against the live connection.
 *
 * The same backend instance is reused across requests (per-process), so the
 * Redis client only opens one connection. Caller owns lifecycle if it needs
 * to close — for now the connection lives for the lifetime of the process.
 */
export function createEmailRateLimiter(opts: {
  redisUrl?: string;
  max: number;
  timeWindowMs: number;
}): RateLimiter {
  if (opts.redisUrl) {
    const redis = new Redis(opts.redisUrl, {
      // Don't kill the boot if Redis is briefly unreachable — INCR will retry
      // on the next request via ioredis's default reconnect.
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
    return new RedisRateLimiter(redis, opts.max, opts.timeWindowMs);
  }
  return new InMemoryRateLimiter(opts.max, opts.timeWindowMs);
}

/** @deprecated Use {@link RateLimiter} interface or {@link InMemoryRateLimiter}. */
export const EmailRateLimiter = InMemoryRateLimiter;
export type EmailRateLimiter = InMemoryRateLimiter;
