import * as ort from 'onnxruntime-web';
import { AUDIO_CONFIG } from '../shared/audio-config';

/**
 * Silero VAD wrapper.
 *
 * Model: silero_vad v4 (ONNX, ~5 MB)
 * Place at: extension/public/vad/silero-vad.onnx
 * License: MIT — https://github.com/snakers4/silero-vad
 *
 * Inference is run per 30 ms window (480 samples @ 16 kHz).
 * A 100 ms chunk produces 3 windows; we average the probabilities.
 *
 * Hangover: after the last speech-positive window, we continue marking
 * the stream as speech for VAD_HANGOVER_MS to avoid choppy mid-word cuts.
 *
 * Fallback: if the ONNX model fails to load, the instance falls back to
 * "send all" mode — every chunk is labelled as speech. A warning is logged.
 */

const MODEL_URL = '/vad/silero-vad.onnx';
const WINDOW_SAMPLES = AUDIO_CONFIG.VAD_WINDOW_SAMPLES; // 480
const THRESHOLD = AUDIO_CONFIG.VAD_THRESHOLD; // 0.5
const HANGOVER_MS = AUDIO_CONFIG.VAD_HANGOVER_MS; // 500

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private fallbackMode = false;

  /** Silero v4 RNN state (2 × 1 × 64 float32). */
  private h: ort.Tensor;
  private c: ort.Tensor;

  /** Timestamp of last speech-positive window (ms). */
  private lastSpeechAt = -Infinity;

  constructor() {
    // Initialise RNN hidden state to zeros.
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }

  /**
   * Load the ONNX model. Must be called before isSpeech().
   * On failure, activates fallback "send all" mode.
   */
  async load(): Promise<void> {
    try {
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
      });
      this.fallbackMode = false;
    } catch (err) {
      console.warn('[vad-silero] model load failed — falling back to send-all mode:', err);
      this.fallbackMode = true;
    }
  }

  /** True if operating in fallback mode (model not loaded). */
  get isFallback(): boolean {
    return this.fallbackMode;
  }

  /**
   * Run VAD inference on a 100 ms chunk (1600 Int16 samples @ 16 kHz).
   * Returns true if speech is detected (including hangover window).
   *
   * @param chunk — Int16Array of exactly CHUNK_BYTE_SIZE/2 = 1600 samples
   * @param nowMs — current time in ms (injectable for testing)
   */
  async isSpeech(chunk: Int16Array, nowMs: number = Date.now()): Promise<boolean> {
    if (this.fallbackMode) return true;
    if (!this.session) throw new Error('[vad-silero] call load() before isSpeech()');

    // Normalise Int16 → Float32 [-1, 1]
    const float32 = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32[i] = chunk[i] / 32768;
    }

    // Split into WINDOW_SAMPLES windows and average probabilities.
    const windowCount = Math.floor(float32.length / WINDOW_SAMPLES);
    let totalProb = 0;

    for (let w = 0; w < windowCount; w++) {
      const window = float32.subarray(w * WINDOW_SAMPLES, (w + 1) * WINDOW_SAMPLES);
      const prob = await this.runWindow(window);
      totalProb += prob;
    }

    const avgProb = windowCount > 0 ? totalProb / windowCount : 0;

    if (avgProb >= THRESHOLD) {
      this.lastSpeechAt = nowMs;
    }

    // Hangover: still speech if within HANGOVER_MS of last positive.
    return nowMs - this.lastSpeechAt <= HANGOVER_MS;
  }

  /** Reset RNN state and hangover timer (e.g. after a seek). */
  reset(): void {
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.lastSpeechAt = -Infinity;
  }

  /** Release the ONNX session. */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Run inference on a single 480-sample window.
   * Updates RNN hidden state in place.
   * Returns speech probability [0, 1].
   */
  private async runWindow(window: Float32Array): Promise<number> {
    const input = new ort.Tensor('float32', window, [1, window.length]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(AUDIO_CONFIG.OUTPUT_SAMPLE_RATE)]), [1]);

    const feeds: Record<string, ort.Tensor> = {
      input,
      sr,
      h: this.h,
      c: this.c,
    };

    const results = await this.session!.run(feeds);

    // Update RNN state for next window.
    this.h = results['hn'] as ort.Tensor;
    this.c = results['cn'] as ort.Tensor;

    const output = results['output'] as ort.Tensor;
    const prob = (output.data as Float32Array)[0];
    return prob;
  }
}
