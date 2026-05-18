import type { WebSocket } from '@fastify/websocket';
import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';
import type { TranslateProvider } from '../providers/translate/translate-provider-interface.js';
import type { TTSProvider, SupportedLang } from '../providers/tts/tts-provider-interface.js';
import { TranscriptDebouncer } from './transcript-debouncer.js';
import { SentenceChunker } from './sentence-chunker.js';
import { TranslationCache } from './translation-cache.js';
import { TtsCache } from './tts-cache.js';
import { AudioFrameEmitter } from './audio-frame-emitter.js';

const TTS_QUEUE_BACKPRESSURE_LIMIT = 3;
const STATS_INTERVAL_MS = 30_000;

export interface PipelineOrchestratorOptions {
  socket: WebSocket;
  translateProvider: TranslateProvider;
  ttsProvider: TTSProvider;
  srcLang: string;
  /** Target translation language code. Defaults to 'vi' for backward compatibility. */
  targetLang?: string;
  /** When true, skip TTS synthesis entirely — only emit the translation text
   *  frame. Extension speaks it via browser speechSynthesis. Default false. */
  ttsDisabled?: boolean;
  /** Called after a successful translation with the char count of the translated text. */
  onTranslateComplete?: (chars: number) => void;
  /** Called after a successful TTS synthesis with the char count of the text fed to TTS. */
  onTtsComplete?: (chars: number) => void;
}

/**
 * PipelineOrchestrator — wires the full pipeline per WS session:
 * ASR transcript → debounce → chunk → cache-check → translate → TTS → emit frames.
 *
 * One instance per session. Call destroy() on WS close.
 */
export class PipelineOrchestrator {
  private readonly emitter: AudioFrameEmitter;
  private readonly debouncer: TranscriptDebouncer;
  private readonly chunker: SentenceChunker;
  private readonly cache: TranslationCache;
  private readonly ttsCache: TtsCache;
  private readonly translateProvider: TranslateProvider;
  private readonly ttsProvider: TTSProvider;
  private readonly srcLang: string;
  private readonly targetLang: string;
  private readonly ttsDisabled: boolean;

  /** Tracks how many TTS jobs are currently in flight */
  private ttsQueueDepth = 0;
  private destroyed = false;
  private readonly onTranslateComplete?: (chars: number) => void;
  private readonly onTtsComplete?: (chars: number) => void;

