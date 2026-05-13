import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoController } from './video-controller';

// ── chrome.runtime stub ───────────────────────────────────────────────────────

const mockSendMessage = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
  },
});

// ── MutationObserver mock ─────────────────────────────────────────────────────
// happy-dom provides MutationObserver, but we need control over when it fires.

type ObserverCallback = (mutations: MutationRecord[]) => void;
let observerCallback: ObserverCallback | null = null;
let observerTarget: Node | null = null;

class MockMutationObserver {
  constructor(cb: ObserverCallback) {
    observerCallback = cb;
  }
  observe(target: Node) {
    observerTarget = target;
  }
  disconnect() {
    observerCallback = null;
    observerTarget = null;
  }
}

vi.stubGlobal('MutationObserver', MockMutationObserver);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVideo(): HTMLVideoElement {
  const el = document.createElement('video');
  // Assign the class expected by the primary selector
  el.className = 'html5-main-video';
  return el;
}

/** Simulate MutationObserver firing (as if DOM nodes were added). */
function triggerObserver() {
  if (observerCallback) {
    observerCallback([] as unknown as MutationRecord[]);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VideoController', () => {
  let ctrl: VideoController;

  beforeEach(() => {
    mockSendMessage.mockClear();
    // Clean up body
    document.body.innerHTML = '';
    observerCallback = null;
    observerTarget = null;
    ctrl = new VideoController();
  });

  afterEach(() => {
    ctrl.destroy();
  });

  describe('MutationObserver detection', () => {
    it('observes document.body on init', () => {
      ctrl.init();
      expect(observerTarget).toBe(document.body);
    });

    it('detects <video> element when it appears in DOM', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();
      expect(ctrl.videoElement).toBe(video);
    });

    it('also finds video via fallback selector video.video-stream', () => {
      ctrl.init();
      const video = document.createElement('video');
      video.className = 'video-stream';
      document.body.appendChild(video);
      triggerObserver();
      expect(ctrl.videoElement).toBe(video);
    });

    it('re-attaches when video element disappears and reappears (SPA nav)', () => {
      ctrl.init();
      const video1 = makeVideo();
      document.body.appendChild(video1);
      triggerObserver();
      expect(ctrl.videoElement).toBe(video1);

      // Simulate SPA nav — old video removed, new one appears
      document.body.removeChild(video1);
      const video2 = makeVideo();
      document.body.appendChild(video2);
      triggerObserver();
      expect(ctrl.videoElement).toBe(video2);
    });

    it('handles case where video disappears without replacement', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();
      expect(ctrl.videoElement).toBe(video);

      document.body.removeChild(video);
      triggerObserver(); // no new video in DOM
      expect(ctrl.videoElement).toBeNull();
    });
  });

  describe('event forwarding', () => {
    it('sends content.video.event on pause', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      video.dispatchEvent(new Event('pause'));

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.video.event',
          event: 'pause',
        }),
      );
    });

    it('sends content.video.event on play', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      video.dispatchEvent(new Event('play'));

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'content.video.event', event: 'play' }),
      );
    });

    it('includes currentTime and playbackRate in payload', () => {
      ctrl.init();
      const video = makeVideo();
      Object.defineProperty(video, 'currentTime', { value: 42.5, writable: true });
      Object.defineProperty(video, 'playbackRate', { value: 1.5, writable: true });
      document.body.appendChild(video);
      triggerObserver();

      video.dispatchEvent(new Event('ratechange'));

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'content.video.event',
          event: 'ratechange',
          currentTime: 42.5,
          playbackRate: 1.5,
        }),
      );
    });
  });

  describe('setVolume / setMuted / restore', () => {
    it('setVolume(percent) sets video.volume', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      ctrl.setVolume(50);
      expect(video.volume).toBeCloseTo(0.5);
    });

    it('setMuted(true) mutes the video', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      ctrl.setMuted(true);
      expect(video.muted).toBe(true);
    });

    it('restore() resets volume and muted to original values', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      ctrl.setVolume(20);
      ctrl.setMuted(true);
      ctrl.restore();

      expect(video.volume).toBeCloseTo(1.0);
      expect(video.muted).toBe(false);
    });
  });

  describe('destroy', () => {
    it('disconnects observer and stops sending events', () => {
      ctrl.init();
      const video = makeVideo();
      document.body.appendChild(video);
      triggerObserver();

      ctrl.destroy();

      // After destroy, events should not be forwarded
      video.dispatchEvent(new Event('pause'));
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
