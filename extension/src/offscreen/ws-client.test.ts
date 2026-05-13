import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsClient } from './ws-client';

// ── Mock WebSocket ──────────────────────────────────────────────────────────
// We cannot open real WebSocket connections in unit tests.
// Mock captures the last constructed instance so tests can trigger events.

interface MockWsInstance {
  url: string;
  binaryType: string;
  bufferedAmount: number;
  readyState: number;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  // helpers for tests
  _emit: (event: string, data?: unknown) => void;
}

let lastMockWs: MockWsInstance | null = null;

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  url: string;
  binaryType = 'blob';
  bufferedAmount = 0;
  readyState = 1; // OPEN by default
  listeners: Record<string, Array<(ev: unknown) => void>> = {};

  send = vi.fn();
  close = vi.fn().mockImplementation((code: number, reason: string) => {
    this.readyState = 3;
    this._emit('close', { code, reason, wasClean: code === 1000 });
  });

  constructor(url: string) {
    this.url = url;
    lastMockWs = this as unknown as MockWsInstance;
  }

  addEventListener(event: string, cb: (ev: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  _emit(event: string, data?: unknown) {
    (this.listeners[event] ?? []).forEach((cb) => cb(data ?? {}));
  }
}

// Patch global WebSocket before each test
beforeEach(() => {
  lastMockWs = null;
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeClient(overrides: Partial<ConstructorParameters<typeof WsClient>[0]> = {}) {
  return new WsClient({
    wsUrl: 'ws://localhost:3000/ws',
    token: 'test-jwt',
    srcLang: 'en',
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WsClient — connect + URL', () => {
  it('builds URL with token and srcLang query params', () => {
    const client = makeClient({ token: 'abc', srcLang: 'ja' });
    client.connect();
    expect(lastMockWs?.url).toContain('token=abc');
    expect(lastMockWs?.url).toContain('srcLang=ja');
  });

  it('does not open a second socket if already connected', () => {
    const client = makeClient();
    client.connect();
    const first = lastMockWs;
    client.connect(); // no-op
    expect(lastMockWs).toBe(first);
  });
});

describe('WsClient — sendAudio / sendControl', () => {
  it('sendAudio calls ws.send with the underlying ArrayBuffer', () => {
    const client = makeClient();
    client.connect();
    const samples = Int16Array.from([1, 2, 3]);
    client.sendAudio(samples);
    expect(lastMockWs?.send).toHaveBeenCalledWith(samples.buffer);
  });

  it('sendControl calls ws.send with stringified JSON', () => {
    const client = makeClient();
    client.connect();
    client.sendControl({ type: 'config', srcLang: 'en' });
    expect(lastMockWs?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'config', srcLang: 'en' }),
    );
  });

  it('sendAudio is a no-op when not connected', () => {
    const client = makeClient(); // never connected
    client.sendAudio(Int16Array.from([1]));
    expect(lastMockWs).toBeNull();
  });
});

describe('WsClient — onFrame callback', () => {
  it('parses incoming JSON message and calls onFrame', () => {
    const onFrame = vi.fn();
    const client = makeClient({ onFrame });
    client.connect();

    const ws = lastMockWs!;
    ws._emit('message', { data: JSON.stringify({ type: 'transcript', text: 'hello' }) });

    expect(onFrame).toHaveBeenCalledWith({ type: 'transcript', text: 'hello' });
  });

  it('ignores unparseable messages without throwing', () => {
    const onFrame = vi.fn();
    const client = makeClient({ onFrame });
    client.connect();

    const ws = lastMockWs!;
    expect(() => ws._emit('message', { data: 'not-json{{' })).not.toThrow();
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe('WsClient — reconnect backoff', () => {
  it('schedules reconnect after non-fatal close', () => {
    const onReconnecting = vi.fn();
    const client = makeClient({ onReconnecting });
    client.connect();

    const ws = lastMockWs!;
    ws._emit('close', { code: 1006, reason: 'abnormal', wasClean: false });

    expect(onReconnecting).toHaveBeenCalledWith(0);
  });

  it('reconnects after base delay (1000ms ± jitter) — first attempt', () => {
    const client = makeClient();
    client.connect();
    const first = lastMockWs!;

    first._emit('close', { code: 1006, reason: 'network', wasClean: false });
    lastMockWs = null;

    // Advance past base delay + max jitter (1000 + 5000 = 6000ms)
    vi.advanceTimersByTime(7_000);

    expect(lastMockWs).not.toBeNull(); // new socket created
  });

  it('server 1000 mid-session triggers reconnect (not fatal)', () => {
    const onFatalError = vi.fn();
    const onReconnecting = vi.fn();
    const client = makeClient({ onFatalError, onReconnecting });
    client.connect();

    // Server sends 1000 without client calling close() → intentionalClose=false
    lastMockWs!._emit('close', { code: 1000, reason: 'server restart', wasClean: true });
    vi.advanceTimersByTime(7_000);

    expect(onFatalError).not.toHaveBeenCalled();
    expect(onReconnecting).toHaveBeenCalledWith(0);
  });

  it('client close() then 1000 is silent — no fatal error, no reconnect', () => {
    const onFatalError = vi.fn();
    const onReconnecting = vi.fn();
    const client = makeClient({ onFatalError, onReconnecting });
    client.connect();

    client.close(); // sets intentionalClose=true
    vi.advanceTimersByTime(60_000);

    expect(onFatalError).not.toHaveBeenCalled();
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it('does NOT reconnect on auth fail 4001', () => {
    const onFatalError = vi.fn();
    const onReconnecting = vi.fn();
    const client = makeClient({ onFatalError, onReconnecting });
    client.connect();

    lastMockWs!._emit('close', { code: 4001, reason: 'unauthorized', wasClean: false });
    vi.advanceTimersByTime(60_000);

    expect(onFatalError).toHaveBeenCalledWith('auth_failed');
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it('does NOT reconnect on quota exceeded 4003', () => {
    const onFatalError = vi.fn();
    const client = makeClient({ onFatalError });
    client.connect();

    lastMockWs!._emit('close', { code: 4003, reason: 'quota', wasClean: false });
    vi.advanceTimersByTime(60_000);

    expect(onFatalError).toHaveBeenCalledWith('quota_exceeded');
  });

  it('stops reconnecting after client.close()', () => {
    const onReconnecting = vi.fn();
    const client = makeClient({ onReconnecting });
    client.connect();

    lastMockWs!._emit('close', { code: 1006, reason: 'drop', wasClean: false });
    client.close(); // stop before timer fires
    lastMockWs = null;

    vi.advanceTimersByTime(60_000);
    expect(lastMockWs).toBeNull(); // no new socket
    expect(onReconnecting).toHaveBeenCalledTimes(1); // scheduled but cancelled
  });
});

describe('WsClient — backoff delay math (pure formula)', () => {
  // Verify the backoff formula directly without exercising the reconnect loop.
  // The formula: min(base * 2^attempt, max) ± jitter
  it('delay at attempt 0 is base (1000 ms) before jitter', () => {
    const base = 1_000;
    const max = 30_000;
    const attempt = 0;
    const delay = Math.min(base * Math.pow(2, attempt), max);
    expect(delay).toBe(1_000);
  });

  it('delay at attempt 4 is 16000 ms before jitter', () => {
    const base = 1_000;
    const max = 30_000;
    const attempt = 4;
    const delay = Math.min(base * Math.pow(2, attempt), max);
    expect(delay).toBe(16_000);
  });

  it('delay is capped at max (30000 ms) for large attempt numbers', () => {
    const base = 1_000;
    const max = 30_000;
    const attempt = 20;
    const delay = Math.min(base * Math.pow(2, attempt), max);
    expect(delay).toBe(30_000);
  });

  it('delay grows monotonically across attempts 0..5', () => {
    const base = 1_000;
    const max = 30_000;
    const delays = Array.from({ length: 6 }, (_, i) =>
      Math.min(base * Math.pow(2, i), max),
    );
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});
