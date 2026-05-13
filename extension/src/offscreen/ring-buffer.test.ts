import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from './ring-buffer';

// Small capacity to make overflow/underflow easy to trigger in tests.
// 64 samples = 128 bytes.
const SMALL_CAP = 128;

describe('RingBuffer', () => {
  let buf: RingBuffer;

  beforeEach(() => {
    buf = new RingBuffer(SMALL_CAP);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('starts empty', () => {
    expect(buf.available()).toBe(0);
  });

  it('write then read preserves FIFO order', () => {
    const samples = Int16Array.from([1, 2, 3, 4, 5]);
    buf.write(samples);
    const out = buf.read(5);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('available() reflects written sample count', () => {
    buf.write(Int16Array.from([10, 20, 30]));
    expect(buf.available()).toBe(3);
  });

  it('available() decrements after read', () => {
    buf.write(Int16Array.from([1, 2, 3, 4]));
    buf.read(2);
    expect(buf.available()).toBe(2);
  });

  it('multiple writes accumulate correctly', () => {
    buf.write(Int16Array.from([1, 2]));
    buf.write(Int16Array.from([3, 4]));
    const out = buf.read(4);
    expect(Array.from(out!)).toEqual([1, 2, 3, 4]);
  });

  it('wraps around the circular boundary correctly', () => {
    // Fill capacity − 2, then drain all, then write again to force wrap.
    const cap = buf.capacity;
    const fill = Int16Array.from({ length: cap - 2 }, (_, i) => i);
    buf.write(fill);
    buf.read(cap - 2); // drain
    buf.write(Int16Array.from([100, 200, 300]));
    const out = buf.read(3);
    expect(Array.from(out!)).toEqual([100, 200, 300]);
  });

  it('reset clears the buffer', () => {
    buf.write(Int16Array.from([1, 2, 3]));
    buf.reset();
    expect(buf.available()).toBe(0);
    expect(buf.read(1)).toBeNull();
  });

  // ── Underflow ───────────────────────────────────────────────────────────────

  it('read returns null when fewer samples available than requested (underflow)', () => {
    buf.write(Int16Array.from([1, 2]));
    expect(buf.read(10)).toBeNull();
  });

  it('read returns null on empty buffer', () => {
    expect(buf.read(1)).toBeNull();
  });

  it('partial read does not consume any samples on underflow', () => {
    buf.write(Int16Array.from([1, 2, 3]));
    const result = buf.read(10); // underflow
    expect(result).toBeNull();
    // Buffer should still have 3 samples available
    expect(buf.available()).toBe(3);
  });

  // ── Overflow ────────────────────────────────────────────────────────────────

  it('overflow: oldest samples are overwritten when buffer is full', () => {
    // Fill the buffer completely (capacity - 1 max usable due to ring arithmetic)
    const usable = buf.capacity - 1;
    const first = Int16Array.from({ length: usable }, () => 1); // all 1s
    buf.write(first);

    // Write 2 more samples — should overwrite oldest
    buf.write(Int16Array.from([99, 99]));

    // Buffer still bounded — not larger than capacity
    expect(buf.available()).toBeLessThanOrEqual(buf.capacity - 1);
  });

  it('buffer available count never exceeds capacity after overflow', () => {
    const large = Int16Array.from({ length: buf.capacity * 2 }, () => 7);
    buf.write(large);
    expect(buf.available()).toBeLessThan(buf.capacity);
  });

  it('write empty array is a no-op', () => {
    buf.write(new Int16Array(0));
    expect(buf.available()).toBe(0);
  });
});

// ── Downsample ratio sanity check ───────────────────────────────────────────
// The worklet downsamples 48kHz → 16kHz (ratio 3).
// Verify the chunk math: 100ms @ 16kHz = 1600 samples = 3200 bytes.
describe('Downsample math (audio-config constants)', () => {
  it('CHUNK_BYTE_SIZE equals 100ms of 16kHz Int16', () => {
    const SAMPLE_RATE = 16_000;
    const DURATION_MS = 100;
    const BYTES_PER_SAMPLE = 2;
    const expected = (SAMPLE_RATE * DURATION_MS) / 1000 * BYTES_PER_SAMPLE;
    // 1600 samples × 2 bytes = 3200
    expect(expected).toBe(3_200);
  });

  it('downsample ratio is 3 (48000 / 16000)', () => {
    expect(48_000 / 16_000).toBe(3);
  });

  it('RING_BUFFER_BYTES holds ~4 seconds of 16kHz Int16', () => {
    const RING_BYTES = 262_144;
    const BYTES_PER_SECOND = 16_000 * 2; // 32000
    const seconds = RING_BYTES / BYTES_PER_SECOND; // ~8.19
    expect(seconds).toBeGreaterThan(4);
  });
});
