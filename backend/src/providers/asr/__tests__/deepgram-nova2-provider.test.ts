import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepgramNova2Provider } from '../deepgram-nova2-provider.js';

// ── Mock @deepgram/sdk ─────────────────────────────────────────────────────────
// Keep a reference to the fake socket so tests can trigger events on it.
let mockSocket: {
  on: ReturnType<typeof vi.fn>;
  sendMedia: ReturnType<typeof vi.fn>;
  sendFinalize: ReturnType<typeof vi.fn>;
  sendCloseStream: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  _handlers: Record<string, ((...args: unknown[]) => void)[]>;
  _emit: (event: string, ...args: unknown[]) => void;
};

function makeMockSocket() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    }),
    sendMedia: vi.fn(),
    sendFinalize: vi.fn(),
    sendCloseStream: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    _handlers: handlers,
    _emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((cb) => cb(...args));
    },
  };
  return socket;
}

vi.mock('@deepgram/sdk', () => {
  const connect = vi.fn(async () => {
    mockSocket = makeMockSocket();
    // Simulate open event after connect resolves
    return mockSocket;
  });

  return {
    DeepgramClient: vi.fn().mockImplementation(() => ({
      listen: {
        v1: {
          connect,
        },
      },
    })),
  };
});

describe('DeepgramNova2Provider', () => {
  let provider: DeepgramNova2Provider;

  beforeEach(() => {
    provider = new DeepgramNova2Provider({ apiKey: 'test-key' });
  });

  afterEach(async () => {
    await provider.stop().catch(() => {
      // ignore
    });
    vi.clearAllMocks();
  });

  it('start() connects to Deepgram with correct config', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });

    const { DeepgramClient } = await import('@deepgram/sdk');
    const instance = (DeepgramClient as ReturnType<typeof vi.fn>).mock.results[0].value as {
      listen: { v1: { connect: ReturnType<typeof vi.fn> } };
    };
    expect(instance.listen.v1.connect).toHaveBeenCalledOnce();
    const args = instance.listen.v1.connect.mock.calls[0][0] as Record<string, unknown>;
    expect(args.encoding).toBe('linear16');
    expect(args.sample_rate).toBe(16000);
    expect(args.language).toBe('en');
    // SDK types require string 'true'/'false' — not booleans
    expect(args.interim_results).toBe('true');
    expect(args.smart_format).toBe('true');
    expect(args.model).toBe('nova-2');
  });

  it('sendAudio() forwards buffer to Deepgram socket', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });
    const buf = Buffer.alloc(3200);
    provider.sendAudio(buf);
    expect(mockSocket.sendMedia).toHaveBeenCalledWith(buf);
  });

  it('onTranscript callback is invoked when Deepgram emits Results', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });

    const cb = vi.fn();
    provider.onTranscript(cb);

    // Simulate a Deepgram Results event
    const fakeResult = {
      type: 'Results',
      is_final: false,
      start: 0.5,
      channel: {
        alternatives: [{ transcript: 'hello world', confidence: 0.99, words: [] }],
      },
    };
    mockSocket._emit('message', fakeResult);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      text: 'hello world',
      isFinal: false,
      ts: 500, // start * 1000
    });
  });

  it('isFinal=true for is_final + sentence-ending punctuation (continuous-speech fallback)', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });
    const cb = vi.fn();
    provider.onTranscript(cb);

    // is_final=true, speech_final=false (mid-paragraph), but ends with period
    // → treat as utterance end. Fixes "3 dubs per 30min" on continuous talks
    // where speech_final never fires due to no 300ms silence.
    mockSocket._emit('message', {
      type: 'Results',
      is_final: true,
      speech_final: false,
      start: 1.0,
      channel: { alternatives: [{ transcript: 'Hello world.' }] },
    });
    expect(cb).toHaveBeenCalledWith({ text: 'Hello world.', isFinal: true, ts: 1000 });

    cb.mockClear();

    // is_final=true but NO sentence punctuation (mid-sentence segment) → not final
    mockSocket._emit('message', {
      type: 'Results',
      is_final: true,
      speech_final: false,
      start: 2.0,
      channel: { alternatives: [{ transcript: 'And then I saw' }] },
    });
    expect(cb).toHaveBeenCalledWith({ text: 'And then I saw', isFinal: false, ts: 2000 });

    cb.mockClear();

    // speech_final=true always wins, regardless of punctuation
    mockSocket._emit('message', {
      type: 'Results',
      is_final: true,
      speech_final: true,
      start: 3.0,
      channel: { alternatives: [{ transcript: 'final segment no period' }] },
    });
    expect(cb).toHaveBeenCalledWith({
      text: 'final segment no period',
      isFinal: true,
      ts: 3000,
    });
  });

  it('onTranscript called with empty heartbeat for Metadata events (drains BP)', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });

    const cb = vi.fn();
    provider.onTranscript(cb);

    mockSocket._emit('message', { type: 'Metadata', request_id: 'abc' });
    // Heartbeat: empty text, non-final. Relay uses it to ACK backpressure but
    // skips client-forward + orchestrator dispatch.
    expect(cb).toHaveBeenCalledWith({ text: '', isFinal: false, ts: 0 });
  });

  it('stop() sends CloseStream and closes socket', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });
    await provider.stop();
    expect(mockSocket.sendCloseStream).toHaveBeenCalled();
    expect(mockSocket.close).toHaveBeenCalled();
  });

  it('emits error event on Deepgram auth error', async () => {
    await provider.start({ srcLang: 'en', sampleRate: 16000 });

    const errCb = vi.fn();
    provider.onError(errCb);

    mockSocket._emit('error', new Error('Unauthorized'));
    expect(errCb).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
  });

  describe('reconnect on transient close', () => {
    it('reopens connection after transient close (non-auth close code)', async () => {
      vi.useFakeTimers();

      await provider.start({ srcLang: 'en', sampleRate: 16000 });

      // Simulate transient WS close (code 1006 = abnormal)
      mockSocket._emit('close', { code: 1006, reason: 'abnormal' });

      // Fast-forward first backoff (1s)
      await vi.advanceTimersByTimeAsync(1100);

      const { DeepgramClient } = await import('@deepgram/sdk');
      const instance = (DeepgramClient as ReturnType<typeof vi.fn>).mock.results[0].value as {
        listen: { v1: { connect: ReturnType<typeof vi.fn> } };
      };
      // connect called twice: initial + reconnect
      expect(instance.listen.v1.connect).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not reconnect on intentional stop (clean close)', async () => {
      vi.useFakeTimers();

      await provider.start({ srcLang: 'en', sampleRate: 16000 });
      await provider.stop();

      // Simulate the close event that follows stop()
      mockSocket._emit('close', { code: 1000, reason: 'normal' });

      await vi.advanceTimersByTimeAsync(2000);

      const { DeepgramClient } = await import('@deepgram/sdk');
      const instance = (DeepgramClient as ReturnType<typeof vi.fn>).mock.results[0].value as {
        listen: { v1: { connect: ReturnType<typeof vi.fn> } };
      };
      // still only 1 connect call (no reconnect)
      expect(instance.listen.v1.connect).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
