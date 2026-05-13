import { AUDIO_CONFIG } from '../shared/audio-config';

export interface WsFrame {
  type: string;
  [key: string]: unknown;
}

export type WsFrameCallback = (frame: WsFrame) => void;
export type WsErrorCallback = (reason: string) => void;

export interface WsClientOptions {
  wsUrl: string;
  token: string;
  srcLang: string;
  onFrame?: WsFrameCallback;
  /** Called on terminal close codes (4001 auth fail, 4003 quota) — no reconnect. */
  onFatalError?: WsErrorCallback;
  /** Called when a reconnect attempt starts (attempt index 0-based). */
  onReconnecting?: (attempt: number) => void;
}

/**
 * WebSocket client with exponential-backoff reconnect.
 *
 * Close code policy:
 *   4001 — auth failure → fatal, no reconnect
 *   4003 — quota exceeded → fatal, no reconnect
 *   4xxx (other) — treated as fatal to be safe
 *   1000 (normal) — no reconnect (clean stop)
 *   everything else → reconnect with exp backoff + jitter
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly opts: Required<WsClientOptions>;

  constructor(opts: WsClientOptions) {
    this.opts = {
      onFrame: () => {},
      onFatalError: () => {},
      onReconnecting: () => {},
      ...opts,
    };
  }

  /** Open the connection. Safe to call once; use reconnect logic for retries. */
  connect(): void {
    if (this.ws) return;
    this.stopped = false;
    this.openSocket();
  }

  /** Send raw PCM Int16 bytes as a binary WS frame. */
  sendAudio(buffer: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(buffer.buffer);
  }

  /** Send a JSON control frame. */
  sendControl(frame: WsFrame): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  /** How many bytes are buffered in the send queue. 0 if not connected. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Graceful shutdown — no reconnect. */
  close(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'client stop');
      this.ws = null;
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildUrl(): string {
    const { wsUrl, token, srcLang } = this.opts;
    return `${wsUrl}?token=${encodeURIComponent(token)}&srcLang=${encodeURIComponent(srcLang)}`;
  }

  private openSocket(): void {
    const url = this.buildUrl();
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempt = 0;
    });

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const frame = JSON.parse(ev.data) as WsFrame;
          this.opts.onFrame(frame);
        } catch {
          console.warn('[ws-client] unparseable JSON frame ignored');
        }
      }
      // Binary frames from server are not expected per spec — ignore silently.
    });

    ws.addEventListener('close', (ev) => {
      this.ws = null;
      if (this.stopped) return;

      const isFatal =
        ev.code === 1000 || // normal closure
        ev.code === 4001 || // auth fail
        ev.code === 4003 || // quota exceeded
        (ev.code >= 4000 && ev.code <= 4999); // all 4xxx treated as fatal

      if (isFatal) {
        const reason = ev.code === 4001
          ? 'auth_failed'
          : ev.code === 4003
            ? 'quota_exceeded'
            : ev.code === 1000
              ? 'closed'
              : `fatal_close_${ev.code}`;
        this.opts.onFatalError(reason);
        return;
      }

      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'error' is always followed by 'close' — reconnect logic lives in close handler.
    });
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempt;
    this.opts.onReconnecting(attempt);

    const base = AUDIO_CONFIG.WS_RECONNECT_BASE_MS;
    const max = AUDIO_CONFIG.WS_RECONNECT_MAX_MS;
    const jitter = AUDIO_CONFIG.WS_RECONNECT_JITTER_MS;

    // Exp backoff: base × 2^attempt, capped at max, ±jitter
    const delay = Math.min(base * Math.pow(2, attempt), max)
      + (Math.random() * 2 - 1) * jitter;

    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) {
        this.openSocket();
      }
    }, Math.max(0, delay));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
