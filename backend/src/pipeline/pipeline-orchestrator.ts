import type { WebSocket } from '@fastify/websocket';
import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';
import type { TranslateProvider } from '../providers/translate/translate-provider-interface.js';
import type { TTSProvider, SupportedLang } from '../providers/tts/tts-provider-interface.js';
import { TranscriptDebouncer } from './transcript-debouncer.js';
import { SentenceChunker } from './sentence-chunker.js';
import { TranslationCache } from './translation-cache.js';
import { AudioFrameEmitter } from './audio-frame-emitter.js';

const TTS_QUEUE_BACKPRESSURE_LIMIT = 3;

export interface PipelineOrchestratorOptions {
  socket: WebSocket;
  translateProvider: TranslateProvider;
  ttsProvider: TTSProvider;
  srcLang: string;
  /** Target translation language code. Defaults to 'vi' for backward compatibility. */
  targetLang?: string;
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
  private readonly translateProvider: TranslateProvider;
  private readonly ttsProvider: TTSProvider;
  private readonly srcLang: string;
  private readonly targetLang: string;

  /** Tracks how many TTS jobs are currently in flight */
  private ttsQueueDepth = 0;
  private destroyed = false;
  private readonly onTranslateComplete?: (chars: number) => void;
  private readonly onTtsComplete?: (chars: number) => void;

  constructor(opts: PipelineOrchestratorOptions) {
    this.emitter = new AudioFrameEmitter(opts.socket);
    this.translateProvider = opts.translateProvider;
    this.ttsProvider = opts.ttsProvider;
    this.srcLang = opts.srcLang;
    this.targetLang = opts.targetLang ?? 'vi';
    this.onTranslateComplete = opts.onTranslateComplete;
    this.onTtsComplete = opts.onTtsComplete;
    this.chunker = new SentenceChunker();
    this.cache = new TranslationCache();

    this.debouncer = new TranscriptDebouncer((text) => {
      void this._handleStableTranscript(text);
    });
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
    const chunkPreview = srcText.length > 40 ? srcText.slice(0, 40) + '...' : srcText;
    console.info(`[pipeline] chunk in: "${chunkPreview}" (${srcText.length} chars)`);

    // ── Translate (with cache) ───────────────────────────────────────────────
    let translatedText: string;

    const cached = this.cache.get(srcText, this.srcLang);
    if (cached !== undefined) {
      translatedText = cached;
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
        console.error(`[pipeline] translate_fail (${Date.now() - t0}ms): ${message}`);
        this.emitter.emitError('translate_fail', message);
        return;
      }

      if (!translatedText) {
        console.warn('[pipeline] translate returned empty string');
        this.emitter.emitError('translate_empty', 'Translation returned empty string');
        return;
      }

      this.cache.set(srcText, this.srcLang, translatedText);
      // Bill on INPUT chars to match Azure Translator / Cloud Translate pricing.
      this.onTranslateComplete?.(srcText.length);
    }

    this.emitter.emitTranslation(translatedText);

    if (this.ttsQueueDepth >= TTS_QUEUE_BACKPRESSURE_LIMIT) {
      console.warn(`[pipeline] tts_backpressure: queue=${this.ttsQueueDepth} — dropping`);
      this.emitter.emitError('tts_backpressure', 'TTS queue full — audio frame dropped');
      return;
    }

    // ── TTS ──────────────────────────────────────────────────────────────────
    this.ttsQueueDepth++;
    const t1 = Date.now();
    try {
      const { audio, format } = await this.ttsProvider.synthesize(translatedText, {
        lang: this.targetLang as SupportedLang,
        gender: 'female',
      });
      console.info(`[pipeline] tts: ${Date.now() - t1}ms → ${audio.length} bytes ${format}`);
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
