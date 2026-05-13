import { describe, it, expect } from 'vitest';
import { tokenHash } from '../lib/token-hash.js';
import { timeConstantCompare } from '../lib/time-constant-compare.js';

describe('tokenHash', () => {
  it('returns hex string of 64 chars (sha256)', () => {
    const h = tokenHash('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input same output', () => {
    expect(tokenHash('hello')).toBe(tokenHash('hello'));
  });

  it('different input → different hash', () => {
    expect(tokenHash('a')).not.toBe(tokenHash('b'));
  });
});

describe('timeConstantCompare', () => {
  it('returns true for equal strings', () => {
    expect(timeConstantCompare('abc', 'abc')).toBe(true);
  });

  it('returns false for unequal strings', () => {
    expect(timeConstantCompare('abc', 'xyz')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(timeConstantCompare('ab', 'abc')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timeConstantCompare('', '')).toBe(true);
    expect(timeConstantCompare('', 'a')).toBe(false);
  });
});
