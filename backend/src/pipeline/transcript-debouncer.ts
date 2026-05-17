import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';

export type DebouncedTranscriptCallback = (text: string) => void;

const INTERIM_DEBOUNCE_MS = 400;

/**
 * TranscriptDebouncer — collapses rapid interim ASR results into stable chunks.
 *
 * Rules:
 * - Interim: schedule emit after INTERIM_DEBOUNCE_MS; reschedule on each new
 *   interim so we only translate the latest stable phrase. Cancelled when a
 *   final arrives in the same window.
 * - isFinal=true: emit immediately, cancel any pending timer.
 * - Drop a new emit if its text is already a substring of the last emitted
 *   text (avoid re-translating a phrase that was already a final).
 *
 * Trade-off: emitting interims = more translate RPS. Azure F0 (2M chars/hour)
 * handles it fine. Gemini free tier (20 RPM) will throttle — switch
 * TRANSLATE_PROVIDER=azure when running with interim emits.
 */
export class TranscriptDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingText = '';
  private lastEmittedText = '';
  private readonly cb: DebouncedTranscriptCallback;

  constructor(cb: DebouncedTranscriptCallback) {
    this.cb = cb;
  }

  push(event: TranscriptEvent): void {
    const text = event.text.trim();
    if (!text) return;
    if (this.lastEmittedText && this.lastEmittedText.includes(text)) return;

    if (event.isFinal) {
      this._cancelPending();
      this._emit(text);
      return;
    }

    // Interim: hold the latest text, debounce-emit after the window. If a
    // newer interim arrives in the window, replace + reset the timer.
    this.pendingText = text;
    this._cancelPending();
    this.timer = setTimeout(() => {
      this.timer = null;
      const candidate = this.pendingText;
      this.pendingText = '';
      if (candidate && !this.lastEmittedText.includes(candidate)) {
        this._emit(candidate);
      }
    }, INTERIM_DEBOUNCE_MS);
  }

  /** Cancel any pending timer and discard accumulated text. Call on session close. */
  flush(): void {
    this._cancelPending();
    this.pendingText = '';
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
