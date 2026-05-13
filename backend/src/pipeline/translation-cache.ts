import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';

const MAX_ENTRIES = 1000;

/**
 * TranslationCache — per-session LRU cache (max 1000 entries).
 * Key = sha256(srcText + srcLang) so same text in different source langs are distinct.
 */
export class TranslationCache {
  private readonly cache: LRUCache<string, string>;

  constructor(maxSize = MAX_ENTRIES) {
    this.cache = new LRUCache<string, string>({ max: maxSize });
  }

  get(srcText: string, srcLang: string): string | undefined {
    return this.cache.get(this._key(srcText, srcLang));
  }

  set(srcText: string, srcLang: string, translated: string): void {
    this.cache.set(this._key(srcText, srcLang), translated);
  }

  has(srcText: string, srcLang: string): boolean {
    return this.cache.has(this._key(srcText, srcLang));
  }

  /** Clear all entries — call on session close to free memory. */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private _key(srcText: string, srcLang: string): string {
    // '\x00' separator prevents ("abc","de") colliding with ("abcd","e")
    return createHash('sha256').update(srcText + '\x00' + srcLang).digest('hex');
  }
}
