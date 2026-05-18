import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';

const MAX_ENTRIES = 1000;

/**
 * TranslationCache — per-session LRU. Key = sha256(normalized srcText +
 * srcLang + targetLang). Whitespace-normalized so " Hello  world " hits
 * the same entry as "Hello world"; case + punctuation preserved so proper
 * nouns and meaningful punctuation aren't conflated.
 */
export class TranslationCache {
  private readonly cache: LRUCache<string, string>;

  constructor(maxSize = MAX_ENTRIES) {
    this.cache = new LRUCache<string, string>({ max: maxSize });
  }

  get(srcText: string, srcLang: string, targetLang = 'vi'): string | undefined {
    return this.cache.get(this._key(srcText, srcLang, targetLang));
  }

  set(srcText: string, srcLang: string, translated: string, targetLang = 'vi'): void {
    this.cache.set(this._key(srcText, srcLang, targetLang), translated);
  }

  has(srcText: string, srcLang: string, targetLang = 'vi'): boolean {
    return this.cache.has(this._key(srcText, srcLang, targetLang));
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private _key(srcText: string, srcLang: string, targetLang: string): string {
    // '\x00' separator prevents ("abc","de") colliding with ("abcd","e").
    // targetLang in key so EN→KO doesn't get EN→VI cached entry.
    const normalized = srcText.trim().replace(/\s+/g, ' ');
    return createHash('sha256')
      .update(normalized + '\x00' + srcLang + '\x00' + targetLang)
      .digest('hex');
  }
}
