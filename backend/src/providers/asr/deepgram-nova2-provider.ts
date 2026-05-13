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

  sendAudio(pcm: Buffer): void {
    if (this.socket === null) return;
    this.socket.sendMedia(pcm);
  }

  onTranscript(cb: (t: TranscriptEvent) => void): void {
    this.transcriptCb = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  async stop(): Promise<void> {
    this.stopped = true;
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

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _connect(opts: ASRStartOptions): Promise<void> {
    const socket = await this.client.listen.v1.connect({
      model: 'nova-2',
      encoding: 'linear16',
      sample_rate: opts.sampleRate,
      language: opts.srcLang,
      interim_results: 'true',
      smart_format: 'true',
      Authorization: `Token ${this.apiKey}`,
    } as Parameters<typeof this.client.listen.v1.connect>[0]);

    this.socket = socket;

    socket.on('message', (msg) => {
      // msg is V1Socket.Response — discriminate on type
      const raw = msg as { type?: string; is_final?: boolean; start?: number; channel?: { alternatives?: { transcript?: string }[] } };
      if (raw.type !== 'Results') return;
      const transcript = raw.channel?.alternatives?.[0]?.transcript ?? '';
      if (transcript === '' && !raw.is_final) return; // skip empty interim
      this.transcriptCb?.({
        text: transcript,
        isFinal: raw.is_final ?? false,
        ts: Math.round((raw.start ?? 0) * 1000),
      });
    });

    socket.on('error', (err) => {
      this.errorCb?.(err);
    });

    socket.on('close', (event) => {
      const ev = event as { code?: number };
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
            void this._connect(this.startOpts);
          }
        }, delay);
      }
    });
  }
}
