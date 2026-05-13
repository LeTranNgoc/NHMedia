import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuckingManager } from './ducking-manager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVideo(volume = 1.0, muted = false): HTMLVideoElement {
  return {
    volume,
    muted,
  } as unknown as HTMLVideoElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DuckingManager', () => {
  let mgr: DuckingManager;

  beforeEach(() => {
    mgr = new DuckingManager();
  });

  describe('applyVoiceOver', () => {
    it('sets video.volume to duckingPercent / 100', () => {
      const video = makeVideo(1.0);
      mgr.attach(video);
      mgr.applyVoiceOver(30);
      expect(video.volume).toBeCloseTo(0.3);
    });

    it('saves original volume before modifying', () => {
      const video = makeVideo(0.8);
      mgr.attach(video);
      mgr.applyVoiceOver(30);
      mgr.restore();
      expect(video.volume).toBeCloseTo(0.8);
    });

    it('clamps duckingPercent 0 → volume = 0', () => {
      const video = makeVideo(1.0);
      mgr.attach(video);
      mgr.applyVoiceOver(0);
      expect(video.volume).toBe(0);
    });

    it('clamps duckingPercent 100 → volume = 1', () => {
      const video = makeVideo(0.5);
      mgr.attach(video);
      mgr.applyVoiceOver(100);
      expect(video.volume).toBe(1);
    });
  });

  describe('applyReplacement', () => {
    it('sets video.muted = true', () => {
      const video = makeVideo(1.0, false);
      mgr.attach(video);
      mgr.applyReplacement();
      expect(video.muted).toBe(true);
    });

    it('saves original muted state before modifying', () => {
      const video = makeVideo(1.0, false);
      mgr.attach(video);
      mgr.applyReplacement();
      mgr.restore();
      expect(video.muted).toBe(false);
    });

    it('preserves volume after replacement restore', () => {
      const video = makeVideo(0.7, false);
      mgr.attach(video);
      mgr.applyReplacement();
      mgr.restore();
      expect(video.volume).toBeCloseTo(0.7);
    });
  });

  describe('restore', () => {
    it('restores original volume and muted state', () => {
      const video = makeVideo(0.6, false);
      mgr.attach(video);
      mgr.applyVoiceOver(20);
      expect(video.volume).toBeCloseTo(0.2);
      mgr.restore();
      expect(video.volume).toBeCloseTo(0.6);
      expect(video.muted).toBe(false);
    });

    it('is a no-op when no video attached', () => {
      expect(() => mgr.restore()).not.toThrow();
    });

    it('is a no-op when called before any apply', () => {
      const video = makeVideo(0.9);
      mgr.attach(video);
      mgr.restore(); // no prior apply — should not crash
      expect(video.volume).toBeCloseTo(0.9);
    });
  });

  describe('live settings change', () => {
    it('switching voice-over → replacement applies mute without restart', () => {
      const video = makeVideo(1.0, false);
      mgr.attach(video);
      mgr.applyVoiceOver(30);
      expect(video.volume).toBeCloseTo(0.3);

      // Switch mode live
      mgr.applyReplacement();
      expect(video.muted).toBe(true);
    });

    it('switching replacement → voice-over restores volume and applies ducking', () => {
      const video = makeVideo(1.0, false);
      mgr.attach(video);
      mgr.applyReplacement();
      expect(video.muted).toBe(true);

      // Switch mode live — should un-mute and duck
      mgr.applyVoiceOver(50);
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.5);
    });

    it('update duckingPercent live without restart', () => {
      const video = makeVideo(1.0, false);
      mgr.attach(video);
      mgr.applyVoiceOver(30);
      expect(video.volume).toBeCloseTo(0.3);

      mgr.applyVoiceOver(60); // live update — no restore needed
      expect(video.volume).toBeCloseTo(0.6);
    });
  });

  describe('detach', () => {
    it('restores original state and clears video ref', () => {
      const video = makeVideo(0.5, false);
      mgr.attach(video);
      mgr.applyVoiceOver(10);
      mgr.detach();
      expect(video.volume).toBeCloseTo(0.5);
    });

    it('is safe to call without prior attach', () => {
      expect(() => mgr.detach()).not.toThrow();
    });
  });
});
