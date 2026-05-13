import type { OffscreenManager } from './offscreen-manager';
import type { PipelineConfig } from '../offscreen/audio-pipeline-controller';

/**
 * Service Worker handler for session.start / session.stop.
 *
 * Flow:
 *   1. Verify target tab is on youtube.com
 *   2. Obtain a tab-capture streamId via chrome.tabCapture.getMediaStreamId
 *   3. Ensure the offscreen document exists
 *   4. Send 'audio.start' to the offscreen document with streamId + config
 *
 * chrome.tabCapture.getMediaStreamId requires a user gesture that originated
 * from a popup click — this is guaranteed by the popup "Start" button flow.
 *
 * Note: streamId is tab-bound and can only be consumed by the offscreen
 * document that was created for this extension — it cannot capture other tabs.
 */

const YOUTUBE_HOST_PATTERN = /^https?:\/\/(www\.)?youtube\.com/;

export interface SessionStartOptions {
  tabId: number;
  config: PipelineConfig;
}

export class TabCaptureHandler {
  constructor(private readonly offscreen: OffscreenManager) {}

  /**
   * Start capture for the given tab.
   * Throws on permission errors or non-YouTube tabs.
   */
  async startCapture(opts: SessionStartOptions): Promise<void> {
    const { tabId, config } = opts;

    // Verify the tab is a YouTube tab (security: don't capture arbitrary sites).
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !YOUTUBE_HOST_PATTERN.test(tab.url)) {
      throw new Error(`[tab-capture] tab ${tabId} is not a YouTube tab: ${tab.url}`);
    }

    // Obtain stream ID from the Service Worker context.
    // getMediaStreamId is the MV3-compatible alternative to tabCapture.capture().
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        },
      );
    });

    // Ensure offscreen document is alive before sending the message.
    await this.offscreen.ensureCreated();

    // Forward to offscreen — it will call getUserMedia with the streamId.
    await this.offscreen.sendToOffscreen({
      type: 'audio.start',
      streamId,
      config,
    });
  }

  /** Stop capture — tell offscreen to tear down the audio pipeline. */
  async stopCapture(): Promise<void> {
    await this.offscreen.sendToOffscreen({ type: 'audio.stop' });
  }
}
