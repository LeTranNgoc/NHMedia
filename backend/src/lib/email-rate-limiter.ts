/**
 * Simple in-memory per-email rate limiter.
 * Used for /auth/magic-link/request endpoint.
 * Resets automatically after timeWindowMs.
 *
 * Note: In production with multiple instances, replace with Redis-backed store.
 */
export class EmailRateLimiter {
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly timeWindowMs: number,
  ) {}

  /**
   * Check if the given key is within limit.
   * Increments counter. Returns true if allowed, false if over limit.
   */
  check(key: string): boolean {
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

  /** Reset all counters — used in tests */
  reset(): void {
    this.counts.clear();
  }
}
