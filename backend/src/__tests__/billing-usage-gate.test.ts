import { describe, it, expect, vi } from 'vitest';
import { checkUsageGate } from '../middleware/usage-gate-middleware.js';
import type { UsageTracker } from '../lib/usage-tracker.js';

function makeTracker(overrides: {
  tier?: 'free' | 'pro';
  today?: number;
}): UsageTracker {
  return {
    getTier: vi.fn().mockResolvedValue(overrides.tier ?? 'free'),
    getToday: vi.fn().mockResolvedValue(overrides.today ?? 0),
    getLimit: vi.fn().mockImplementation((t: string) => (t === 'free' ? 900 : null)),
    tick: vi.fn(),
    flush: vi.fn(),
  } as unknown as UsageTracker;
}

describe('checkUsageGate', () => {
  it('allows free user with 800s used', async () => {
    const tracker = makeTracker({ tier: 'free', today: 800 });
    const result = await checkUsageGate('user_001', tracker);

    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('free');
    expect(result.secondsRemaining).toBe(100);
    expect(result.reason).toBeUndefined();
  });

  it('rejects free user at exactly 900s (quota_exceeded)', async () => {
    const tracker = makeTracker({ tier: 'free', today: 900 });
    const result = await checkUsageGate('user_002', tracker);

    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('free');
    expect(result.secondsRemaining).toBe(0);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('rejects free user over 900s', async () => {
    const tracker = makeTracker({ tier: 'free', today: 950 });
    const result = await checkUsageGate('user_003', tracker);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('allows free user with 0s used', async () => {
    const tracker = makeTracker({ tier: 'free', today: 0 });
    const result = await checkUsageGate('user_004', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBe(900);
  });

  it('allows pro user regardless of usage (10000s)', async () => {
    const tracker = makeTracker({ tier: 'pro', today: 10000 });
    const result = await checkUsageGate('user_005', tracker);

    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('pro');
    expect(result.secondsRemaining).toBeNull();
    expect(result.reason).toBeUndefined();
  });

  it('allows pro user with 0s used', async () => {
    const tracker = makeTracker({ tier: 'pro', today: 0 });
    const result = await checkUsageGate('user_006', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBeNull();
  });

  it('boundary: free user with 899s is allowed, 1s remaining', async () => {
    const tracker = makeTracker({ tier: 'free', today: 899 });
    const result = await checkUsageGate('user_007', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBe(1);
  });

  it('does not call getToday for pro user (skips unnecessary DB read)', async () => {
    const tracker = makeTracker({ tier: 'pro', today: 0 });
    await checkUsageGate('user_008', tracker);

    // getTier called, getToday NOT called (limit is null → early return)
    expect(tracker.getTier).toHaveBeenCalledWith('user_008');
    expect(tracker.getToday).not.toHaveBeenCalled();
  });
});
