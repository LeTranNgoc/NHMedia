/**
 * WebSpeechTtsQueue — speak Vietnamese translation text via browser-native
 * speechSynthesis. Drop-in zero-cost replacement for the server-side TTS
 * pipeline at the cost of voice variability across OS / Chrome versions.
 *
 * Chrome on Windows ships `Microsoft Hanh / An (vi-VN)` neural voices.
 * macOS ships `Linh (vi-VN)`. Linux depends on installed speech-dispatcher
 * voices — quality varies. If no vi-VN voice is available, `speak()` is a
 * no-op and the caller should fall back to server TTS (see isSupported()).
 *
 * Queueing: speechSynthesis already serialises utterances internally, but
 * we keep a local count so backpressure stays visible. cancel() flushes
 * the SDK queue on user pause/seek.
 */

export class WebSpeechTtsQueue {
  private voice: SpeechSynthesisVoice | null = null;
  private pendingCount = 0;
  private muted = false;

  /** Volume multiplier 0..1. User wants "tăng dub" → keep at 1.0 by default. */
  private gain = 1.0;

  /** Speech rate (SpeechSynthesisUtterance.rate). User-tunable via settings. */
  private rate = 1.3;

  /** Last-spoken dedup window — if the same exact text arrives again within
   *  this window, skip. Defends against pipeline duplicates (cache hits, race
   *  conditions, multi-final ASR segments) that re-emit the same translation. */
  private lastSpokenText = '';
  private lastSpokenAt = 0;
  private readonly DEDUP_WINDOW_MS = 1_500;

  /** Hard cap on queued utterances. New arrivals are SKIPPED while queue is full
   *  (NOT cancelled — calling speechSynthesis.cancel() followed by speak() trips
   *  Chrome bug crbug.com/700031 where subsequent utterances silently no-op until
   *  the page reloads. That's the "must toggle off+on" symptom). 2 = current
   *  speech + 1 next pending. Stale content drops naturally — queue drains. */
  private readonly MAX_QUEUE_DEPTH = 2;

  /** Keepalive timer — Chrome's speechSynthesis is known to silently halt after
   *  ~15s of inactivity in service-worker / offscreen contexts. A periodic
   *  pause/resume tap keeps the synth alive even between utterances. */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly KEEPALIVE_INTERVAL_MS = 10_000;

  constructor() {
    this.refreshVoice();
    // Voices load asynchronously on first speak() — listen for the late event.
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => this.refreshVoice());
      this.keepaliveTimer = setInterval(() => this._keepalive(), this.KEEPALIVE_INTERVAL_MS);
    }
  }

  /** True iff a vi-VN voice was found AND speechSynthesis is available. */
  isSupported(): boolean {
    return typeof speechSynthesis !== 'undefined' && this.voice !== null;
  }

  /** Selected voice name (e.g. "Microsoft Hanh - Vietnamese"). null when none. */
  voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  setGain(value: number): void {
    this.gain = Math.max(0, Math.min(1, value));
  }

  setRate(value: number): void {
    this.rate = Math.max(0.5, Math.min(2.0, value));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) speechSynthesis.cancel();
  }

  /** Queue a text utterance. No-op when unsupported / muted / a dup within 1.5s.
   *  Cancels queue when depth exceeds MAX_QUEUE_DEPTH to keep dub real-time. */
  speak(text: string): void {
    if (this.muted || !this.isSupported() || !text.trim()) return;

    const trimmed = text.trim();
    if (trimmed === this.lastSpokenText && Date.now() - this.lastSpokenAt < this.DEDUP_WINDOW_MS) {
      console.info(`[web-speech-tts] dedup: skip "${trimmed.slice(0, 40)}"`);
      return;
    }

    // Skip new arrivals while queue is full instead of cancelling. cancel() +
    // immediate speak() trips Chrome's speechSynthesis state bug — subsequent
    // utterances silently no-op forever. Skipping keeps the synth healthy;
    // user accepts that fast-talking content occasionally drops a sentence
    // rather than the dub freezing entirely.
    if (this.pendingCount >= this.MAX_QUEUE_DEPTH) {
      console.info(
        `[web-speech-tts] queue full (depth=${this.pendingCount}) — skip "${trimmed.slice(0, 40)}"`,
      );
      return;
    }

    this.lastSpokenText = trimmed;
    this.lastSpokenAt = Date.now();

    const utter = new SpeechSynthesisUtterance(trimmed);
    utter.voice = this.voice;
    utter.lang = this.voice?.lang ?? 'vi-VN';
    utter.rate = this.rate;
    utter.volume = this.gain;
    utter.onend = () => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
    };
    utter.onerror = (e) => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      console.warn('[web-speech-tts] utterance error:', e.error);
    };

    this.pendingCount++;
    speechSynthesis.speak(utter);
  }

  /** Cancel all queued + speaking utterances. Use on stop / pause. */
  cancel(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.pendingCount = 0;
  }

  destroy(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.cancel();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /** Tap pause/resume periodically to defeat Chrome's silent-stall behavior.
   *  Only acts when not actively speaking — a no-op for users with continuous
   *  dub flow. Pause/resume on an idle synth is harmless on all platforms. */
  private _keepalive(): void {
    if (typeof speechSynthesis === 'undefined') return;
    if (speechSynthesis.speaking || speechSynthesis.pending) return;
    speechSynthesis.pause();
    speechSynthesis.resume();
  }
  private refreshVoice(): void {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    // Prefer female (Hanh on Win, Linh on Mac), then any vi-VN.
    const viVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('vi'));
    if (viVoices.length === 0) {
      this.voice = null;
      return;
    }
    const preferred = viVoices.find((v) => /hanh|linh|female/i.test(v.name)) ?? viVoices[0];
    if (this.voice !== preferred) {
      this.voice = preferred;
      console.info(`[web-speech-tts] voice selected: "${preferred.name}" (${preferred.lang})`);
    }
  }
}
