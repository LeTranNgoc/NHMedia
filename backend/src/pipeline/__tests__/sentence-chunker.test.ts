import { describe, it, expect } from 'vitest';
import { SentenceChunker } from '../sentence-chunker.js';

describe('SentenceChunker', () => {
  const chunker = new SentenceChunker();

  describe('English (LTR)', () => {
    it('"Hello. How are you?" → ["Hello.", "How are you?"]', () => {
      const result = chunker.chunk('Hello. How are you?', 'en');
      expect(result).toEqual(['Hello.', 'How are you?']);
    });

    it('single sentence with no punctuation → single chunk', () => {
      const result = chunker.chunk('This is a sentence', 'en');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('This is a sentence');
    });

    it('multiple sentences split correctly', () => {
      // Each segment must be >= MIN_CHUNK (5) chars to survive normalization
      const result = chunker.chunk('First sentence. Second one! Third here?', 'en');
      expect(result).toEqual(['First sentence.', 'Second one!', 'Third here?']);
    });

    it('long sentence > 200 chars → split at nearest comma or whitespace', () => {
      const long = 'a'.repeat(80) + ', ' + 'b'.repeat(80) + ', ' + 'c'.repeat(80);
      const result = chunker.chunk(long, 'en');
      expect(result.length).toBeGreaterThan(1);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('Japanese', () => {
    it('今日は晴れです。明日は雨です。 → 2 chunks', () => {
      const result = chunker.chunk('今日は晴れです。明日は雨です。', 'ja');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('今日は晴れです');
      expect(result[1]).toContain('明日は雨です');
    });

    it('splits on ！ and ？ as well', () => {
      const result = chunker.chunk('本当ですか？はい、そうです！', 'ja');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Korean', () => {
    it('안녕하세요. 반갑습니다. → 2 chunks', () => {
      const result = chunker.chunk('안녕하세요. 반갑습니다.', 'ko');
      expect(result).toHaveLength(2);
    });

    it('splits on ! and ? for Korean too', () => {
      // Each segment must be >= MIN_CHUNK (5) chars; use longer phrases
      const result = chunker.chunk('정말 그렇습니까? 맞아요 확실히!', 'ko');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('empty string → []', () => {
      expect(chunker.chunk('', 'en')).toEqual([]);
    });

    it('only whitespace → []', () => {
      expect(chunker.chunk('   ', 'en')).toEqual([]);
    });

    it('only punctuation "..." → [] (no letter/digit)', () => {
      expect(chunker.chunk('...', 'en')).toEqual([]);
    });

    it('short standalone utterances are kept (real-world "Yes." / "OK!" speech)', () => {
      // Standalone short utterances are meaningful — must not be silently dropped.
      expect(chunker.chunk('Yes.', 'en')).toEqual(['Yes.']);
      expect(chunker.chunk('OK!', 'en')).toEqual(['OK!']);
    });

    it('trailing short chunks merge into previous', () => {
      // "How are you doing today? Yes." — "Yes." (4 chars) merges into prior.
      const result = chunker.chunk('How are you doing today? Yes.', 'en');
      expect(result).toEqual(['How are you doing today? Yes.']);
    });
  });
});
