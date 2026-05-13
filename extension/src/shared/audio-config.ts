/**
 * Shared audio pipeline constants.
 * Single source of truth for both worklet (vanilla JS reads these via comment)
 * and TypeScript modules.
 */
export const AUDIO_CONFIG = {
  /** Raw sample rate from tab capture (Chrome default). */
  INPUT_SAMPLE_RATE: 48_000,

  /** Target sample rate expected by Silero VAD and the backend ASR. */
  OUTPUT_SAMPLE_RATE: 16_000,

  /** Duration of each WS send chunk in milliseconds. */
  CHUNK_DURATION_MS: 100,

  /**
   * Byte size of one 100ms chunk at 16kHz, Int16 (2 bytes/sample).
   * 100ms × 16000Hz × 2 bytes = 3200 bytes.
   */
  CHUNK_BYTE_SIZE: 3_200,

  /** Ring buffer total size in bytes (~4 s of 16kHz Int16 audio). */
  RING_BUFFER_BYTES: 262_144, // 256 KB

  /** Silero VAD speech probability threshold [0..1]. */
  VAD_THRESHOLD: 0.5,

  /**
   * Hangover duration — continue labelling as speech this many ms after
   * the last speech-positive window, to avoid choppy mid-word cuts.
   */
  VAD_HANGOVER_MS: 500,

  /** Silero VAD window size in samples (30 ms @ 16 kHz). */
  VAD_WINDOW_SAMPLES: 480,

  /** Base reconnect delay for WS exponential backoff (ms). */
  WS_RECONNECT_BASE_MS: 1_000,

  /** Maximum reconnect delay cap (ms). */
  WS_RECONNECT_MAX_MS: 30_000,

  /** ±Jitter added to each reconnect delay (ms). */
  WS_RECONNECT_JITTER_MS: 5_000,

  /**
   * WS send backpressure threshold.
   * Skip a chunk if ws.bufferedAmount exceeds this value.
   */
  WS_BACKPRESSURE_BYTES: 100_000,

  /** Donwsample ratio (INPUT / OUTPUT). */
  DOWNSAMPLE_RATIO: 3, // 48000 / 16000
} as const;

export type AudioConfig = typeof AUDIO_CONFIG;
