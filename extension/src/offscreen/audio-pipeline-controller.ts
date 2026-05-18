import { AUDIO_CONFIG } from '../shared/audio-config';
import { RingBuffer } from './ring-buffer';
import { AudioCapture } from './audio-capture';
import { SileroVad } from './vad-silero';
import { WsClient } from './ws-client';
import type { WsFrame } from './ws-client';
import { AudioPlaybackQueue } from './audio-playback-queue';
import { WsReceiver } from './ws-receiver';
import { WebSpeechTtsQueue } from './web-speech-tts-queue';

export interface PipelineConfig {
  srcLang: string;
  targetLang: string;
  wsUrl: string;
  jwt: string;
  audioMode: 'voice-over' | 'replacement';
  /** 'subtitle' skips AudioCapture + RingBuffer + VAD; only WS + playback are started. */
  sourceMode?: 'audio' | 'subtitle';
  /** Browser TTS playback rate (0.5..2.0). Defaults to 1.3 in WebSpeechTtsQueue. */
  speechRate?: number;
}

export interface StartPayload {
  streamId: string;
  config: PipelineConfig;
}

type PipelineState = 'idle' | 'starting' | 'running' | 'stopping';

/**
 * Orchestrates the full audio pipeline:
 *   AudioCapture → RingBuffer → SileroVAD → WSClient (outbound)
 *   WSClient → WsReceiver → AudioPlaybackQueue (inbound TTS)
 *
 * Tick loop runs every CHUNK_DURATION_MS (100 ms):
 *   1. Read one chunk from ring buffer (3200 bytes = 1600 Int16 samples)
 *   2. Run VAD — if silence (past hangover), drop the chunk
 *   3. Check WS backpressure — if bufferedAmount > 100 KB, skip + log
 *   4. Send speech chunk over WS
 *
 * Incoming WS frames are dispatched via WsReceiver:
 *   - audio frames → AudioPlaybackQueue
 *   - transcript/translation frames → chrome.runtime.sendMessage → SW → content script
 */
export class AudioPipelineController {
  private state: PipelineState = 'idle';

  private ringBuffer: RingBuffer | null = null;
  private capture: AudioCapture | null = null;
  private vad: SileroVad | null = null;
  private ws: WsClient | null = null;
  private playbackQueue: AudioPlaybackQueue | null = null;
  private wsReceiver: WsReceiver | null = null;
  private playbackCtx: AudioContext | null = null;
  private webSpeech: WebSpeechTtsQueue | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // Diagnostic counters — logged every 50 ticks (~5 s)
  private stats = { ticks: 0, chunksRead: 0, speech: 0, sent: 0, backpressure: 0 };

  /** Samples per chunk = 100 ms × 16 kHz = 1600 */
  private readonly CHUNK_SAMPLES = AUDIO_CONFIG.CHUNK_BYTE_SIZE / 2; // Int16 = 2 bytes/sample

