/**
 * AudioPlaybackQueue — decode MP3 base64 frames and schedule playback in order.
 *
 * Each enqueued frame is:
 *   1. Base64-decoded → ArrayBuffer
 *   2. Decoded via AudioContext.decodeAudioData → AudioBuffer
 *   3. Scheduled via AudioBufferSourceNode.start(nextScheduledTime)
 *
 * Scheduling strategy:
 *   - nextScheduledTime advances by buffer.duration after each frame
 *   - If nextScheduledTime falls behind currentTime (stall, first frame, cleared),
 *     it is reset to currentTime to avoid scheduling into the past
 */

export class AudioPlaybackQueue {
  private nextScheduledTime = 0;
  private lastEnqueueTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor(private readonly ctx: AudioContext) {}

  /**
   * Enqueue a base64-encoded MP3 frame for playback.
   * Decode errors are logged and skipped — playback continues with subsequent frames.
   */
  async enqueue(base64: string): Promise<void> {
    // Chrome can silently suspend an AudioContext in offscreen documents after
    // idle periods or under autoplay policy. Reasserting resume() before each
    // enqueue is cheap (no-op when already running) and prevents intermittent
    // silence — symptom: audio frames decoded successfully but user hears
    // nothing because the destination is suspended.
    if (this.ctx.state === 'suspended') {
      console.warn('[audio-playback-queue] ctx suspended — resuming');
      this.ctx.resume().catch((e) => {
        console.warn('[audio-playback-queue] resume failed:', e);
      });
    }

    let buffer: AudioBuffer;
    try {
      const arrayBuffer = this.base64ToArrayBuffer(base64);
      buffer = await this.ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn('[audio-playback-queue] decodeAudioData failed — skipping frame:', err);
      return;
    }

    const now = this.ctx.currentTime;

    // Reset if behind currentTime (stall, first frame, or cleared queue).
    if (this.nextScheduledTime < now) {
      this.nextScheduledTime = now;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(this.nextScheduledTime);

    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) this.activeSources.splice(idx, 1);
    };

    this.nextScheduledTime += buffer.duration;
    this.lastEnqueueTime = now;
  }

  /**
   * Stop all active sources immediately and reset the schedule.
   * Used when the user pauses/seeks the video.
   */
  clear(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources = [];
    this.nextScheduledTime = 0;
  }

  /** Tear down — call when the offscreen document is closed. */
  destroy(): void {
    this.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
