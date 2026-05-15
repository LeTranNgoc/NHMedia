import { describe, it, expect, vi } from 'vitest';
import { checkUsageGate } from '../middleware/usage-gate-middleware.js';
import type { UsageTracker, UsageTotals, UsageLimits } from '../lib/usage-tracker.js';

function makeTracker(overrides: {
  tier?: 'free' | 'pro';
  today?: Partial<UsageTotals>;
}): UsageTracker {
  const todayDefaults: UsageTotals = {
    seconds: overrides.today?.seconds ?? 0,
    translateChars: overrides.today?.translateChars ?? 0,
    ttsChars: overrides.today?.ttsChars ?? 0,
  };
  const tier = overrides.tier ?? 'free';
  const limits: UsageLimits =
    tier === 'free'
      ? { seconds: 900, translateChars: 50000, ttsChars: 50000 }
      : { seconds: null, translateChars: null, ttsChars: null };

  return {
    getTier: vi.fn().mockResolvedValue(tier),
    getToday: vi.fn().mockResolvedValue(todayDefaults),
    getLimit: vi.fn().mockReturnValue(limits),
    tick: vi.fn(),
    flush: vi.fn(),
  } as unknown as UsageTracker;
}

describe('checkUsageGate', () => {
  it('allows free user with 800s used', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 800 } });
    const result = await checkUsageGate('user_001', tracker);

    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('free');
    expect(result.secondsRemaining).toBe(100);
    expect(result.reason).toBeUndefined();
  });

  it('rejects free user at exactly 900s (quota_exceeded)', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 900 } });
    const result = await checkUsageGate('user_002', tracker);

    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('free');
    expect(result.secondsRemaining).toBe(0);
    expect(result.reason).toBe('quota_exceeded');
    expect(result.kindExceeded).toContain('seconds');
  });

  it('rejects free user over 900s', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 950 } });
    const result = await checkUsageGate('user_003', tracker);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('allows free user with 0s used', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 0 } });
    const result = await checkUsageGate('user_004', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBe(900);
  });

  it('allows pro user regardless of usage (10000s)', async () => {
    const tracker = makeTracker({ tier: 'pro', today: { seconds: 10000 } });
    const result = await checkUsageGate('user_005', tracker);

    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('pro');
    expect(result.secondsRemaining).toBeNull();
    expect(result.reason).toBeUndefined();
  });

  it('allows pro user with 0s used', async () => {
    const tracker = makeTracker({ tier: 'pro', today: { seconds: 0 } });
    const result = await checkUsageGate('user_006', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBeNull();
  });

  it('boundary: free user with 899s is allowed, 1s remaining', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 899 } });
    const result = await checkUsageGate('user_007', tracker);

    expect(result.allowed).toBe(true);
    expect(result.secondsRemaining).toBe(1);
  });

  it('does not call getToday for pro user (skips unnecessary DB read)', async () => {
    const tracker = makeTracker({ tier: 'pro', today: { seconds: 0 } });
    await checkUsageGate('user_008', tracker);

    // getTier called, getToday NOT called (all limits null → early return)
    expect(tracker.getTier).toHaveBeenCalledWith('user_008');
    expect(tracker.getToday).not.toHaveBeenCalled();
  });

  it('rejects free user when translateChars cap exceeded', async () => {
    const tracker = makeTracker({ tier: 'free', today: { translateChars: 50001 } });
    const result = await checkUsageGate('user_009', tracker);

    expect(result.allowed).toBe(false);
    expect(result.kindExceeded).toContain('translateChars');
    expect(result.reason).toBe('quota_exceeded');
  });

  it('rejects free user when multiple kinds exceeded', async () => {
    const tracker = makeTracker({ tier: 'free', today: { seconds: 900, translateChars: 50001 } });
    const result = await checkUsageGate('user_010', tracker);

    expect(result.allowed).toBe(false);
    expect(result.kindExceeded).toContain('seconds');
    expect(result.kindExceeded).toContain('translateChars');
  });
});
