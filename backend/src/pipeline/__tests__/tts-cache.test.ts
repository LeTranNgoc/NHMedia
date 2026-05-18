import { describe, it, expect } from 'vitest';
import { TtsCache } from '../tts-cache.js';

function makeEntry(size = 16): { audio: Buffer; format: 'mp3' } {
  return { audio: Buffer.alloc(size, 0xaa), format: 'mp3' };
}

describe('TtsCache', () => {
  it('returns undefined on miss', () => {
    const c = new TtsCache();
    expect(c.get('xin chao', 'vi', 'female')).toBeUndefined();
  });

  it('round-trips an entry on hit', () => {
    const c = new TtsCache();
    const entry = makeEntry(32);
    c.set('xin chao', 'vi', 'female', entry);
    const hit = c.get('xin chao', 'vi', 'female');
    expect(hit?.audio).toBe(entry.audio);
    expect(hit?.format).toBe('mp3');
  });

  it('keys differ by lang and gender', () => {
    const c = new TtsCache();
    const vi = makeEntry(16);
    const en = makeEntry(24);
    c.set('hello', 'vi', 'female', vi);
    c.set('hello', 'en', 'female', en);
    expect(c.get('hello', 'vi', 'female')?.audio.length).toBe(16);
    expect(c.get('hello', 'en', 'female')?.audio.length).toBe(24);
    expect(c.get('hello', 'vi', 'male')).toBeUndefined();
  });

  it('skips entries larger than MAX_ENTRY_BYTES', () => {
    const c = new TtsCache();
    const huge = makeEntry(300 * 1024); // > 256 KB cap
    c.set('big', 'vi', 'female', huge);
    expect(c.get('big', 'vi', 'female')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('evicts oldest when capacity exceeded', () => {
    const c = new TtsCache(2);
    c.set('a', 'vi', 'female', makeEntry(8));
    c.set('b', 'vi', 'female', makeEntry(8));
    c.set('c', 'vi', 'female', makeEntry(8));
    expect(c.get('a', 'vi', 'female')).toBeUndefined();
    expect(c.get('b', 'vi', 'female')).toBeDefined();
    expect(c.get('c', 'vi', 'female')).toBeDefined();
  });

  it('clear() empties the cache', () => {
    const c = new TtsCache();
    c.set('x', 'vi', 'female', makeEntry());
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('x', 'vi', 'female')).toBeUndefined();
  });
});
