import type { SwToOffscreenMsg } from '../shared/messaging-types';

const OFFSCREEN_URL = 'offscreen/index.html' as const;
// USER_MEDIA reason has no 30-second timeout (unlike AUDIO_PLAYBACK) — researcher-01 finding.
const OFFSCREEN_REASON = chrome.offscreen.Reason.USER_MEDIA;
const OFFSCREEN_JUSTIFICATION = 'Audio capture from YouTube for translation';

export class OffscreenManager {
  private creating: Promise<void> | null = null;

  /** Idempotent — safe to call multiple times; creates document only once. */
  async ensureCreated(): Promise<void> {
    if (await this.exists()) return;

    // Guard against concurrent calls racing to create the document.
    if (this.creating) {
      await this.creating;
      return;
    }

    this.creating = chrome.offscreen
      .createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_URL),
        reasons: [OFFSCREEN_REASON],
        justification: OFFSCREEN_JUSTIFICATION,
      })
      .finally(() => {
        this.creating = null;
      });

    await this.creating;
  }

  async closeOffscreen(): Promise<void> {
    if (await this.exists()) {
      await chrome.offscreen.closeDocument();
    }
  }

  /**
   * Send a typed message to the offscreen document.
   * Ensures the document exists first.
   */
  async sendToOffscreen(msg: SwToOffscreenMsg): Promise<void> {
    await this.ensureCreated();
    await chrome.runtime.sendMessage(msg);
  }

  private async exists(): Promise<boolean> {
    // Chrome 116+ exposes hasDocument(); fall back to false on older builds.
    if (typeof chrome.offscreen.hasDocument === 'function') {
      return chrome.offscreen.hasDocument();
    }
    return false;
  }
}