  /** Rolling counters reset each STATS_INTERVAL_MS — lets us see the actual
   *  fail-vs-success ratio at the source of truth, not from anecdote. */
  private stats = { chunks: 0, ok: 0, fail: 0, cacheHit: 0, empty: 0 };
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: PipelineOrchestratorOptions) {
    this.emitter = new AudioFrameEmitter(opts.socket);
    this.translateProvider = opts.translateProvider;
    this.ttsProvider = opts.ttsProvider;
    this.srcLang = opts.srcLang;
    this.targetLang = opts.targetLang ?? 'vi';
    this.ttsDisabled = opts.ttsDisabled ?? false;
    this.onTranslateComplete = opts.onTranslateComplete;
    this.onTtsComplete = opts.onTtsComplete;
    this.chunker = new SentenceChunker();
    this.cache = new TranslationCache();
    this.ttsCache = new TtsCache();

    this.debouncer = new TranscriptDebouncer((text) => {
      void this._handleStableTranscript(text);
    });

    // Skip in vitest fake-timer envs — the interval would loop forever under
    // vi.advanceTimersByTime. Tests don't observe pipeline stats anyway.
    if (process.env['NODE_ENV'] !== 'test') {
      this.statsTimer = setInterval(() => this._logStats(), STATS_INTERVAL_MS);
    }
  }

  private _logStats(): void {
    const s = this.stats;
    if (s.chunks === 0 && s.fail === 0 && s.cacheHit === 0 && s.empty === 0) return;
    console.info(
      `[pipeline] stats/${STATS_INTERVAL_MS / 1000}s: chunks=${s.chunks} ok=${s.ok} fail=${s.fail} cache=${s.cacheHit} empty=${s.empty}`,
    );
    this.stats = { chunks: 0, ok: 0, fail: 0, cacheHit: 0, empty: 0 };
  }

  /** Feed an ASR transcript event into the pipeline. */
  onTranscript(event: TranscriptEvent): void {
    if (this.destroyed) return;
    this.debouncer.push(event);
  }

  /** Clean up timers and caches. Call when the WS session closes. */
  destroy(): void {
    this.destroyed = true;
    this.debouncer.flush();
    this.cache.clear();
    this.ttsCache.clear();
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _handleStableTranscript(text: string): Promise<void> {
    if (this.destroyed) return;

    const chunks = this.chunker.chunk(text, this.srcLang);
    if (chunks.length === 0) return;

    for (const chunk of chunks) {
      if (this.destroyed) return;
      await this._processChunk(chunk);
    }
  }

  private async _processChunk(srcText: string): Promise<void> {
    this.stats.chunks++;
    const chunkPreview = srcText.length > 40 ? srcText.slice(0, 40) + '...' : srcText;
    console.info(`[pipeline] chunk in: "${chunkPreview}" (${srcText.length} chars)`);

    // ── Translate (with cache) ───────────────────────────────────────────────
    let translatedText: string;

    const cached = this.cache.get(srcText, this.srcLang);
    if (cached !== undefined) {
      translatedText = cached;
      this.stats.cacheHit++;
      console.info(`[pipeline] translate: cache hit`);
    } else {
      const t0 = Date.now();
      try {
        translatedText = await this.translateProvider.translate(
          srcText,
          this.srcLang,
          this.targetLang,
        );
        console.info(
          `[pipeline] translate: ${Date.now() - t0}ms → "${translatedText.slice(0, 40)}"`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.stats.fail++;
        console.error(`[pipeline] translate_fail (${Date.now() - t0}ms): ${message}`);
        this.emitter.emitError('translate_fail', message);
        return;
      }

      if (!translatedText) {
        this.stats.empty++;
        console.warn('[pipeline] translate returned empty string');
        this.emitter.emitError('translate_empty', 'Translation returned empty string');
        return;
      }

      this.stats.ok++;
      this.cache.set(srcText, this.srcLang, translatedText);
      // Bill on INPUT chars to match Azure Translator / Cloud Translate pricing.
      this.onTranslateComplete?.(srcText.length);
    }

    this.emitter.emitTranslation(translatedText);

    // Browser-native TTS path — extension speaks the translation locally via
    // speechSynthesis. Backend skips Cloud TTS entirely, saving char quota
    // and removing the audio-frame round-trip from the latency budget.
    if (this.ttsDisabled) return;

    if (this.ttsQueueDepth >= TTS_QUEUE_BACKPRESSURE_LIMIT) {
      console.warn(`[pipeline] tts_backpressure: queue=${this.ttsQueueDepth} — dropping`);
      this.emitter.emitError('tts_backpressure', 'TTS queue full — audio frame dropped');
      return;
    }

    // ── TTS ──────────────────────────────────────────────────────────────────
    this.ttsQueueDepth++;
    const t1 = Date.now();
    try {
      const lang = this.targetLang as SupportedLang;
      const gender = 'female';
      const cachedTts = this.ttsCache.get(translatedText, lang, gender);
      if (cachedTts) {
        console.info(
          `[pipeline] tts: cache hit (${cachedTts.audio.length} bytes ${cachedTts.format})`,
        );
        this.emitter.emitAudio(cachedTts.audio, cachedTts.format);
        // Don't double-bill on cache hits — caller already paid for the
        // synthesis the first time around.
        return;
      }
      const { audio, format } = await this.ttsProvider.synthesize(translatedText, {
        lang,
        gender,
      });
      console.info(`[pipeline] tts: ${Date.now() - t1}ms → ${audio.length} bytes ${format}`);
      this.ttsCache.set(translatedText, lang, gender, { audio, format });
      this.emitter.emitAudio(audio, format);
      this.onTtsComplete?.(translatedText.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] tts_fail (${Date.now() - t1}ms): ${message}`);
      this.emitter.emitError('tts_fail', message);
    } finally {
      this.ttsQueueDepth--;
    }
  }
}
