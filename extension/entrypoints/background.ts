import { defineBackground } from 'wxt/utils/define-background';
import { MessageRouter } from '../src/background/message-router';
import { OffscreenManager } from '../src/background/offscreen-manager';
import { initSentry } from '../src/shared/observability';
import type { InboundSwMsg } from '../src/shared/messaging-types';

export default defineBackground(() => {
  initSentry('sw');

  const offscreen = new OffscreenManager();
  const router = new MessageRouter(offscreen);

  chrome.runtime.onMessage.addListener((msg: InboundSwMsg, sender, sendResponse) => {
    return router.handle(msg, sender, sendResponse);
  });
});
