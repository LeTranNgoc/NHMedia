import type {
  InboundSwMsg,
  StatusResponse,
  SwVideoEventMsg,
  PipelineStatusMsg,
  CcSourceInfo,
} from '../shared/messaging-types';
import type { OffscreenManager } from './offscreen-manager';
import { TabCaptureHandler } from './tab-capture-handler';
import { loadSettings, updateSettings } from '../shared/settings-store';

// Env vars injected at build time by WXT. Defaults keep local dev working —
// matches backend .env.example PORT=3000.
const WS_URL: string =
  (typeof import.meta.env !== 'undefined' && (import.meta.env['WXT_WS_URL'] as string | undefined)) ||
  'ws://localhost:3000/ws/translate';

/**
 * Routes all inbound runtime messages in the Service Worker.
 *
 * Message flow:
 *   popup.start            → TabCaptureHandler.startCapture → audio.start → offscreen
 *   popup.stop             → TabCaptureHandler.stopCapture  → audio.stop  → offscreen
 *   popup.settings.update  → updateSettings → broadcast sw.settings.broadcast to content
 *   content.video.event    → forward to offscreen for timeline control
 *   pipeline.transcript    → relay to active YouTube content script
 *   pipeline.translation   → relay to active YouTube content script (subtitle)
 *   pipeline.status        → relay to popup
 *   pipeline.frame         → relay to active YouTube tab
 *   offscreen.ping         → resets SW inactivity timer
 */
export class MessageRouter {
  private readonly tabCapture: TabCaptureHandler;
  private activeTabId: number | null = null;
  private currentStatus: PipelineStatusMsg['status'] = 'idle';
  private detectedLang: string | undefined;
  private ccSource: CcSourceInfo | undefined;

  constructor(private readonly offscreen: OffscreenManager) {
    this.tabCapture = new TabCaptureHandler(offscreen);
  }

