/**
 * WsReceiver — subscribes to incoming WS frames from WsClient and dispatches:
 *   - {type:'audio'}       → AudioPlaybackQueue.enqueue
 *   - {type:'transcript'}  → chrome.runtime.sendMessage (pipeline.transcript)
 *   - {type:'translation'} → chrome.runtime.sendMessage (pipeline.translation)
 *
 * This keeps the inbound frame routing out of AudioPipelineController.
 */

import type { WsFrame } from './ws-client';
import type { AudioPlaybackQueue } from './audio-playback-queue';

export class WsReceiver {
  constructor(private readonly queue: AudioPlaybackQueue) {}

  /**
   * Handle one incoming WS frame.
   * Called from the WsClient.onFrame callback.
   */
  handleFrame(frame: WsFrame): void {
    switch (frame.type) {
      case 'audio': {
        const data = frame.data as string | undefined;
        if (typeof data !== 'string') {
          console.warn('[ws-receiver] audio frame missing data field');
          return;
        }
        void this.queue.enqueue(data);
        break;
      }

      case 'transcript': {
        chrome.runtime
          .sendMessage({
            type: 'pipeline.transcript',
            text: frame.text ?? '',
            lang: frame.lang ?? '',
          })
          .catch(() => {
            // SW briefly unreachable — ignore
          });
        break;
      }

      case 'translation': {
        chrome.runtime
          .sendMessage({
            type: 'pipeline.translation',
            text: frame.text ?? '',
          })
          .catch(() => {});
        break;
      }

      default:
        // Unknown frame types are silently ignored (forward compat).
        break;
    }
  }
}
