import type { TranscriptEvent } from '../providers/asr/asr-provider-interface.js';

export type DebouncedTranscriptCallback = (text: string) => void;

/**
 * Read INTERIM_DEBOUNCE_MS lazily at instance-construction time. Reading at
 * module load is unsafe under our explicit dotenv path-resolution: ESM hoists
 * imports above the inline loadDotenv() call in main.ts, so this module loads
 * BEFORE process.env is populated, locking the default 400ms regardless of
 * .env value. Reading per-instance keeps the env override behaving correctly.
 */
function readDebounceMs(): number {
  return Number(process.env['INTERIM_DEBOUNCE_MS'] ?? 400);
}

/** Lowercase + strip all punctuation and whitespace. Used to compare interim
 *  text (no smart_format) vs final text (with commas + periods) so the delta
 *  detection survives Deepgram's late punctuation insertion. */
function normalizeForDelta(s: string): string {
  return s.toLowerCase().replace(/[\p{P}\s]+/gu, '');
}

/** Walk `original` consuming chars until `prefixLen` normalized chars have
 *  been seen, then return the remainder. Used to extract the suffix of an
 *  extended utterance after a normalized-prefix match. */
function sliceAfterNormalizedPrefix(original: string, prefixLen: number): string {
  let seen = 0;
  let i = 0;
  const skipPattern = /[\p{P}\s]/u;
  while (i < original.length && seen < prefixLen) {
    if (!skipPattern.test(original[i]!)) seen++;
    i++;
  }
  return original.slice(i);
}

/**
 * TranscriptDebouncer — collapses rapid interim ASR results into stable chunks.
 *
 * Rules:
 * - Interim: schedule emit after INTERIM_DEBOUNCE_MS; reschedule on each new
 *   interim so we only translate the latest stable phrase. Cancelled when a
 *   final arrives in the same window.
 * - isFinal=true: emit immediately, cancel any pending timer.
 * - Drop a new emit only when text is a prefix of lastEmittedText — that
 *   catches stale interims arriving after a longer final, without nuking new
 *   utterances that happen to share substrings ("the", "is", "and"...).
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
  private readonly debounceMs: number;
  private readonly interimsEnabled: boolean;

  constructor(cb: DebouncedTranscriptCallback) {
    this.cb = cb;
    this.debounceMs = readDebounceMs();
    this.interimsEnabled = this.debounceMs > 0;
  }

  push(event: TranscriptEvent): void {
    const text = event.text.trim();
    if (!text) return;
    if (this._isStaleEcho(text)) {
      console.info(`[debouncer] drop stale: "${text.slice(0, 40)}"`);
      return;
    }

    if (event.isFinal) {
      this._cancelPending();
      this._emit(text);
      return;
    }

    // Finals-only fallback for low-quota providers (Gemini 20 RPM).
    if (!this.interimsEnabled) return;

    // Interim: hold the latest text, debounce-emit after the window. If a
    // newer interim arrives in the window, replace + reset the timer.
    this.pendingText = text;
    this._cancelPending();
    this.timer = setTimeout(() => {
      this.timer = null;
      const candidate = this.pendingText;
      this.pendingText = '';
      if (candidate && !this._isStaleEcho(candidate)) {
        this._emit(candidate);
      }
    }, this.debounceMs);
  }

  private _isStaleEcho(text: string): boolean {
    return !!this.lastEmittedText && this.lastEmittedText.startsWith(text);
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

    // Delta-emit: when Deepgram extends a previous emission ("Hello world"
    // then "Hello, world, how are you?"), translate + speak only the new
    // content. Compare NORMALIZED (lowercase, strip punctuation + whitespace)
    // — Deepgram smart_format adds commas/periods on finals that interims
    // don't have, so raw startsWith would fail and the whole final gets
    // re-emitted as a duplicate utterance.
    const normNew = normalizeForDelta(text);
    const normLast = normalizeForDelta(this.lastEmittedText);
    if (normLast && normNew.startsWith(normLast)) {
      if (normNew === normLast) {
        console.info(`[debouncer] drop duplicate: "${text.slice(0, 40)}"`);
        return;
      }
      // Slice the original text at a position roughly matching the prefix
      // length. Approximate — punctuation drift makes exact alignment hard.
      // Walk the original until normalized-char-count matches lastEmitted's,
      // then strip leading punctuation/whitespace from the resulting suffix.
      const rawSuffix = sliceAfterNormalizedPrefix(text, normLast.length);
      const suffix = rawSuffix.replace(/^[\p{P}\s]+/u, '').trim();
      if (suffix) {
        console.info(`[debouncer] emit delta: "${suffix.slice(0, 40)}" (was extension of prior)`);
        this.lastEmittedText = text;
        this.cb(suffix);
        return;
      }
    }
    this.lastEmittedText = text;
    this.cb(text);
  }
}
