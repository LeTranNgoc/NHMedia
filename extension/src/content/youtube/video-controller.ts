/**
 * VideoController — finds the YouTube <video> element via MutationObserver,
 * re-attaches on SPA navigation, and forwards video events to the SW.
 *
 * Selector fallback chain (YouTube changes class names occasionally):
 *   1. video.html5-main-video
 *   2. video.video-stream
 *   3. #movie_player video
 */

import type { ContentVideoEventMsg } from '../../shared/messaging-types';

const SELECTORS = [
  'video.html5-main-video',
  'video.video-stream',
  '#movie_player video',
] as const;

const WATCHED_EVENTS = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'ended'] as const;
type VideoEvent = (typeof WATCHED_EVENTS)[number];

export class VideoController {
  private observer: MutationObserver | null = null;
  private _video: HTMLVideoElement | null = null;
  private boundHandlers = new Map<VideoEvent, EventListener>();
  private savedVolume = 1.0;
  private savedMuted = false;
  private destroyed = false;

  get videoElement(): HTMLVideoElement | null {
    return this._video;
  }

  /** Start observing document.body for <video> elements. */
  init(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.scanForVideo());
    this.observer.observe(document.body, { childList: true, subtree: true });
    // Attempt immediate detection for already-present video.
    this.scanForVideo();
  }

  setVolume(percent: number): void {
    if (!this._video) return;
    this._video.volume = Math.max(0, Math.min(100, percent)) / 100;
  }

  setMuted(muted: boolean): void {
    if (!this._video) return;
    this._video.muted = muted;
  }

  /** Restore volume and muted state to what they were when video was first attached. */
  restore(): void {
    if (!this._video) return;
    this._video.volume = this.savedVolume;
    this._video.muted = this.savedMuted;
  }

  /** Disconnect observer and remove all event listeners. */
  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    if (this._video) {
      this.detachVideoListeners(this._video);
      this._video = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private scanForVideo(): void {
    const found = this.findVideo();

    if (found === this._video) return; // no change

    // Detach from old video if present
    if (this._video) {
      this.detachVideoListeners(this._video);
      this._video = null;
    }

    if (found) {
      this._video = found;
      this.savedVolume = found.volume;
      this.savedMuted = found.muted;
      this.attachVideoListeners(found);
    }
  }

  private findVideo(): HTMLVideoElement | null {
    for (const selector of SELECTORS) {
      const el = document.querySelector<HTMLVideoElement>(selector);
      if (el) return el;
    }
    return null;
  }

  private attachVideoListeners(video: HTMLVideoElement): void {
    for (const eventName of WATCHED_EVENTS) {
      const handler: EventListener = () => {
        if (this.destroyed) return;
        this.forwardEvent(eventName, video);
      };
      this.boundHandlers.set(eventName, handler);
      video.addEventListener(eventName, handler);
    }
  }

  private detachVideoListeners(video: HTMLVideoElement): void {
    for (const [eventName, handler] of this.boundHandlers) {
      video.removeEventListener(eventName, handler);
    }
    this.boundHandlers.clear();
  }

  private forwardEvent(event: VideoEvent, video: HTMLVideoElement): void {
    const msg: ContentVideoEventMsg = {
      type: 'content.video.event',
      event,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
    };
    chrome.runtime.sendMessage(msg).catch(() => {
      // SW may be briefly unreachable — ignore
    });
  }
}
