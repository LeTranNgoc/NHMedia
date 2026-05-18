const MIN_CHUNK = 5;
const MAX_CHUNK = 200;

// Build sentence-boundary regexes using new RegExp() with string patterns.
// Must use string literals (not regex literals) because esbuild 0.21 and Node native
// TS loaders both strip backslashes from regex literals (\s → s, \p → p).
// Using new RegExp with JS string escapes works correctly after transpilation.

function makeSplitRegex(extraPunct = ''): RegExp {
  // Whitespace character class — avoid \s which esbuild strips
  const ws = ' \\t\\r\\n\\f\\v';
  const punct = '.!?' + extraPunct;
  // Split: after sentence-ending punct, consume whitespace OR split before non-whitespace
  return new RegExp(`(?<=[${punct}])(?:[${ws}]+|(?=[^${ws}]))`);
}

function hasLetterOrDigit(s: string): boolean {
  // Use new RegExp to avoid esbuild stripping \p from regex literals
  return new RegExp('\\p{L}|\\p{N}', 'u').test(s);
}

const LTR_SPLIT = makeSplitRegex();
const JA_SPLIT = /(?<=[。！？])/;
const KO_SPLIT = makeSplitRegex('。');

/**
 * SentenceChunker — splits a text block into sentence-sized chunks suitable for TTS.
 *
 * Language routing:
 *  - 'ja'        → split on 。！？
 *  - 'ko'        → split on .!?。 + Western punctuation
 *  - all others  → split on [.!?] followed by whitespace or next sentence start
 *
 * Post-split: merge chunks < MIN_CHUNK chars with previous chunk;
 * split chunks > MAX_CHUNK at nearest comma or whitespace.
 */
export class SentenceChunker {
  chunk(text: string, srcLang: string): string[] {
    if (!text.trim()) return [];

    const raw = this._split(text, srcLang);
    return this._normalize(raw);
  }

  private _split(text: string, srcLang: string): string[] {
    let parts: string[];

    if (srcLang === 'ja') {
      parts = text.split(JA_SPLIT);
    } else if (srcLang === 'ko') {
      parts = text.split(KO_SPLIT);
    } else {
      parts = text.split(LTR_SPLIT);
    }

    return parts.map((s) => s.trim()).filter(Boolean);
  }

  private _normalize(parts: string[]): string[] {
    const result: string[] = [];

    for (const part of parts) {
      if (part.length <= MAX_CHUNK) {
        if (part.length < MIN_CHUNK && result.length > 0) {
          result[result.length - 1] += ' ' + part;
        } else {
          result.push(part);
        }
      } else {
        const sub = this._splitLong(part);
        result.push(...sub);
      }
    }

    // Filter noise: must contain a letter or digit. Short utterances ("Yes.",
    // "OK!", "Go.") are kept — MIN_CHUNK only governs merging into neighbors.
    return result.filter((s) => hasLetterOrDigit(s));
  }

  private _splitLong(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > MAX_CHUNK) {
      let cutAt = remaining.lastIndexOf(',', MAX_CHUNK);
      if (cutAt < MIN_CHUNK) {
        cutAt = remaining.lastIndexOf(' ', MAX_CHUNK);
      }
      if (cutAt < MIN_CHUNK) {
        cutAt = MAX_CHUNK;
      }
      chunks.push(remaining.slice(0, cutAt + 1).trim());
      remaining = remaining.slice(cutAt + 1).trim();
    }

    if (remaining.length >= MIN_CHUNK) {
      chunks.push(remaining);
    }

    return chunks;
  }
}
