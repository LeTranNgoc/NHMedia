import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPipelineController } from './audio-pipeline-controller';
import type { StartPayload } from './audio-pipeline-controller';

// ── Module mocks ─────────────────────────────────────────────────────────────
// All three heavy dependencies are mocked so the controller's orchestration
// logic can be tested without real audio, ONNX, or WebSocket.

// RingBuffer mock — write/read controlled per test
const mockRingRead = vi.fn<() => Int16Array | null>();
const mockRingWrite = vi.fn<(s: Int16Array) => void>();
const mockRingReset = vi.fn<() => void>();

vi.mock('./ring-buffer', () => ({
  RingBuffer: vi.fn().mockImplementation(() => ({
    sab: new SharedArrayBuffer(8),
    capacity: 64,
    read: mockRingRead,
    write: mockRingWrite,
    reset: mockRingReset,
    available: vi.fn(() => 0),
  })),
}));

// AudioCapture mock
const mockCaptureStart = vi.fn<(s: string) => Promise<void>>(async () => {});
const mockCaptureStop = vi.fn<() => Promise<void>>(async () => {});

vi.mock('./audio-capture', () => ({
  AudioCapture: vi.fn().mockImplementation(() => ({
    start: mockCaptureStart,
    stop: mockCaptureStop,
    isRunning: true,
  })),
}));

// SileroVad mock — re-assigned per test suite so silence/speech can be switched
let mockVadIsSpeech = vi.fn(async (_chunk: Int16Array, _now?: number): Promise<boolean> => true);
const mockVadLoad = vi.fn<() => Promise<void>>(async () => {});
const mockVadDispose = vi.fn<() => Promise<void>>(async () => {});

vi.mock('./vad-silero', () => ({
  SileroVad: vi.fn().mockImplementation(() => ({
    load: mockVadLoad,
    // Delegate through a local fn so re-assigning mockVadIsSpeech per test works.
    isSpeech: (...args: [Int16Array, number?]) => mockVadIsSpeech(...args),
    dispose: mockVadDispose,
    isFallback: false,
    reset: vi.fn(),
  })),
}));

// AudioPlaybackQueue mock
const mockQueueEnqueue = vi.fn<(b: string) => Promise<void>>(async () => {});
const mockQueueClear = vi.fn<() => void>();
const mockQueueDestroy = vi.fn<() => void>();

vi.mock('./audio-playback-queue', () => ({
  AudioPlaybackQueue: vi.fn().mockImplementation(() => ({
    enqueue: mockQueueEnqueue,
    clear: mockQueueClear,
    destroy: mockQueueDestroy,
  })),
}));

// WsReceiver mock
vi.mock('./ws-receiver', () => ({
  WsReceiver: vi.fn().mockImplementation(() => ({
    handleFrame: vi.fn(),
  })),
}));

// AudioContext stub — needed because pipeline now creates one for TTS playback
vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
  currentTime: 0,
  destination: {},
  decodeAudioData: vi.fn().mockResolvedValue({}),
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    onended: null,
  })),
  close: vi.fn().mockResolvedValue(undefined),
})));

// WsClient mock
const mockWsConnect = vi.fn<() => void>();
const mockWsSendAudio = vi.fn<(b: Int16Array) => void>();
const mockWsSendControl = vi.fn<(f: object) => void>();
const mockWsClose = vi.fn<() => void>();
let mockWsBufferedAmount = 0;

// Store options passed to WsClient constructor so tests can trigger callbacks
let capturedWsOpts: {
  onFrame?: (f: unknown) => void;
  onFatalError?: (r: string) => void;
  onReconnecting?: (n: number) => void;
} = {};

vi.mock('./ws-client', () => ({
  WsClient: vi.fn().mockImplementation((opts: typeof capturedWsOpts) => {
    capturedWsOpts = opts;
    return {
      connect: mockWsConnect,
      sendAudio: mockWsSendAudio,
      sendControl: mockWsSendControl,
      close: mockWsClose,
      get bufferedAmount() { return mockWsBufferedAmount; },
    };
  }),
}));

// chrome.runtime.sendMessage stub
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PAYLOAD: StartPayload = {
  streamId: 'stream-abc',
  config: { srcLang: 'en', wsUrl: 'ws://localhost:3000/ws', jwt: 'tok' },
};

function makeSpeechChunk(): Int16Array {
  return new Int16Array(1600).fill(500);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AudioPipelineController — start sequence', () => {
  let ctrl: AudioPipelineController;

  beforeEach(() => {
    vi.useFakeTimers();
    ctrl = new AudioPipelineController();
    mockRingRead.mockReturnValue(null); // underflow by default
    mockVadIsSpeech = vi.fn(async () => true);
    mockWsBufferedAmount = 0;
    capturedWsOpts = {};
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await ctrl.stop();
    vi.useRealTimers();
  });

  it('starts in idle state', () => {
    expect(ctrl.currentState).toBe('idle');
  });

  it('state transitions idle → running after start()', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    expect(ctrl.currentState).toBe('running');
  });

  it('calls capture.start with the streamId', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    expect(mockCaptureStart).toHaveBeenCalledWith(DEFAULT_PAYLOAD.streamId);
  });

  it('calls vad.load()', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    expect(mockVadLoad).toHaveBeenCalledOnce();
  });

  it('calls ws.connect()', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    expect(mockWsConnect).toHaveBeenCalledOnce();
  });

  it('sends config control frame with srcLang', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    expect(mockWsSendControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config', srcLang: 'en' }),
    );
  });

  it('start() is a no-op when already running', async () => {
    await ctrl.start(DEFAULT_PAYLOAD);
    await ctrl.start(DEFAULT_PAYLOAD); // second call
    expect(mockCaptureStart).toHaveBeenCalledOnce(); // still once
  });
});

