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
import type { WebSpeechTtsQueue } from './web-speech-tts-queue';

export class WsReceiver {
  constructor(
    private readonly queue: AudioPlaybackQueue,
    /** Optional client-side TTS. When provided AND vi-VN voice exists, the
     *  translation frame is spoken locally and the server-side audio frame
     *  becomes redundant (set BACKEND_TTS_DISABLED=true on the backend to
     *  stop paying for Cloud TTS). */
    private readonly webSpeech?: WebSpeechTtsQueue,
  ) {}

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
        // If web-speech is actively speaking, skip server audio — the two
        // would overlap. Server audio is the fallback when web-speech
        // unsupported.
        if (this.webSpeech?.isSupported()) return;
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
        const text = typeof frame.text === 'string' ? frame.text : '';
        // Speak locally — zero server-TTS cost, ~50-200ms latency vs the
        // 300-500ms server pipeline + audio download.
        this.webSpeech?.speak(text);
        chrome.runtime
          .sendMessage({
            type: 'pipeline.translation',
            text,
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
