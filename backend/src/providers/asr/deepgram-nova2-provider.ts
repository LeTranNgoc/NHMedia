import { DeepgramClient } from '@deepgram/sdk';
import type { ASRProvider, ASRStartOptions, TranscriptEvent } from './asr-provider-interface.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deepgram SDK V1Socket type not re-exported from package root
type V1Socket = any;

const BACKOFF_MS = [1000, 2000, 4000] as const;

export interface DeepgramNova2ProviderOptions {
  apiKey: string;
}

export class DeepgramNova2Provider implements ASRProvider {
  private readonly client: DeepgramClient;
  private readonly apiKey: string;
  private socket: V1Socket | null = null;
  private startOpts: ASRStartOptions | null = null;
  private transcriptCb: ((t: TranscriptEvent) => void) | null = null;
  private errorCb: ((err: Error) => void) | null = null;
  private stopped = false;
  private retryCount = 0;
  /** Deepgram WS idle-closes (code 1011) after ~10s of no audio. Even when our
   *  client streams continuously, intermittent pauses + worklet hiccups + VAD
   *  silence-drops can produce >10s gaps → cascade of close+reconnect that
   *  user-visible as random dub interruptions. Periodic KeepAlive resets
   *  Deepgram's idle timer independent of audio flow. SDK-supported pattern. */
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly KEEPALIVE_INTERVAL_MS = 5000;

  constructor(opts: DeepgramNova2ProviderOptions) {
    this.apiKey = opts.apiKey;
    this.client = new DeepgramClient({ apiKey: opts.apiKey });
  }

  async start(opts: ASRStartOptions): Promise<void> {
    this.startOpts = opts;
    this.stopped = false;
    this.retryCount = 0;
    await this._connect(opts);
  }

