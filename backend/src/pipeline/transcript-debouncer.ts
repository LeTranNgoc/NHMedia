import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';

export type DebouncedTranscriptCallback = (text: string) => void;

/**
 * TranscriptDebouncer — collapses rapid interim ASR results into stable chunks.
 *
 * Rules:
 * - Interim: schedule emit after 300ms; reschedule if a new interim arrives within the window.
 * - isFinal=true: emit immediately, cancel any pending timer.
 * - Drop interims that are a substring of the previously emitted text (duplicate prevention).
 */
export class TranscriptDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmittedText = '';
  private readonly cb: DebouncedTranscriptCallback;

  constructor(cb: DebouncedTranscriptCallback) {
    this.cb = cb;
  }

  push(event: TranscriptEvent): void {
    const text = event.text.trim();
    if (!text) return;
    if (this.lastEmittedText && this.lastEmittedText.includes(text)) return;

    // Only emit on FINAL transcripts. Translating interims spammed Gemini at
    // ~3 RPS (well over the 20 RPM free-tier limit). Finals arrive every
    // 2-6s during continuous speech → ~10-30 RPM, fits the limit and adds
    // ~1s latency over interim-based translation. Worth the trade for free tier.
    if (event.isFinal) {
      this._cancelPending();
      this._emit(text);
    }
    // Interim: ignored (debouncer is now finals-only).
  }

  /** Cancel any pending timer and discard accumulated text. Call on session close. */
  flush(): void {
    this._cancelPending();
    this.lastEmittedText = '';
  }

  private _cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private _emit(text: string): void {
    if (!text) return;
    this.lastEmittedText = text;
    this.cb(text);
  }
}
