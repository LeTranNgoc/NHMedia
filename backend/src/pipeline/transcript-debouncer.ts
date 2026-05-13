import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';

const DEBOUNCE_MS = 300;

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
  private pendingText = '';
  private lastEmittedText = '';
  private readonly cb: DebouncedTranscriptCallback;

  constructor(cb: DebouncedTranscriptCallback) {
    this.cb = cb;
  }

  push(event: TranscriptEvent): void {
    const text = event.text.trim();

    // Skip empty or pure-whitespace transcripts
    if (!text) return;

    // Skip if this text is a subset of what we already emitted
    if (this.lastEmittedText && this.lastEmittedText.includes(text)) return;

    if (event.isFinal) {
      // Cancel pending debounce, emit immediately
      this._cancelPending();
      this._emit(text);
      return;
    }

    // Interim: accumulate and (re)schedule
    this.pendingText = text;
    this._cancelPending();
    this.timer = setTimeout(() => {
      this._emit(this.pendingText);
    }, DEBOUNCE_MS);
  }

  /** Cancel any pending timer and discard accumulated text. Call on session close. */
  flush(): void {
    this._cancelPending();
    this.lastEmittedText = '';
    this.pendingText = '';
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
    this.pendingText = '';
    this.cb(text);
  }
}
