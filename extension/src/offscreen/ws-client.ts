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
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Control frames sent before WS reaches OPEN state are queued and flushed
  // on 'open'. Without this, the initial config frame (sent right after connect())
  // is silently dropped, leaving backend in asrStarted=false and discarding all audio.
  private pendingControlFrames: WsFrame[] = [];

  // Sticky control frames (e.g. config) — re-sent on EVERY open event, including
  // reconnects. Backend treats each WS connection as a fresh session (asrStarted=false
  // until config arrives) so reconnects MUST re-send config or audio is dropped silently.
  private stickyControlFrames: WsFrame[] = [];

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
    this.intentionalClose = false;
    this.openSocket();
  }

  /** Send raw PCM Int16 bytes as a binary WS frame. */
  sendAudio(buffer: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (!this._firstAudioLogged) {
      this._firstAudioLogged = true;
      console.info(
        `[ws] first audio frame send — stickyCount=${this.stickyControlFrames.length} (config must be in this array or already flushed)`,
      );
    }
    this.ws.send(buffer.buffer);
  }
  private _firstAudioLogged = false;

  /** Send a JSON control frame. Queues frames sent before WS is OPEN. */
  sendControl(frame: WsFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return;
    }
    // CONNECTING / CLOSING / CLOSED — queue and flush on next 'open'.
    this.pendingControlFrames.push(frame);
  }

  /**
   * Send a control frame AND remember it for re-send on every reconnect.
   * Use for session-defining frames like 'config' that the backend must see
   * on every new WS connection. The frame is stored in stickyControlFrames so
   * the 'open' handler emits it on every (re)connect. If WS is already OPEN
   * when called, send immediately as well. NEVER queue into pendingControlFrames
   * — that would cause a duplicate send when the open handler flushes both.
   */
  sendStickyControl(frame: WsFrame): void {
    this.stickyControlFrames.push(frame);
    const state = this.ws?.readyState;
    console.info(
      `[ws] sendStickyControl type=${frame.type} — readyState=${state} (0=CONNECTING 1=OPEN), stickyCount=${this.stickyControlFrames.length}`,
    );
    if (state === WebSocket.OPEN) {
      this.ws!.send(JSON.stringify(frame));
      console.info(`[ws] sendStickyControl type=${frame.type} — sent immediately (OPEN)`);
    }
    // Not OPEN yet → rely on 'open' handler flushing stickyControlFrames.
  }

  /**
   * Send a caption chunk as a control frame.
   * Used in subtitle-first mode — bypasses Deepgram ASR on backend.
   */
  sendCaption(text: string, ts: number): void {
    this.sendControl({ type: 'caption', text, ts, isFinal: true });
  }

  /** How many bytes are buffered in the send queue. 0 if not connected. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Graceful shutdown — no reconnect. */
  close(): void {
    this.stopped = true;
    this.intentionalClose = true;
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
      console.info(
        '[ws] open — flushing',
        this.pendingControlFrames.length,
        'queued +',
        this.stickyControlFrames.length,
        'sticky control frames',
      );
      this.reconnectAttempt = 0;
      // Re-send sticky frames FIRST (config must arrive before audio on every reconnect).
      for (const frame of this.stickyControlFrames) {
        ws.send(JSON.stringify(frame));
      }
      // Then drain the one-shot queue.
      for (const frame of this.pendingControlFrames) {
        ws.send(JSON.stringify(frame));
      }
      this.pendingControlFrames = [];
    });

    const seenFrameTypes = new Set<string>();
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const frame = JSON.parse(ev.data) as WsFrame;
          if (!seenFrameTypes.has(frame.type)) {
            seenFrameTypes.add(frame.type);
            console.info('[ws] first frame type=', frame.type, 'full:', frame);
          }
          if (frame.type === 'error') {
            console.error('[ws] error frame from server:', frame);
          }
          this.opts.onFrame(frame);
        } catch {
          console.warn('[ws-client] unparseable JSON frame ignored');
        }
      }
      // Binary frames from server are not expected per spec — ignore silently.
    });

    ws.addEventListener('close', (ev) => {
      console.info('[ws] close code=', ev.code, 'reason=', ev.reason);
      this.ws = null;
      if (this.stopped) return;

      // 1000 from *client* (intentionalClose flag set by close()) → silent stop.
      // 1000 from *server* mid-session → treat as unexpected; trigger reconnect.
      if (ev.code === 1000 && this.intentionalClose) {
        return; // client-initiated clean close — no callback needed
      }

      const isFatal =
        ev.code === 4001 || // auth fail
        ev.code === 4003 || // quota exceeded
        (ev.code >= 4000 && ev.code <= 4999); // all 4xxx treated as fatal

      if (isFatal) {
        const reason =
          ev.code === 4001
            ? 'auth_failed'
            : ev.code === 4003
              ? 'quota_exceeded'
              : `fatal_close_${ev.code}`;
        this.opts.onFatalError(reason);
        return;
      }

      // 1000 server-initiated mid-session and all non-fatal codes → reconnect
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
    const delay = Math.min(base * Math.pow(2, attempt), max) + (Math.random() * 2 - 1) * jitter;

    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(
      () => {
        if (!this.stopped) {
          this.openSocket();
        }
      },
      Math.max(0, delay),
    );
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
