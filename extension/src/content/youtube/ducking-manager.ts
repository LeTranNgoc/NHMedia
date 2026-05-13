/**
 * DuckingManager — controls video element volume/mute for translation audio modes.
 *
 * Modes:
 *   voice-over   → duck original audio to duckingPercent% of original
 *   replacement  → mute original audio entirely
 *
 * Restores original volume/muted state on disable or detach.
 * Settings changes apply live without requiring a full pipeline restart.
 */

export class DuckingManager {
  private video: HTMLVideoElement | null = null;
  private originalVolume = 1.0;
  private originalMuted = false;
  private applied = false;

  /** Attach a new video element. Restores any prior video first. */
  attach(video: HTMLVideoElement): void {
    if (this.video && this.applied) {
      this.restore();
    }
    this.video = video;
    this.originalVolume = video.volume;
    this.originalMuted = video.muted;
    this.applied = false;
  }

  /** Apply voice-over ducking: set volume to duckingPercent / 100. */
  applyVoiceOver(duckingPercent: number): void {
    if (!this.video) return;
    // Save original state on first apply (before modification)
    if (!this.applied) {
      this.originalVolume = this.video.volume;
      this.originalMuted = this.video.muted;
      this.applied = true;
    }
    const clamped = Math.max(0, Math.min(100, duckingPercent));
    this.video.volume = clamped / 100;
    this.video.muted = false;
  }

  /** Apply replacement mode: mute original audio. */
  applyReplacement(): void {
    if (!this.video) return;
    if (!this.applied) {
      this.originalVolume = this.video.volume;
      this.originalMuted = this.video.muted;
      this.applied = true;
    }
    this.video.muted = true;
  }

  /** Restore original volume and muted state. */
  restore(): void {
    if (!this.video || !this.applied) return;
    this.video.volume = this.originalVolume;
    this.video.muted = this.originalMuted;
    this.applied = false;
  }

  /** Detach from current video element, restoring its state. */
  detach(): void {
    if (this.video) {
      this.restore();
      this.video = null;
    }
  }
}
