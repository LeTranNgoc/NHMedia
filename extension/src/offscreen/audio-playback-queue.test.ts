import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlaybackQueue } from './audio-playback-queue';

// ── AudioContext mock ─────────────────────────────────────────────────────────

interface MockSource {
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  startTime: number;
}

let mockCurrentTime = 0;
const createdSources: MockSource[] = [];

const mockDestination = {};

const mockDecodeAudioData = vi.fn<(buf: ArrayBuffer) => Promise<AudioBuffer>>();

const mockAudioContext = {
  get currentTime() { return mockCurrentTime; },
  destination: mockDestination,
  decodeAudioData: (buf: ArrayBuffer) => mockDecodeAudioData(buf),
  createBufferSource: vi.fn(() => {
    const src: MockSource = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn((when: number) => { src.startTime = when; }),
      onended: null,
      startTime: 0,
    };
    createdSources.push(src);
    return src;
  }),
  close: vi.fn(),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAudioBuffer(duration = 0.5): AudioBuffer {
  return {
    duration,
    length: Math.floor(duration * 16000),
    numberOfChannels: 1,
    sampleRate: 16000,
    getChannelData: vi.fn(() => new Float32Array(Math.floor(duration * 16000))),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

/** Base64-encode a small ArrayBuffer (used as fake MP3 payload). */
function fakeBase64(): string {
  const bytes = new Uint8Array([0xff, 0xfb, 0x00, 0x00]); // fake MP3 header bytes
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AudioPlaybackQueue', () => {
  let queue: AudioPlaybackQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCurrentTime = 0;
    createdSources.length = 0;
    mockDecodeAudioData.mockReset();
    mockAudioContext.createBufferSource.mockClear();
    vi.clearAllMocks();

    queue = new AudioPlaybackQueue(mockAudioContext as unknown as AudioContext);
  });

  afterEach(() => {
    queue.destroy();
    vi.useRealTimers();
  });

  // ── Enqueue + decode ────────────────────────────────────────────────────────

  it('calls decodeAudioData when a frame is enqueued', async () => {
    const buf = makeAudioBuffer(0.5);
    mockDecodeAudioData.mockResolvedValueOnce(buf);

    await queue.enqueue(fakeBase64());

    expect(mockDecodeAudioData).toHaveBeenCalledOnce();
  });

  it('schedules source.start at nextScheduledTime >= currentTime', async () => {
    const buf = makeAudioBuffer(0.5);
    mockDecodeAudioData.mockResolvedValueOnce(buf);
    mockCurrentTime = 1.0;

    await queue.enqueue(fakeBase64());

    expect(createdSources).toHaveLength(1);
    expect(createdSources[0].start).toHaveBeenCalledWith(expect.any(Number));
    expect(createdSources[0].startTime).toBeGreaterThanOrEqual(1.0);
  });

  it('chains 3 frames back-to-back: each starts after previous ends', async () => {
    const dur = 0.5;
    mockDecodeAudioData.mockResolvedValue(makeAudioBuffer(dur));
    mockCurrentTime = 0;

    await queue.enqueue(fakeBase64());
    await queue.enqueue(fakeBase64());
    await queue.enqueue(fakeBase64());

    expect(createdSources).toHaveLength(3);
    const times = createdSources.map((s) => s.startTime);
    // Each scheduled time should be approximately the previous + duration
    expect(times[1]).toBeCloseTo(times[0] + dur, 5);
    expect(times[2]).toBeCloseTo(times[1] + dur, 5);
  });

  it('resets nextScheduledTime to now when queue stalls > 500ms', async () => {
    const buf = makeAudioBuffer(0.3);
    mockDecodeAudioData.mockResolvedValue(buf);

    // Enqueue first frame at t=0
    mockCurrentTime = 0;
    await queue.enqueue(fakeBase64());
    const firstStart = createdSources[0].startTime; // should be ~0

    // Advance time by 600ms (stall > 500ms) without enqueueing
    mockCurrentTime = 0.6;
    await vi.advanceTimersByTimeAsync(600);

    // Second frame should start at currentTime (0.6), not at firstStart + 0.3 (~0.3)
    mockDecodeAudioData.mockResolvedValue(makeAudioBuffer(0.3));
    await queue.enqueue(fakeBase64());

    expect(createdSources).toHaveLength(2);
    const secondStart = createdSources[1].startTime;
    // Should start at currentTime ~0.6 (stall reset), not at old scheduled end ~0.3
    expect(secondStart).toBeGreaterThanOrEqual(mockCurrentTime); // >= 0.6
    expect(secondStart).toBeGreaterThan(firstStart + 0.3);       // > 0.3 (the old scheduled time)
  });

  it('skips corrupt frame and continues with next', async () => {
    mockDecodeAudioData.mockRejectedValueOnce(new Error('decode failed'));
    const good = makeAudioBuffer(0.3);
    mockDecodeAudioData.mockResolvedValueOnce(good);

    // Should not throw
    await expect(queue.enqueue(fakeBase64())).resolves.toBeUndefined();
    await expect(queue.enqueue(fakeBase64())).resolves.toBeUndefined();

    // Only the second (good) frame produced a source
    expect(createdSources).toHaveLength(1);
  });

  it('clear() stops all pending sources and resets schedule', async () => {
    mockDecodeAudioData.mockResolvedValue(makeAudioBuffer(1.0));
    await queue.enqueue(fakeBase64());

    queue.clear();

    // After clear, next frame schedules from currentTime
    mockCurrentTime = 2.0;
    mockDecodeAudioData.mockResolvedValue(makeAudioBuffer(0.5));
    await queue.enqueue(fakeBase64());

    // Last source scheduled at current time (not continuation of previous)
    expect(createdSources[1].startTime).toBeGreaterThanOrEqual(2.0);
  });

  it('connects source to destination', async () => {
    mockDecodeAudioData.mockResolvedValue(makeAudioBuffer(0.5));
    await queue.enqueue(fakeBase64());

    expect(createdSources[0].connect).toHaveBeenCalledWith(mockDestination);
  });
});
