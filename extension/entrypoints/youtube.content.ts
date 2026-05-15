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
import { startCcSession, stopCcSession } from '../src/content-scripts/cc-session-manager';

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
    const duckingInterval = setInterval(() => {
      const video = videoCtrl.videoElement;
      if (video) duckingMgr.attach(video);
    }, 500);

    // ── CC session state ─────────────────────────────────────────────────
    let ccActive = false;

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

            if (msg.enabled && !ccActive) {
              // Pipeline just started — attempt CC subtitle path.
              ccActive = true;
              const video = videoCtrl.videoElement;
              void (async () => {
                try {
                  const settings = await loadSettings();
                  const started = await startCcSession({
                    html: document.documentElement.outerHTML,
                    video: video ?? undefined,
                    srcLang: settings.srcLanguage,
                    targetLang: settings.targetLanguage,
                    useAutoCC: settings.useAutoCC,
                  });
                  if (!started) {
                    // No suitable CC track — ASR pipeline handles it; nothing to do.
                    ccActive = false;
                  }
                } catch (err) {
                  console.warn('[youtube.content] CC session start failed, falling back to ASR:', err);
                  ccActive = false;
                }
              })();
            } else if (!msg.enabled && ccActive) {
              // Pipeline stopped.
              ccActive = false;
              stopCcSession();
            }
            break;
          }

          case 'sw.settings.broadcast': {
            const s = msg.settings;
            if (s.subtitle) subtitleOverlay.enable();
            else subtitleOverlay.disable();

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
      stopCcSession();
      duckingMgr.detach();
      videoCtrl.destroy();
      subtitleOverlay.unmount();
      statusBadge.unmount();
    });
  },
});
