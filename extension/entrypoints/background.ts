import { defineBackground } from 'wxt/utils/define-background';
import { MessageRouter } from '../src/background/message-router';
import { OffscreenManager } from '../src/background/offscreen-manager';
import type { InboundSwMsg } from '../src/shared/messaging-types';

export default defineBackground(() => {
  const offscreen = new OffscreenManager();
  const router = new MessageRouter(offscreen);

  chrome.runtime.onMessage.addListener(
    (msg: InboundSwMsg, sender, sendResponse) => {
      return router.handle(msg, sender, sendResponse);
    },
  );
});
