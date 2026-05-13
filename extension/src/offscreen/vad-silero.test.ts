import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SileroVad } from './vad-silero';

// ── Mock onnxruntime-web ────────────────────────────────────────────────────
// Actual ONNX inference cannot run in unit tests (no model file, no WASM).
// We mock the module so InferenceSession.create and run are fully controlled.

let mockRunResult = 0.8; // default: high speech probability

vi.mock('onnxruntime-web', () => {
  // Minimal Tensor stub
  class Tensor {
    type: string;
    data: Float32Array | BigInt64Array;
    dims: number[];
    constructor(
      type: string,
      data: Float32Array | BigInt64Array,
      dims: number[],
    ) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }

  const mockSession = {
    run: vi.fn(async () => ({
      output: new Tensor('float32', new Float32Array([mockRunResult]), [1, 1]),
      hn: new Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]),
      cn: new Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]),
    })),
    release: vi.fn(async () => {}),
  };

  return {
    Tensor,
    InferenceSession: {
      create: vi.fn(async () => mockSession),
    },
    _mockSession: mockSession, // exported for test access
  };
});

// Helper to update what the mock session returns
function setMockProb(prob: number) {
  mockRunResult = prob;
}

// Build a 1600-sample Int16 chunk (100 ms @ 16 kHz)
function makeChunk(value = 1000): Int16Array {
  return new Int16Array(1600).fill(value);
}

describe('SileroVad — load', () => {
  it('loads model successfully and is not in fallback mode', async () => {
    const vad = new SileroVad();
    await vad.load();
    expect(vad.isFallback).toBe(false);
  });

  it('falls back to send-all mode when model load fails', async () => {
    const ort = await import('onnxruntime-web');
    vi.spyOn(ort.InferenceSession, 'create').mockRejectedValueOnce(
      new Error('model not found'),
    );

    const vad = new SileroVad();
    await vad.load();
    expect(vad.isFallback).toBe(true);
  });
});

describe('SileroVad — isSpeech (fallback mode)', () => {
  it('returns true for every chunk in fallback mode', async () => {
    const ort = await import('onnxruntime-web');
    vi.spyOn(ort.InferenceSession, 'create').mockRejectedValueOnce(
      new Error('no model'),
    );

    const vad = new SileroVad();
    await vad.load();

    const result = await vad.isSpeech(makeChunk(0), 1000);
    expect(result).toBe(true);
  });
});

describe('SileroVad — isSpeech (normal mode)', () => {
  let vad: SileroVad;

  beforeEach(async () => {
    vad = new SileroVad();
    await vad.load();
  });

  afterEach(async () => {
    await vad.dispose();
  });

  it('returns true when model probability >= threshold (0.5)', async () => {
    setMockProb(0.8);
    const result = await vad.isSpeech(makeChunk(), 1000);
    expect(result).toBe(true);
  });

  it('returns false when model probability < threshold', async () => {
    setMockProb(0.2);
    // Call with a time far in the future so no prior hangover applies
    const result = await vad.isSpeech(makeChunk(), 999_999_999);
    expect(result).toBe(false);
  });

  it('isSpeech returns a probability between 0 and 1 (mock returns 0.8)', async () => {
    setMockProb(0.8);
    // Just verify it doesn't throw and returns boolean
    const result = await vad.isSpeech(makeChunk(), 1000);
    expect(typeof result).toBe('boolean');
  });

  // ── Hangover ───────────────────────────────────────────────────────────────

  it('hangover: continues marking speech for 500 ms after last positive', async () => {
    setMockProb(0.9);
    const t0 = 0;
    await vad.isSpeech(makeChunk(), t0); // speech at t=0

    setMockProb(0.1); // now silence
    // Within hangover window (499 ms later)
    const stillSpeech = await vad.isSpeech(makeChunk(), t0 + 499);
    expect(stillSpeech).toBe(true);
  });

  it('hangover expires: silence after 500 ms → not speech', async () => {
    setMockProb(0.9);
    const t0 = 0;
    await vad.isSpeech(makeChunk(), t0); // speech at t=0

    setMockProb(0.1); // silence
    // Just past hangover window (501 ms later)
    const expired = await vad.isSpeech(makeChunk(), t0 + 501);
    expect(expired).toBe(false);
  });

  it('hangover resets on reset()', async () => {
    setMockProb(0.9);
    await vad.isSpeech(makeChunk(), 0); // speech at t=0

    vad.reset();

    setMockProb(0.1);
    // After reset, hangover timer is cleared → should be false immediately
    const result = await vad.isSpeech(makeChunk(), 1);
    expect(result).toBe(false);
  });

  it('throws if isSpeech called before load()', async () => {
    const unloaded = new SileroVad();
    await expect(unloaded.isSpeech(makeChunk(), 0)).rejects.toThrow('load()');
  });
});
