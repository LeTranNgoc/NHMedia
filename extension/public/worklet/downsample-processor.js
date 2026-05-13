/**
 * downsample-processor.js — AudioWorkletProcessor
 *
 * Runs on the dedicated audio rendering thread (NOT main thread, NOT Worker).
 * Vanilla JS only — no TS, no imports, no ES modules. Worklet context restriction.
 *
 * Pipeline:
 *   Input : 48 kHz stereo Float32 (Chrome tab capture default)
 *   Output: 16 kHz mono Int16 written into a SharedArrayBuffer ring buffer
 *
 * Downsample strategy: average L+R channels (mono mix), then take every 3rd
 * sample (48k / 16k = 3). A simple 3-tap box filter is applied before
 * decimation to reduce aliasing (avg of 3 consecutive samples before pick).
 *
 * Ring buffer layout (matches ring-buffer.ts):
 *   [0..3]  head pointer (Int32, atomic) — next read index in samples
 *   [4..7]  tail pointer (Int32, atomic) — next write index in samples
 *   [8..]   Int16 audio samples
 *
 * Overflow policy: if the buffer is full, oldest samples are dropped by
 * advancing the head pointer. Bounded memory is more important than lossless
 * capture during a stalled main thread.
 *
 * Constants mirror audio-config.ts (kept in sync manually):
 *   INPUT_SAMPLE_RATE  = 48000
 *   OUTPUT_SAMPLE_RATE = 16000
 *   DOWNSAMPLE_RATIO   = 3
 */

const HEADER_BYTES = 8;
const HEAD_IDX = 0;
const TAIL_IDX = 1;
const DOWNSAMPLE_RATIO = 3; // 48000 / 16000

class DownsampleProcessor extends AudioWorkletProcessor {
  /** @type {Int32Array} */
  _ctrl;
  /** @type {Int16Array} */
  _data;
  /** @type {number} */
  _capacity;

  constructor(options) {
    super();
    const sab = options.processorOptions.sharedArrayBuffer;
    this._capacity = options.processorOptions.capacity;
    this._ctrl = new Int32Array(sab, 0, 2);
    this._data = new Int16Array(sab, HEADER_BYTES);
  }

  /**
   * Called by the audio rendering engine per render quantum (~5 ms / 128 frames).
   *
   * @param {Float32Array[][]} inputs  — [[leftChannel, rightChannel], ...]
   * @returns {boolean} true — keep processor alive
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const left = input[0];
    const right = input.length > 1 ? input[1] : left; // mono fallback

    // Mono mix + box-filter downsample
    // For each output sample: average 3 consecutive input pairs, then take one.
    const outputCount = Math.floor(left.length / DOWNSAMPLE_RATIO);
    const out = new Int16Array(outputCount);

    for (let i = 0; i < outputCount; i++) {
      const base = i * DOWNSAMPLE_RATIO;
      // 3-tap box filter: avg of the DOWNSAMPLE_RATIO input samples
      let sum = 0;
      for (let k = 0; k < DOWNSAMPLE_RATIO; k++) {
        sum += (left[base + k] + right[base + k]) * 0.5;
      }
      const mono = sum / DOWNSAMPLE_RATIO;

      // Float32 [-1, 1] → Int16 [-32767, 32767], clamped
      const clamped = Math.max(-1, Math.min(1, mono));
      out[i] = Math.round(clamped * 32767);
    }

    this._writeToRing(out);
    return true;
  }

  /**
   * Write Int16 samples to the ring buffer using Atomics.
   * Overflow: advance head if no space (oldest data dropped).
   *
   * @param {Int16Array} samples
   */
  _writeToRing(samples) {
    const n = samples.length;
    if (n === 0) return;

    const cap = this._capacity;
    const tail = Atomics.load(this._ctrl, TAIL_IDX);
    const head = Atomics.load(this._ctrl, HEAD_IDX);
    const free = (head - tail - 1 + cap) % cap;

    if (n > free) {
      // Overflow — drop oldest samples to keep buffer bounded
      const drop = n - free;
      const newHead = (head + drop) % cap;
      Atomics.store(this._ctrl, HEAD_IDX, newHead);
      // Note: cannot call console.warn from worklet thread safely in all Chrome versions
    }

    for (let i = 0; i < n; i++) {
      this._data[(tail + i) % cap] = samples[i];
    }

    const newTail = (tail + n) % cap;
    Atomics.store(this._ctrl, TAIL_IDX, newTail);
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
