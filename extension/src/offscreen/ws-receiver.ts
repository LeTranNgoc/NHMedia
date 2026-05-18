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
  /** Latched the first time backend emits an audio frame. From that moment on
   *  this session prefers server audio over browser speechSynthesis — they
   *  serve the same role and concurrent speech overlaps. Latched per-session;
   *  cleared on WsClient teardown. */
  private serverAudioActive = false;

  /** Deferred web-speech calls awaiting the "is server audio coming?" decision.
   *  Translation arrives 300-600ms BEFORE the audio frame (translate runs faster
   *  than TTS). Speaking the translation immediately and then cancelling on
   *  audio arrival = user hears partial web-speech then full server audio
   *  ("lặp từ + bỏ từ"). Defer instead — if audio arrives within the window,
   *  drop the deferred speak silently. */
  private readonly DEFER_WINDOW_MS = 500;
  private deferredSpeakTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly queue: AudioPlaybackQueue,
    /** Optional client-side TTS. When provided AND vi-VN voice exists AND
     *  backend has NOT started sending audio frames, the translation frame
     *  is spoken locally. If backend audio frames arrive (BACKEND_TTS_DISABLED=false),
     *  this is silenced — server audio wins for the rest of the session. */
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
        if (!this.serverAudioActive) {
          this.serverAudioActive = true;
          console.info(
            '[ws-receiver] server audio active — silencing browser TTS for this session',
          );
          // Drop any deferred web-speak calls — server audio is the authoritative source.
          for (const t of this.deferredSpeakTimers) clearTimeout(t);
          this.deferredSpeakTimers.clear();
          this.webSpeech?.cancel();
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
        const text = typeof frame.text === 'string' ? frame.text : '';
        // Defer the web-speak by DEFER_WINDOW_MS. If a matching audio frame
        // arrives in the window → drop the deferred call (server audio wins,
        // no overlap). Otherwise → speak via web-speech. This fixes the
        // "lặp từ + bỏ từ" race where translation arrives ~500ms before its
        // corresponding audio frame.
        if (!this.serverAudioActive && text && this.webSpeech) {
          const speakAfterDeferral = (): void => {
            this.deferredSpeakTimers.delete(timer);
            if (!this.serverAudioActive) {
              this.webSpeech!.speak(text);
            }
          };
          const timer = setTimeout(speakAfterDeferral, this.DEFER_WINDOW_MS);
          this.deferredSpeakTimers.add(timer);
        }
        chrome.runtime
          .sendMessage({
            type: 'pipeline.translation',
            text,
          })
          .catch(() => {});
        break;
      }

      case 'error': {
        // Backend signals 'asr_dead' when Deepgram exhausts reconnects with no
        // audio for ~7s. The tab MediaStream is silently dead (Chrome doesn't
        // fire track.onended/onmute on offscreen tab-capture deaths). Recover
        // by asking SW to release the dead streamId and request a fresh one —
        // same recovery as offscreen.capture-dead.
        const code = frame.code as string | undefined;
        if (code === 'asr_dead') {
          console.warn('[ws-receiver] backend reports asr_dead — signalling capture restart');
          chrome.runtime
            .sendMessage({ type: 'offscreen.capture-dead', reason: 'backend-asr-dead' })
            .catch(() => {});
        }
        break;
      }

      default:
        // Unknown frame types are silently ignored (forward compat).
        break;
    }
  }
}
