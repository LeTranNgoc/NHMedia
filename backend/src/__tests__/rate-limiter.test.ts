import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  RedisRateLimiter,
  createEmailRateLimiter,
} from '../lib/email-rate-limiter.js';

// ── InMemoryRateLimiter ──────────────────────────────────────────────────────
describe('InMemoryRateLimiter', () => {
  it('allows up to max requests inside the window', async () => {
    const rl = new InMemoryRateLimiter(3, 60_000);
    expect(await rl.check('a@b.com')).toBe(true);
    expect(await rl.check('a@b.com')).toBe(true);
    expect(await rl.check('a@b.com')).toBe(true);
    expect(await rl.check('a@b.com')).toBe(false);
  });

  it('keys are independent', async () => {
    const rl = new InMemoryRateLimiter(1, 60_000);
    expect(await rl.check('a@b.com')).toBe(true);
    expect(await rl.check('a@b.com')).toBe(false);
    expect(await rl.check('c@d.com')).toBe(true);
  });

  it('reset clears all counters', async () => {
    const rl = new InMemoryRateLimiter(1, 60_000);
    await rl.check('a@b.com');
    expect(await rl.check('a@b.com')).toBe(false);
    await rl.reset();
    expect(await rl.check('a@b.com')).toBe(true);
  });

  it('window expiry: after timeWindowMs the counter resets', async () => {
    vi.useFakeTimers();
    const rl = new InMemoryRateLimiter(1, 1000);
    await rl.check('a@b.com');
    expect(await rl.check('a@b.com')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(await rl.check('a@b.com')).toBe(true);
    vi.useRealTimers();
  });
});

// ── RedisRateLimiter ──────────────────────────────────────────────────────────
describe('RedisRateLimiter', () => {
  const mockExec = vi.fn();
  const mockMulti = vi.fn().mockReturnValue({
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: mockExec,
  });
  const mockRedis = {
    multi: mockMulti,
    scanStream: vi.fn(),
    del: vi.fn(),
  } as unknown as import('ioredis').default;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows when INCR result <= max', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    const rl = new RedisRateLimiter(mockRedis, 5, 60_000);
    expect(await rl.check('a@b.com')).toBe(true);
  });

  it('rejects when INCR result > max', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 6],
      [null, 0],
    ]);
    const rl = new RedisRateLimiter(mockRedis, 5, 60_000);
    expect(await rl.check('a@b.com')).toBe(false);
  });

  it('fails open when Redis pipeline returns null (connection issue)', async () => {
    mockExec.mockResolvedValueOnce(null);
    const rl = new RedisRateLimiter(mockRedis, 5, 60_000);
    // Better to let the user through than break sign-up entirely on Redis blip.
    expect(await rl.check('a@b.com')).toBe(true);
  });

  it('hashes the key — Redis sees a SHA prefix, not the raw email', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    const incrFn = vi.fn().mockReturnThis();
    const expireFn = vi.fn().mockReturnThis();
    mockMulti.mockReturnValueOnce({
      incr: incrFn,
      expire: expireFn,
      exec: mockExec,
    });

    const rl = new RedisRateLimiter(mockRedis, 5, 60_000);
    await rl.check('userprivacy@example.com');

    const incrKey = incrFn.mock.calls[0][0] as string;
    expect(incrKey).toMatch(/^rl:email:[0-9a-f]{32}$/);
    expect(incrKey).not.toContain('userprivacy');
    expect(incrKey).not.toContain('@example.com');
  });
});

// ── Factory ──────────────────────────────────────────────────────────────────
describe('createEmailRateLimiter', () => {
  it('returns InMemoryRateLimiter when redisUrl is empty', () => {
    const rl = createEmailRateLimiter({ redisUrl: '', max: 5, timeWindowMs: 60_000 });
    expect(rl).toBeInstanceOf(InMemoryRateLimiter);
  });

  it('returns InMemoryRateLimiter when redisUrl is omitted', () => {
    const rl = createEmailRateLimiter({ max: 5, timeWindowMs: 60_000 });
    expect(rl).toBeInstanceOf(InMemoryRateLimiter);
  });
});
