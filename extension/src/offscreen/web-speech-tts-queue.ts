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

  constructor() {
    this.refreshVoice();
    // Voices load asynchronously on first speak() — listen for the late event.
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => this.refreshVoice());
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

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) speechSynthesis.cancel();
  }

  /** Queue a text utterance. No-op when unsupported / muted. */
  speak(text: string): void {
    if (this.muted || !this.isSupported() || !text.trim()) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = this.voice;
    utter.lang = this.voice?.lang ?? 'vi-VN';
    utter.rate = 1.05; // Slight speed-up — VN dub usually trails the source.
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
    this.cancel();
  }

  // ── Private ──────────────────────────────────────────────────────────────
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
