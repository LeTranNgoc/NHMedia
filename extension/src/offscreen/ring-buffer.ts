import { AUDIO_CONFIG } from '../shared/audio-config';

/**
 * Lock-free ring buffer backed by SharedArrayBuffer.
 *
 * Layout of the SAB:
 *   [0..3]   head pointer (Int32, atomic) — next read position in samples
 *   [4..7]   tail pointer (Int32, atomic) — next write position in samples
 *   [8..]    Int16 audio samples
 *
 * SharedArrayBuffer requires COOP/COEP headers.
 * Extension offscreen documents have these by default in MV3.
 *
 * Overflow policy: when the buffer is full, oldest samples are overwritten
 * (head advances). This keeps the buffer bounded at all times — no memory
 * growth. The dropped samples are logged (not the audio content).
 */

const HEADER_BYTES = 8; // 2 × Int32 (head + tail)
const HEAD_IDX = 0; // index into Int32Array view
const TAIL_IDX = 1;

export class RingBuffer {
  /** Underlying SharedArrayBuffer — can be transferred to worklet via postMessage. */
  readonly sab: SharedArrayBuffer;

  private readonly ctrl: Int32Array; // head / tail pointers
  private readonly data: Int16Array; // audio samples

  /** Number of Int16 samples the data region can hold. */
  readonly capacity: number;

  constructor(byteSize: number = AUDIO_CONFIG.RING_BUFFER_BYTES) {
    this.sab = new SharedArrayBuffer(HEADER_BYTES + byteSize);
    this.ctrl = new Int32Array(this.sab, 0, 2);
    this.data = new Int16Array(this.sab, HEADER_BYTES);
    this.capacity = this.data.length;
  }

  /**
   * Return the number of samples currently available to read.
   * Safe to call from any thread (uses Atomics.load).
   */
  available(): number {
    const head = Atomics.load(this.ctrl, HEAD_IDX);
    const tail = Atomics.load(this.ctrl, TAIL_IDX);
    return (tail - head + this.capacity) % this.capacity;
  }

  /**
   * Write Int16 samples into the buffer.
   * If there is insufficient free space, oldest samples are overwritten
   * (head advances past the dropped data).
   *
   * @param samples — Int16Array of PCM samples to enqueue
   */
  write(samples: Int16Array): void {
    const n = samples.length;
    if (n === 0) return;

    const tail = Atomics.load(this.ctrl, TAIL_IDX);
    const head = Atomics.load(this.ctrl, HEAD_IDX);
    const free = (head - tail - 1 + this.capacity) % this.capacity;

    if (n > free) {
      // Overflow — advance head to make room; oldest samples are silently dropped.
      const drop = n - free;
      const newHead = (head + drop) % this.capacity;
      Atomics.store(this.ctrl, HEAD_IDX, newHead);
      console.warn(`[ring-buffer] overflow: dropped ${drop} samples`);
    }

    // Write samples, wrapping around the circular boundary.
    const startPos = tail;
    for (let i = 0; i < n; i++) {
      this.data[(startPos + i) % this.capacity] = samples[i];
    }

    const newTail = (tail + n) % this.capacity;
    Atomics.store(this.ctrl, TAIL_IDX, newTail);
  }

  /**
   * Read up to `sampleCount` samples into a new Int16Array.
   * Returns null if fewer than `sampleCount` samples are available (underflow).
   *
   * Underflow policy: return null so the caller can decide whether to skip
   * the current processing tick (prevents processing incomplete chunks).
   *
   * @param sampleCount — number of Int16 samples to dequeue
   */
  read(sampleCount: number): Int16Array | null {
    const avail = this.available();
    if (avail < sampleCount) return null;

    const head = Atomics.load(this.ctrl, HEAD_IDX);
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = this.data[(head + i) % this.capacity];
    }

    const newHead = (head + sampleCount) % this.capacity;
    Atomics.store(this.ctrl, HEAD_IDX, newHead);
    return out;
  }

  /** Reset the buffer to empty state (for testing / restart). */
  reset(): void {
    Atomics.store(this.ctrl, HEAD_IDX, 0);
    Atomics.store(this.ctrl, TAIL_IDX, 0);
  }
}
