import { AUDIO_CONFIG } from '../shared/audio-config';
import type { RingBuffer } from './ring-buffer';

/**
 * Acquires a tab MediaStream via a Chrome-specific streamId and wires it
 * through an AudioContext + AudioWorkletNode (downsample-processor) that
 * writes 16 kHz Int16 PCM into the provided RingBuffer.
 *
 * Chrome-specific getUserMedia constraints:
 *   { audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } }
 *
 * The worklet module is loaded from the extension's public directory at
 * 'worklet/downsample-processor.js' (resolved relative to the offscreen page).
 *
 * SharedArrayBuffer usage: extension offscreen documents run in a context
 * with COOP/COEP headers set by Chrome MV3 — SAB is always available.
 */
export class AudioCapture {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  /**
   * Gain node between captured source and destination. Tab-audio capture in
   * Chrome diverts the tab output into the stream, silencing the user's
   * speakers — we have to route it back through this gain to keep audible.
   * DuckingManager can adjust this gain (0..1) for voice-over / replacement.
   */
  private playbackGain: GainNode | null = null;

  constructor(private readonly ringBuffer: RingBuffer) {}

  /** Set captured-audio gain (0 = mute, 1 = full). DuckingManager hook. */
  setPlaybackGain(value: number): void {
    if (this.playbackGain) {
      this.playbackGain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  /**
   * Acquire the tab audio stream and start piping samples into the ring buffer.
   *
   * @param streamId — value from chrome.tabCapture.getMediaStreamId()
   * @throws if getUserMedia fails (tab closed, permission denied, etc.)
   */
  async start(streamId: string): Promise<void> {
    if (this.ctx) {
      console.warn('[audio-capture] already running — call stop() first');
      return;
    }

    // Load the worklet FIRST — if it fails, we haven't acquired the stream yet
    // and the tab-capture indicator won't show unnecessarily.
    this.ctx = new AudioContext({ sampleRate: AUDIO_CONFIG.INPUT_SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule('worklet/downsample-processor.js');

    // Chrome-specific constraint for tab audio capture.
    const constraints: MediaStreamConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, // Chrome-specific 'mandatory' key not in standard TS types
      video: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.workletNode = new AudioWorkletNode(this.ctx, 'downsample-processor', {
      processorOptions: {
        // Pass the SAB to the worklet so it can write directly.
        // SAB is transferable via postMessage in the AudioWorkletNode constructor.
        sharedArrayBuffer: this.ringBuffer.sab,
        capacity: this.ringBuffer.capacity,
      },
    });

    // Connect graph:
    //   source ┬→ workletNode  (PCM tap for VAD + WS streaming)
    //          └→ playbackGain → destination  (user hears original audio)
    // The destination branch is REQUIRED — chromeMediaSource:'tab' diverts the
    // tab output into the stream, so without this route the user hears silence.
    this.source.connect(this.workletNode);
    this.playbackGain = this.ctx.createGain();
    this.playbackGain.gain.value = 1; // full volume by default
    this.source.connect(this.playbackGain);
    this.playbackGain.connect(this.ctx.destination);

    // Chrome offscreen contexts can start in 'suspended' state without a direct
    // user gesture — explicit resume() is required to unmute playback.
    console.info('[audio-capture] ctx state before resume:', this.ctx.state);
    try {
      await this.ctx.resume();
    } catch (e) {
      console.error('[audio-capture] resume() failed:', e);
    }
    console.info('[audio-capture] ctx state after resume:', this.ctx.state);
  }

  /** Disconnect audio graph, stop media tracks, close AudioContext. */
  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.playbackGain) {
      this.playbackGain.disconnect();
      this.playbackGain = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }

  /** Whether the capture pipeline is currently running. */
  get isRunning(): boolean {
    return this.ctx !== null;
  }
}