describe('AudioPipelineController — tick: send speech chunk', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockWsBufferedAmount = 0;
    mockVadIsSpeech = vi.fn(async () => true); // speech
    mockRingRead.mockReturnValue(makeSpeechChunk());
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(async () => {
    await ctrl.stop();
    vi.useRealTimers();
  });

  it('calls ws.sendAudio when VAD returns speech', async () => {
    // Advance one tick (100 ms)
    await vi.advanceTimersByTimeAsync(100);
    expect(mockWsSendAudio).toHaveBeenCalled();
  });

  it('does NOT call ws.sendAudio when ring buffer underflows', async () => {
    mockRingRead.mockReturnValue(null); // underflow
    await vi.advanceTimersByTimeAsync(100);
    expect(mockWsSendAudio).not.toHaveBeenCalled();
  });
});

describe('AudioPipelineController — tick: silence dropped', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockWsBufferedAmount = 0;
    mockVadIsSpeech = vi.fn(async () => false); // silence
    mockRingRead.mockReturnValue(makeSpeechChunk());
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(async () => {
    await ctrl.stop();
    vi.useRealTimers();
  });

  it('does NOT call ws.sendAudio when VAD returns silence', async () => {
    await vi.advanceTimersByTimeAsync(100);
    expect(mockWsSendAudio).not.toHaveBeenCalled();
  });
});

describe('AudioPipelineController — backpressure', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockVadIsSpeech = vi.fn(async () => true);
    mockRingRead.mockReturnValue(makeSpeechChunk());
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(async () => {
    await ctrl.stop();
    vi.useRealTimers();
  });

  it('skips sendAudio when WS bufferedAmount > 100KB', async () => {
    mockWsBufferedAmount = 110_000; // over threshold
    await vi.advanceTimersByTimeAsync(100);
    expect(mockWsSendAudio).not.toHaveBeenCalled();
  });
});

describe('AudioPipelineController — stop', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockRingRead.mockReturnValue(null);
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('state returns to idle after stop()', async () => {
    await ctrl.stop();
    expect(ctrl.currentState).toBe('idle');
  });

  it('calls capture.stop()', async () => {
    await ctrl.stop();
    expect(mockCaptureStop).toHaveBeenCalledOnce();
  });

  it('calls ws.close()', async () => {
    await ctrl.stop();
    expect(mockWsClose).toHaveBeenCalledOnce();
  });

  it('calls vad.dispose()', async () => {
    await ctrl.stop();
    expect(mockVadDispose).toHaveBeenCalledOnce();
  });

  it('stop() is a no-op when already idle', async () => {
    await ctrl.stop(); // first stop
    await ctrl.stop(); // second — should not throw
    expect(ctrl.currentState).toBe('idle');
  });
});

describe('AudioPipelineController — fatal WS error', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockRingRead.mockReturnValue(null);
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops pipeline on fatal WS error', async () => {
    capturedWsOpts.onFatalError?.('auth_failed');
    // allow the async stop() to run
    await vi.runAllTimersAsync();
    expect(ctrl.currentState).toBe('idle');
  });

  it('relays error to SW via chrome.runtime.sendMessage', async () => {
    capturedWsOpts.onFatalError?.('quota_exceeded');
    await vi.runAllTimersAsync();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pipeline.error', reason: 'quota_exceeded' }),
    );
  });
});

describe('AudioPipelineController — capture start failure', () => {
  it('returns to idle and propagates error when capture.start throws', async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCaptureStart.mockRejectedValueOnce(new Error('invalid streamId'));

    const ctrl = new AudioPipelineController();
    await expect(ctrl.start(DEFAULT_PAYLOAD)).rejects.toThrow('invalid streamId');
    expect(ctrl.currentState).toBe('idle');
    vi.useRealTimers();
  });
});

// ── High 1: no pipeline.frame relay ──────────────────────────────────────────

describe('AudioPipelineController — no pipeline.frame relay (High 1)', () => {
  let ctrl: AudioPipelineController;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ctrl = new AudioPipelineController();
    mockRingRead.mockReturnValue(makeSpeechChunk());
    mockVadIsSpeech = vi.fn(async () => true);
    await ctrl.start(DEFAULT_PAYLOAD);
  });

  afterEach(async () => {
    await ctrl.stop();
    vi.useRealTimers();
  });

  it('does not emit pipeline.frame messages during a pipeline run', async () => {
    // Advance several ticks so the WS frame callback could have fired if wired.
    // capturedWsOpts.onFrame is defined — simulate a frame arriving from backend.
    capturedWsOpts.onFrame?.({ type: 'audio', data: 'base64payload==' });
    capturedWsOpts.onFrame?.({ type: 'transcript', text: 'hello', lang: 'en' });
    await vi.advanceTimersByTimeAsync(300);

    const pipelineFrameCalls = vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(
      (args) => (args[0] as { type?: string })?.type === 'pipeline.frame',
    );
    expect(pipelineFrameCalls).toHaveLength(0);
  });
});