  handle(
    msg: InboundSwMsg,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined {
    switch (msg.type) {
      case 'popup.getStatus': {
        const status: StatusResponse = {
          active: this.activeTabId !== null,
          tabId: this.activeTabId ?? undefined,
          status: this.currentStatus,
          detectedLang: this.detectedLang,
        };
        sendResponse(status);
        return false;
      }

      case 'popup.start': {
        const tabId = msg.tabId;
        this.activeTabId = tabId;

        void (async () => {
          try {
            // Read auth token first — pipeline cannot authenticate without it.
            const stored = await chrome.storage.local.get('authToken');
            const jwt = (stored['authToken'] as string | undefined) ?? '';
            if (!jwt) {
              this.activeTabId = null;
              sendResponse({ ok: false, code: 'auth_required' });
              return;
            }

            const settings = await loadSettings();
            await this.tabCapture.startCapture({
              tabId,
              config: {
                srcLang: settings.srcLanguage === 'auto' ? 'en' : settings.srcLanguage,
                targetLang: settings.targetLanguage,
                wsUrl: WS_URL,
                jwt,
                audioMode: settings.audioMode,
              },
            });
            this.currentStatus = 'capturing';
            this.broadcastStatus();
            sendResponse({ ok: true });
          } catch (err) {
            this.activeTabId = null;
            this.currentStatus = 'idle';
            console.error('[message-router] startCapture failed:', err);
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true; // async sendResponse
      }

      case 'popup.stop': {
        this.activeTabId = null;
        this.currentStatus = 'idle';
        this.detectedLang = undefined;
        this.ccSource = undefined;
        void this.tabCapture.stopCapture().catch((e) =>
          console.error('[message-router] stopCapture failed:', e),
        );
        this.broadcastStatus();
        this.broadcastStatusBadge(false);
        sendResponse({ ok: true });
        return false;
      }

      case 'popup.settings.update': {
        void (async () => {
          try {
            await updateSettings(msg.settings);
            // Broadcast updated settings to content script
            const full = await loadSettings();
            if (this.activeTabId !== null) {
              void chrome.tabs
                .sendMessage(this.activeTabId, {
                  type: 'sw.settings.broadcast',
                  settings: full,
                })
                .catch(() => {});
            }
            sendResponse({ ok: true });
          } catch (err) {
            console.error('[message-router] settings.update failed:', err);
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;
      }

      case 'offscreen.ping': {
        sendResponse({ ack: true });
        return false;
      }

      case 'pipeline.frame': {
        // Relay raw frames to the active YouTube tab (legacy path).
        if (this.activeTabId !== null) {
          void chrome.tabs
            .sendMessage(this.activeTabId, msg)
            .catch(() => {});
        }
        return false;
      }

      case 'pipeline.transcript': {
        // Forward detected language to status; relay text to content script.
        if (msg.lang) {
          this.detectedLang = msg.lang;
          this.currentStatus = 'translating';
          this.broadcastStatus();
        }
        return false;
      }

      case 'pipeline.translation': {
        // Forward translation text as subtitle to content script.
        this.currentStatus = 'playing';
        this.broadcastStatus();
        if (this.activeTabId !== null) {
          void chrome.tabs
            .sendMessage(this.activeTabId, { type: 'sw.subtitle', text: msg.text })
            .catch(() => {});
        }
        return false;
      }

      case 'pipeline.status': {
        this.currentStatus = msg.status;
        if (msg.detectedLang) this.detectedLang = msg.detectedLang;
        this.broadcastStatus();
        return false;
      }

      case 'pipeline.error': {
        console.error('[message-router] pipeline error:', msg.reason);
        // Capture tabId before nulling so broadcastStatusBadge can reach the tab.
        const errorTabId = this.activeTabId;
        this.activeTabId = null;
        this.currentStatus = 'error';
        // Include the reason in the status message so popup can show a cause.
        const errorStatusMsg: PipelineStatusMsg = {
          type: 'pipeline.status',
          status: 'error',
          errorMessage: msg.reason,
        };
        chrome.runtime.sendMessage(errorStatusMsg).catch(() => {});
        // If quota was exhausted, notify the AccountView listener directly.
        if (msg.reason === 'quota_exceeded') {
          chrome.runtime.sendMessage({ type: 'quota_exceeded' }).catch(() => {});
        }
        // Broadcast badge OFF to the tab before activeTabId was cleared.
        if (errorTabId !== null) {
          void chrome.tabs
            .sendMessage(errorTabId, {
              type: 'sw.status.badge',
              status: 'error',
              enabled: false,
            })
            .catch(() => {});
        }
        return false;
      }

      case 'sw.telemetry.error': {
        // Structured error relay from offscreen (e.g. AudioContext.close failures).
        // Future: wire to a telemetry endpoint. For now, log with context.
        console.warn('[sw.telemetry]', msg.context, msg.error);
        return false;
      }

      case 'content.video.event': {
        // Forward video events to offscreen for timeline/pipeline control.
        const videoMsg: SwVideoEventMsg = {
          type: 'content.video.event',
          event: msg.event,
          currentTime: msg.currentTime,
          playbackRate: msg.playbackRate,
        };
        void this.offscreen.sendToOffscreen(videoMsg).catch(() => {});
        return false;
      }

      case 'caption.chunk': {
        // Forward caption chunk from content script to offscreen pipeline.
        void this.offscreen.sendToOffscreen({
          type: 'caption.chunk',
          text: msg.text,
          ts: msg.ts,
        }).catch(() => {});
        return false;
      }

      case 'caption.active': {
        // Content script confirmed CC subtitle path is active.
        this.ccSource = { lang: msg.lang, kind: msg.kind };
        this.broadcastStatus();
        // C3 client-side fix: stop AudioCapture so we don't pay for mic/tab
        // capture + ASR translation in parallel with the CC path. The backend
        // 5s dedupe stays as defense in depth.
        void this.offscreen
          .sendToOffscreen({ type: 'audio.pause-capture' })
          .catch((e) =>
            console.warn('[message-router] audio.pause-capture failed:', e),
          );
        return false;
      }

      case 'content.startSession': {
        // Badge clicked start — SW resolves tab from sender (no `tabs` permission needed).
        const tabId = sender.tab?.id;
        if (tabId == null) {
          sendResponse({ ok: false, error: 'no_tab' });
          return false;
        }
        // Re-use the popup.start path by synthesising the message.
        return this.handle({ type: 'popup.start', tabId }, sender, sendResponse);
      }

      default: {
        const _exhaustive: never = msg;
        console.warn('[message-router] unhandled message type:', (_exhaustive as InboundSwMsg).type);
        return false;
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private broadcastStatus(): void {
    const statusMsg: PipelineStatusMsg = {
      type: 'pipeline.status',
      status: this.currentStatus,
      detectedLang: this.detectedLang,
      ccSource: this.ccSource,
    };
    // Send to popup (all extension pages receive runtime messages).
    chrome.runtime.sendMessage(statusMsg).catch(() => {});
    // Also update status badge on content script.
    this.broadcastStatusBadge(
      this.activeTabId !== null && this.currentStatus !== 'idle',
    );
  }

  private broadcastStatusBadge(enabled: boolean): void {
    if (this.activeTabId === null) return;
    void chrome.tabs
      .sendMessage(this.activeTabId, {
        type: 'sw.status.badge',
        status: this.currentStatus,
        enabled,
      })
      .catch(() => {});
  }
}