  private _audioSentCount = 0;
  private _audioErrorCount = 0;
  sendAudio(pcm: Buffer): void {
    if (this.socket === null) return;
    try {
      this.socket.sendMedia(pcm);
      this._audioSentCount++;
      if (this._audioSentCount === 1 || this._audioSentCount % 100 === 0) {
        console.info(
          `[deepgram] audio sent #${this._audioSentCount} (bytes=${pcm.length}, first4=${pcm.subarray(0, 4).toString('hex')})`,
        );
      }
    } catch (err) {
      this._audioErrorCount++;
      if (this._audioErrorCount === 1 || this._audioErrorCount % 100 === 0) {
        console.warn(
          `[deepgram] sendMedia threw #${this._audioErrorCount}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  onTranscript(cb: (t: TranscriptEvent) => void): void {
    this.transcriptCb = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this._stopKeepAlive();
    if (this.socket !== null) {
      try {
        this.socket.sendCloseStream({ type: 'CloseStream' });
      } catch {
        // ignore — socket may already be closing
      }
      this.socket.close();
      this.socket = null;
    }
  }

  private _startKeepAlive(): void {
    this._stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.socket === null) return;
      try {
        this.socket.sendKeepAlive({ type: 'KeepAlive' });
      } catch (err) {
        console.warn(
          `[deepgram] sendKeepAlive threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }, this.KEEPALIVE_INTERVAL_MS);
  }

  private _stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _connect(opts: ASRStartOptions): Promise<void> {
    console.info(
      `[deepgram] connecting (srcLang=${opts.srcLang}, sampleRate=${opts.sampleRate}, apiKey=${this.apiKey ? `${this.apiKey.slice(0, 4)}…${this.apiKey.length}ch` : 'EMPTY'})`,
    );
    // SDK v5: Authorization MUST be in connect args — constructor's apiKey
    // does NOT auto-inject into WS upgrade headers (only sets up authProvider
    // for REST endpoints, not WebSocket). Without it the WS handshake never
    // gets an upgrade response and the socket hangs CONNECTING forever.
    // interim_results / smart_format types in SDK are string 'true'/'false'.
    // Endpointing 200ms (L1 tweak from 300ms): how long Deepgram waits for
    // silence before firing `is_final=true`. 50-100ms previously caused
    // sentence fragments. 200ms is a middle-ground: -100ms latency vs 300ms
    // while still catching natural sentence boundaries. If fragments resurge
    // (lặp câu rate climbs), revert to 300ms.
    const socket = await this.client.listen.v1.connect({
      model: 'nova-2',
      encoding: 'linear16',
      sample_rate: opts.sampleRate,
      language: opts.srcLang,
      interim_results: 'true',
      smart_format: 'true',
      endpointing: '200',
      Authorization: `Token ${this.apiKey}`,
    } as Parameters<typeof this.client.listen.v1.connect>[0]);

    this.socket = socket;
    console.info('[deepgram] socket created — calling connect() + awaiting open');

    // SDK quirk: `client.listen.v1.connect({...})` only CREATES the V1Socket
    // wrapper — readyState stays at 3 (CLOSED) until you call `.connect()` on
    // the wrapper, which calls `socket.reconnect()` internally and triggers
    // the actual WS handshake. Without this, the socket never opens and
    // sendMedia throws "Socket is not open" forever.
    (socket as { connect?: () => void }).connect?.();

    // Wait for the underlying WS to actually open (poll readyState w/ 5s timeout
    // + close-before-open detection — SDK's own waitForOpen has a race).
    await this._waitForSocketOpen(socket);
    // Reset retry budget on every healthy open. Without this, long sessions
    // burn through BACKOFF_MS once and then any 4th transient close (very
    // common over hours) leaves the socket permanently dead — audio frames
    // sink into sendMedia() while Dịch counter flatlines.
    this.retryCount = 0;
    this._startKeepAlive();
    console.info('[deepgram] socket OPEN — ready for audio');

    let messageCount = 0;
    socket.on('message', (msg) => {
      messageCount++;
      if (messageCount <= 3 || messageCount % 50 === 0) {
        console.info(
          `[deepgram] message #${messageCount}: type=${(msg as { type?: string }).type ?? 'unknown'} raw=${JSON.stringify(msg).slice(0, 200)}`,
        );
      }
      // msg is V1Socket.Response — discriminate on type
      const raw = msg as {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        start?: number;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      // ANY Deepgram message (Results, Metadata, SpeechStarted, UtteranceEnd…)
      // proves the socket is alive and processing. Fire transcriptCb so the
      // relay can ACK backpressure on it. Non-Results messages are forwarded
      // with empty text — relay skips client-forward but still drains BP.
      if (raw.type !== 'Results') {
        this.transcriptCb?.({ text: '', isFinal: false, ts: 0 });
        return;
      }
      const transcript = raw.channel?.alternatives?.[0]?.transcript ?? '';
      // Utterance boundary detection — three-signal:
      // 1. speech_final=true: Deepgram saw 300ms silence after speech (true
      //    utterance end). Rare on continuous tech-talk content where speakers
      //    don't pause — empirically 3 dubs per 30min video.
      // 2. is_final=true + sentence-ending punctuation: smart_format inserts
      //    `.` `?` `!` at natural sentence breaks. Catches sentence ends
      //    when speaker continues straight to next sentence without 300ms gap.
      // 3. is_final=true + transcript ≥ 100 chars: force-emit on long segments
      //    even without sentence punctuation. Covers continuous speech that
      //    uses commas/colons but no periods — Vietnamese transcript also
      //    sometimes lacks `.` from Deepgram's punctuation model.
      const hasSentenceEnd = /[.?!]\s*$/.test(transcript);
      // L1 tweak: 30 chars ≈ 2.5s of speech at 150 wpm — aggressive cut to
      // reduce dub latency from ~7s to ~4-5s. Trade-off: mid-clause cuts
      // possible on long sentences (was 60). If lặp-câu rate climbs >5%,
      // revert to 60 or 80.
      const tooLong = raw.is_final === true && transcript.length >= 30;
      const isUtteranceEnd =
        raw.speech_final === true || (raw.is_final === true && hasSentenceEnd) || tooLong;
      this.transcriptCb?.({
        text: transcript,
        isFinal: isUtteranceEnd,
        ts: Math.round((raw.start ?? 0) * 1000),
      });
    });

    socket.on('error', (err) => {
      console.warn('[deepgram] socket error:', err instanceof Error ? err.message : String(err));
      this.errorCb?.(err);
    });

    socket.on('close', (event) => {
      const ev = event as { code?: number; reason?: string };
      console.info(`[deepgram] socket close code=${ev.code} reason=${ev.reason ?? ''}`);
      this._stopKeepAlive();
      if (this.stopped) return; // intentional stop — no reconnect

      // Auth errors (e.g. 1008 Policy Violation) — do not reconnect
      if (ev.code === 1008) {
        this.errorCb?.(new Error('asr_auth'));
        return;
      }

      // Transient close — exponential backoff reconnect
      if (this.retryCount < BACKOFF_MS.length) {
        const delay = BACKOFF_MS[this.retryCount++];
        setTimeout(() => {
          if (!this.stopped && this.startOpts !== null) {
            this._connect(this.startOpts).catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[deepgram] reconnect attempt failed: ${msg}`);
              this.errorCb?.(err instanceof Error ? err : new Error(msg));
            });
          }
        }, delay);
        return;
      }

      // Retries exhausted — surface to relay so it can close the WS and let
      // the client reconnect with a fresh session (which gets retryCount=0).
      // Silent here = audio frames black-hole forever.
      console.warn(
        `[deepgram] reconnect exhausted after ${this.retryCount} attempts — signalling client`,
      );
      this.errorCb?.(new Error('asr_reconnect_exhausted'));
    });
  }

  /**
   * Promise-ify the socket's open event with a 5s timeout AND a close-before-open
   * trap. SDK's waitForOpen() only listens for 'open' and 'error' — if Deepgram
   * closes (code 1000/1008/etc) before opening, the promise never resolves and
   * the entire relay session hangs. Reject explicitly on close so the caller
   * can surface a real error to the client.
   */
  private _waitForSocketOpen(socket: V1Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (pollTimer !== null) clearInterval(pollTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      };

      const settleOk = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const settleErr = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      // Fast path: already OPEN
      const rsNow = (socket as { readyState?: number }).readyState;
      if (rsNow === 1 /* OPEN */) {
        settleOk();
        return;
      }

      // Poll readyState — covers race where 'open' fires before our listener
      // AND detects close-before-open (SDK doesn't expose a single Promise for that).
      pollTimer = setInterval(() => {
        const rs = (socket as { readyState?: number }).readyState;
        if (rs === 1) settleOk();
        else if (rs === 2 || rs === 3) {
          settleErr(new Error(`[deepgram] socket closed before open (readyState=${rs})`));
        }
      }, 50);

      timeoutTimer = setTimeout(() => {
        settleErr(new Error('[deepgram] waitForOpen timeout (5s)'));
      }, 5000);
    });
  }
}