  async start(payload: StartPayload): Promise<void> {
    if (this.state !== 'idle') {
      console.warn('[pipeline] start() called while not idle:', this.state);
      return;
    }
    this.state = 'starting';

    const { streamId, config } = payload;
    const isSubtitleMode = config.sourceMode === 'subtitle';

    try {
      if (!isSubtitleMode) {
        // 1. Ring buffer
        this.ringBuffer = new RingBuffer();

        // 2. VAD
        this.vad = new SileroVad();
        await this.vad.load();
        if (this.vad.isFallback) {
          console.warn('[pipeline] VAD in fallback mode — all audio will be sent');
        }
      } else {
        console.info('[pipeline] subtitle mode — skipping AudioCapture + RingBuffer + VAD');
      }

      // 3. AudioContext for TTS playback (separate from capture context)
      // Chrome offscreen documents can start AudioContext in 'suspended' state
      // — explicit resume() is required for TTS playback to be audible.
      this.playbackCtx = new AudioContext();
      console.info('[pipeline] playbackCtx state before resume:', this.playbackCtx.state);
      try {
        await this.playbackCtx.resume();
      } catch (e) {
        console.error('[pipeline] playbackCtx.resume() failed:', e);
      }
      console.info('[pipeline] playbackCtx state after resume:', this.playbackCtx.state);
      this.playbackQueue = new AudioPlaybackQueue(this.playbackCtx);
      // Browser-native TTS — zero server cost when a vi-VN voice is present.
      // Falls back transparently to AudioPlaybackQueue (server audio frames)
      // when the OS lacks a Vietnamese voice — see WsReceiver.handleFrame.
      this.webSpeech = new WebSpeechTtsQueue();
      if (config.speechRate !== undefined) {
        this.webSpeech.setRate(config.speechRate);
      }
      console.info(
        `[pipeline] web-speech tts: ${
          this.webSpeech.isSupported()
            ? `enabled (voice="${this.webSpeech.voiceName()}", rate=${config.speechRate ?? '1.3 default'})`
            : 'unsupported — using server TTS audio frames'
        }`,
      );
      this.wsReceiver = new WsReceiver(this.playbackQueue, this.webSpeech);

      // 4. WS — onFrame now routes through WsReceiver
      this.ws = new WsClient({
        wsUrl: config.wsUrl,
        token: config.jwt,
        srcLang: config.srcLang,
        onFrame: (frame) => this.handleFrame(frame),
        onFatalError: (reason) => this.handleFatalError(reason),
        onReconnecting: (attempt) => console.info(`[pipeline] WS reconnecting, attempt ${attempt}`),
      });
      this.ws.connect();

      // Sticky: re-sent on every WS reconnect. Backend treats each new WS as a
      // fresh session — without sticky resend, audio after reconnect arrives
      // with asrStarted=false and gets dropped silently.
      this.ws.sendStickyControl({
        type: 'config',
        srcLang: config.srcLang,
        targetLang: config.targetLang,
        audioMode: config.audioMode,
      });

      if (!isSubtitleMode) {
        // 5. Audio capture (getUserMedia + worklet)
        this.capture = new AudioCapture(this.ringBuffer!);
        await this.capture.start(streamId);

        // 6. Start tick loop
        this.tickTimer = setInterval(() => {
          void this.tick();
        }, AUDIO_CONFIG.CHUNK_DURATION_MS);
      }

      this.state = 'running';
    } catch (err) {
      this.state = 'idle';
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Forward a caption chunk over WebSocket.
   * Only meaningful in subtitle mode — no-op when WS not connected.
   */
  pushCaption(text: string, ts: number): void {
    if (this.state !== 'running') return;
    this.ws?.sendCaption(text, ts);
  }

  /**
   * Stop mic/tab capture + tick loop while keeping WS + playback alive.
   * Called by the SW when CC subtitle path becomes the active source
   * (proper fix for review finding C3 — backend dedupe is only defense
   * in depth; this stops the duplicate work at the client).
   * Safe to call from any state — idempotent if capture already null.
   */
  async pauseAudioCapture(): Promise<void> {
    if (!this.capture) return; // already paused or never started in audio mode

    this.clearTick();

    await this.capture.stop().catch((e) =>
      chrome.runtime
        .sendMessage({
          type: 'sw.telemetry.error',
          context: 'pauseAudioCapture.stop',
          error: String(e),
        })
        .catch(() => {}),
    );
    this.capture = null;
    this.ringBuffer = null;

    if (this.vad) {
      await this.vad
        .dispose()
        .catch((e) => console.error('[pipeline] vad dispose error during pause:', e));
      this.vad = null;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopping') return;
    this.state = 'stopping';

    this.clearTick();
    await this.cleanup();

    this.state = 'idle';
  }

  /**
   * Handle a video event forwarded from the content script via SW.
   * pause/seeking/ended → flush queue + send WS pause control
   * play/seeked        → resume (WS resume control; capture restarts on next tick)
   * ratechange != 1.0  → warn + pause pipeline
   */
  handleVideoEvent(
    event: 'play' | 'pause' | 'seeked' | 'seeking' | 'ended' | 'ratechange',
    playbackRate?: number,
  ): void {
    switch (event) {
      case 'pause':
      case 'seeking':
      case 'ended':
        this.playbackQueue?.clear();
        this.ws?.sendControl({ type: 'pause' });
        break;

      case 'play':
      case 'seeked':
        this.ws?.sendControl({ type: 'resume' });
        break;

      case 'ratechange':
        if (playbackRate !== undefined && playbackRate !== 1.0) {
          console.warn(
            '[pipeline] playbackRate ≠ 1.0 — pausing pipeline (MVP limitation):',
            playbackRate,
          );
          this.playbackQueue?.clear();
          this.ws?.sendControl({ type: 'pause' });
          // Surface warning to popup via SW
          chrome.runtime
            .sendMessage({
              type: 'pipeline.status',
              status: 'error',
              errorMessage: `Speed ${playbackRate}x not supported in MVP`,
            })
            .catch(() => {});
        } else {
          // Rate restored to 1.0 — resume
          this.ws?.sendControl({ type: 'resume' });
        }
        break;
    }
  }

  get currentState(): PipelineState {
    return this.state;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.state !== 'running') return;

    this.stats.ticks++;
    if (this.stats.ticks % 50 === 0) {
      console.info('[pipeline] stats', {
        ...this.stats,
        wsBuffered: this.ws?.bufferedAmount ?? 0,
        vadFallback: this.vad?.isFallback,
      });
    }

    const chunk = this.ringBuffer?.read(this.CHUNK_SAMPLES);
    if (!chunk) return; // underflow — not enough samples yet
    this.stats.chunksRead++;

    // Backpressure: skip if WS send buffer is too full.
    if ((this.ws?.bufferedAmount ?? 0) > AUDIO_CONFIG.WS_BACKPRESSURE_BYTES) {
      this.stats.backpressure++;
      console.warn('[pipeline] WS backpressure — skipping chunk');
      return;
    }

    if (!this.vad) return; // subtitle mode or pre-init — should not reach here
    const speech = await this.vad.isSpeech(chunk);
    if (speech) {
      this.stats.speech++;
      this.ws?.sendAudio(chunk);
      this.stats.sent++;
    }
    // Silence chunks are silently dropped — no logging to avoid audio content exposure.
  }

  private handleFrame(frame: WsFrame): void {
    // Route inbound frames through WsReceiver only.
    // WsReceiver handles: audio → playback queue, transcript/translation → chrome.runtime.sendMessage
    // pipeline.frame relay removed — each 10-50 KB TTS buffer relayed to SW/content was wasteful
    // and content scripts never consumed it (they only need transcript/translation text).
    this.wsReceiver?.handleFrame(frame);
  }

  private handleFatalError(reason: string): void {
    console.error('[pipeline] fatal WS error:', reason);
    // Surface to popup via SW relay.
    chrome.runtime.sendMessage({ type: 'pipeline.error', reason }).catch(() => {});
    // Stop the pipeline — no point capturing without a working WS connection.
    void this.stop();
  }

  private clearTick(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async cleanup(): Promise<void> {
    this.clearTick();

    this.playbackQueue?.destroy();
    this.playbackQueue = null;
    this.wsReceiver = null;
    this.webSpeech?.destroy();
    this.webSpeech = null;

    if (this.playbackCtx) {
      await this.playbackCtx.close().catch((e) =>
        chrome.runtime
          .sendMessage({
            type: 'sw.telemetry.error',
            context: 'playbackCtx.close',
            error: String(e),
          })
          .catch(() => {}),
      );
      this.playbackCtx = null;
    }

    if (this.capture) {
      await this.capture.stop().catch((e) =>
        chrome.runtime
          .sendMessage({
            type: 'sw.telemetry.error',
            context: 'capture.stop',
            error: String(e),
          })
          .catch(() => {}),
      );
      this.capture = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.vad) {
      await this.vad.dispose().catch((e) => console.error('[pipeline] vad dispose error:', e));
      this.vad = null;
    }

    this.ringBuffer = null;
  }
}
