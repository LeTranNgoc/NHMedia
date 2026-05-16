import type { SwToOffscreenMsg, OffscreenToSwMsg } from '../../src/shared/messaging-types';
import { AudioPipelineController } from '../../src/offscreen/audio-pipeline-controller';
import { initSentry } from '../../src/shared/observability';

initSentry('offscreen');

// ── Keepalive ─────────────────────────────────────────────────────────────────
// Send a ping to SW every 5 s to reset its inactivity timer.
// Without this the SW terminates after ~30 s idle (Chrome MV3 behaviour).
setInterval(() => {
  const ping: OffscreenToSwMsg = { type: 'offscreen.ping' };
  chrome.runtime.sendMessage(ping).catch(() => {
    // SW may be briefly unresponsive during startup — ignore, retry next tick.
  });
}, 5_000);

// ── Audio pipeline ────────────────────────────────────────────────────────────
const controller = new AudioPipelineController();

chrome.runtime.onMessage.addListener((msg: SwToOffscreenMsg, _sender, sendResponse) => {
  if (msg.type === 'audio.start') {
    controller
      .start({ streamId: msg.streamId, config: msg.config })
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        console.error('[offscreen] audio.start failed:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async response
  }

  if (msg.type === 'audio.stop') {
    controller
      .stop()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        console.error('[offscreen] audio.stop failed:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async response
  }

  if (msg.type === 'audio.pause-capture') {
    controller
      .pauseAudioCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        console.error('[offscreen] audio.pause-capture failed:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async response
  }

  // Video events forwarded from SW → offscreen for pipeline timeline control
  if (msg.type === 'content.video.event') {
    controller.handleVideoEvent(msg.event, msg.playbackRate);
    sendResponse({ ok: true });
    return false;
  }

  // Caption chunks from content script CC reader → forward to WS
  if (msg.type === 'caption.chunk') {
    controller.pushCaption(msg.text, msg.ts);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
