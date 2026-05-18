import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';

const MAX_ENTRIES = 200;
/** Hard cap on each audio entry — 256 KB covers ~10s of MP3 at 32 kbps,
 *  longer than any individual translation chunk. Larger payloads bypass
 *  cache (don't trip LRU memory budget for outliers). */
const MAX_ENTRY_BYTES = 256 * 1024;

export interface CachedTtsEntry {
  audio: Buffer;
  format: 'mp3' | 'opus';
}

/**
 * TtsCache — per-session LRU for synthesized speech.
 * Key = sha256(text + lang + gender). Repeated phrases (intros, outros,
 * recurring catchphrases) skip the upstream TTS API call entirely — saves
 * Cloud TTS quota AND removes the ~300-500ms synthesis hop for cache hits.
 */
export class TtsCache {
  private readonly cache: LRUCache<string, CachedTtsEntry>;

  constructor(maxSize = MAX_ENTRIES) {
    this.cache = new LRUCache<string, CachedTtsEntry>({ max: maxSize });
  }

  get(text: string, lang: string, gender: string): CachedTtsEntry | undefined {
    return this.cache.get(this._key(text, lang, gender));
  }

  set(text: string, lang: string, gender: string, entry: CachedTtsEntry): void {
    if (entry.audio.byteLength > MAX_ENTRY_BYTES) return;
    this.cache.set(this._key(text, lang, gender), entry);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private _key(text: string, lang: string, gender: string): string {
    return createHash('sha256').update(`${text}\x00${lang}\x00${gender}`).digest('hex');
  }
}
