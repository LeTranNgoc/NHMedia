import { defineContentScript } from 'wxt/utils/define-content-script';
import { VideoController } from '../src/content/youtube/video-controller';
import { DuckingManager } from '../src/content/youtube/ducking-manager';
import { SubtitleOverlay } from '../src/content/youtube/subtitle-overlay';
import { StatusBadge } from '../src/content/youtube/status-badge';
import { loadSettings } from '../src/shared/settings-store';
import type {
  SwSubtitleMsg,
  SwStatusBadgeMsg,
  SwSettingsBroadcastMsg,
} from '../src/shared/messaging-types';
import overlayStyles from '../src/content/youtube/overlay-styles.css?raw';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  cssInjectionMode: 'ui',

  async main() {
    // ── Inject overlay styles ────────────────────────────────────────────────
    const styleEl = document.createElement('style');
    styleEl.textContent = overlayStyles;
    document.head.appendChild(styleEl);

    // ── Legacy stub overlay (Phase 05 compat) ─────────────────────────────
    if (!document.getElementById('tv-status-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'tv-status-overlay';
      overlay.className = 'tv-hidden';
      document.body.appendChild(overlay);
    }

    // ── Instantiate controllers ───────────────────────────────────────────
    const videoCtrl = new VideoController();
    const duckingMgr = new DuckingManager();
    const subtitleOverlay = new SubtitleOverlay();
    const statusBadge = new StatusBadge();

    subtitleOverlay.mount();
    statusBadge.mount();
    videoCtrl.init();

    // Apply initial settings
    try {
      const settings = await loadSettings();
      if (!settings.subtitle) subtitleOverlay.disable();
    } catch {
      // proceed with defaults
    }

    // ── Sync ducking when video element becomes available ─────────────────
    // Poll for video element attachment so ducking-manager stays in sync.
    // VideoController already tracks the element; we just observe it changing.
    const duckingInterval = setInterval(() => {
      const video = videoCtrl.videoElement;
      if (video) duckingMgr.attach(video);
    }, 500);

    // ── Inbound SW messages ───────────────────────────────────────────────
    chrome.runtime.onMessage.addListener(
      (msg: SwSubtitleMsg | SwStatusBadgeMsg | SwSettingsBroadcastMsg) => {
        switch (msg.type) {
          case 'sw.subtitle': {
            subtitleOverlay.show(msg.text);
            break;
          }

          case 'sw.status.badge': {
            statusBadge.update(msg.status, msg.enabled);
            break;
          }

          case 'sw.settings.broadcast': {
            const s = msg.settings;
            // Apply subtitle visibility
            if (s.subtitle) subtitleOverlay.enable();
            else subtitleOverlay.disable();

            // Apply ducking live (no pipeline restart)
            const video = videoCtrl.videoElement;
            if (video) {
              duckingMgr.attach(video);
              if (s.enabled) {
                if (s.audioMode === 'voice-over') {
                  duckingMgr.applyVoiceOver(s.duckingPercent);
                } else {
                  duckingMgr.applyReplacement();
                }
              } else {
                duckingMgr.restore();
              }
            }
            break;
          }
        }
      },
    );

    // ── Cleanup on unload ─────────────────────────────────────────────────
    window.addEventListener('beforeunload', () => {
      clearInterval(duckingInterval);
      duckingMgr.detach();
      videoCtrl.destroy();
      subtitleOverlay.unmount();
      statusBadge.unmount();
    });
  },
});
