import { describe, it, expect } from 'vitest';
import { TranslationCache } from '../translation-cache.js';

describe('TranslationCache', () => {
  it('same text + same lang → cache hit', () => {
    const cache = new TranslationCache();
    cache.set('hello', 'en', 'xin chào');
    expect(cache.get('hello', 'en')).toBe('xin chào');
  });

  it('same text + different lang → cache miss', () => {
    const cache = new TranslationCache();
    cache.set('hello', 'en', 'xin chào');
    expect(cache.get('hello', 'ja')).toBeUndefined();
  });

  it('has() returns true for cached entry', () => {
    const cache = new TranslationCache();
    cache.set('test', 'en', 'kiểm tra');
    expect(cache.has('test', 'en')).toBe(true);
  });

  it('has() returns false for missing entry', () => {
    const cache = new TranslationCache();
    expect(cache.has('missing', 'en')).toBe(false);
  });

  it('eviction at maxSize + 1 entry', () => {
    const cache = new TranslationCache(3); // small max for test
    cache.set('a', 'en', 'A');
    cache.set('b', 'en', 'B');
    cache.set('c', 'en', 'C');
    expect(cache.size).toBe(3);

    // Adding 4th entry evicts oldest (LRU)
    cache.set('d', 'en', 'D');
    expect(cache.size).toBe(3);
    // 'd' must be present
    expect(cache.get('d', 'en')).toBe('D');
  });

  it('eviction at 1001 entries with default max', () => {
    const cache = new TranslationCache(1000);
    for (let i = 0; i < 1000; i++) {
      cache.set(`text-${i}`, 'en', `translation-${i}`);
    }
    expect(cache.size).toBe(1000);

    // 1001st entry triggers eviction
    cache.set('text-1001', 'en', 'translation-1001');
    expect(cache.size).toBe(1000);
  });

  it('clear() removes all entries', () => {
    const cache = new TranslationCache();
    cache.set('foo', 'en', 'bar');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('foo', 'en')).toBeUndefined();
  });

  it('different texts with same lang are independent entries', () => {
    const cache = new TranslationCache();
    cache.set('hello', 'en', 'xin chào');
    cache.set('world', 'en', 'thế giới');
    expect(cache.get('hello', 'en')).toBe('xin chào');
    expect(cache.get('world', 'en')).toBe('thế giới');
  });

  it('no key collision between ("abc","de") and ("abcd","e")', () => {
    const cache = new TranslationCache();
    cache.set('abc', 'de', 'translation-A');
    cache.set('abcd', 'e', 'translation-B');
    // Both must be independently retrievable
    expect(cache.get('abc', 'de')).toBe('translation-A');
    expect(cache.get('abcd', 'e')).toBe('translation-B');
    // And neither leaks into the other
    expect(cache.get('abc', 'de')).not.toBe('translation-B');
    expect(cache.get('abcd', 'e')).not.toBe('translation-A');
  });
});
