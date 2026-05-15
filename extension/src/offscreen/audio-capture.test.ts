import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioCapture } from './audio-capture';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAddModule = vi.fn<() => Promise<void>>(async () => {});
const mockGetUserMedia = vi.fn<() => Promise<MediaStream>>();
const mockCreateMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
const mockAudioCtxClose = vi.fn<() => Promise<void>>(async () => {});
const mockAudioCtxResume = vi.fn<() => Promise<void>>(async () => {});
const mockCreateGain = vi.fn(() => ({
  gain: { value: 0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

const mockAudioContext = vi.fn().mockImplementation(() => ({
  audioWorklet: { addModule: mockAddModule },
  createMediaStreamSource: mockCreateMediaStreamSource,
  createGain: mockCreateGain,
  close: mockAudioCtxClose,
  resume: mockAudioCtxResume,
  destination: {},
  state: 'suspended',
}));

// AudioWorkletNode is not available in happy-dom — stub it so start() can complete.
const mockAudioWorkletNode = vi.fn().mockImplementation(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

function makeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

vi.stubGlobal('AudioContext', mockAudioContext);
vi.stubGlobal('AudioWorkletNode', mockAudioWorkletNode);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AudioCapture — start() ordering (M7)', () => {
  const mockRingBuffer = { sab: new SharedArrayBuffer(8), capacity: 64 };

  beforeEach(() => {
    mockAddModule.mockReset();
    mockGetUserMedia.mockReset();
    mockCreateMediaStreamSource.mockReset().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() });
    mockAudioCtxClose.mockReset();
    mockAudioCtxResume.mockReset().mockResolvedValue(undefined);
    mockCreateGain.mockReset().mockReturnValue({
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    mockAudioContext.mockClear();

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: mockGetUserMedia },
    });
  });

  it('addModule is called before getUserMedia', async () => {
    const callOrder: string[] = [];
    mockAddModule.mockImplementation(async () => { callOrder.push('addModule'); });
    mockGetUserMedia.mockImplementation(async () => { callOrder.push('getUserMedia'); return makeStream(); });

    const capture = new AudioCapture(mockRingBuffer as never);
    await capture.start('stream-id-1');

    expect(callOrder).toEqual(['addModule', 'getUserMedia']);
  });

  it('if addModule rejects, getUserMedia is NOT called', async () => {
    mockAddModule.mockRejectedValue(new Error('worklet load failed'));
    mockGetUserMedia.mockResolvedValue(makeStream());

    const capture = new AudioCapture(mockRingBuffer as never);
    await expect(capture.start('stream-id-1')).rejects.toThrow('worklet load failed');

    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });
});
