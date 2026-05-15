/**
 * Service Worker relay for YouTube timedtext fetching.
 *
 * Content scripts cannot fetch timedtext directly (CORS restriction).
 * This handler runs in the SW (extension origin) which has host_permissions
 * for *://*.youtube.com/* — bypassing CORS.
 *
 * Message: { type: 'caption.fetch', baseUrl: string, tlang?: string }
 * Reply:   { ok: true, events: unknown[] } | { ok: false, error: string }
 */

export interface CaptionFetchMsg {
  type: 'caption.fetch';
  baseUrl: string;
  tlang?: string;
}

export interface CaptionFetchReply {
  ok: true;
  events: unknown[];
}

export interface CaptionFetchErrorReply {
  ok: false;
  error: string;
}

/** Allowlisted origin — only fetch from YouTube timedtext endpoints. */
const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*youtube\.com\//;

export function registerCaptionFetcher(): void {
  chrome.runtime.onMessage.addListener(
    (
      msg: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r: CaptionFetchReply | CaptionFetchErrorReply) => void,
    ): boolean | undefined => {
      if (!isCaptionFetchMsg(msg)) return undefined;

      // Security: only allow fetching from youtube.com
      if (!ALLOWED_ORIGIN_RE.test(msg.baseUrl)) {
        sendResponse({ ok: false, error: 'Origin not allowed' });
        return false;
      }

      const url =
        `${msg.baseUrl}&fmt=json3` + (msg.tlang ? `&tlang=${encodeURIComponent(msg.tlang)}` : '');

      fetch(url, { credentials: 'include' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ events?: unknown[] }>;
        })
        .then((data) => {
          sendResponse({ ok: true, events: data.events ?? [] });
        })
        .catch((err: unknown) => {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        });

      return true; // keep message channel open for async sendResponse
    },
  );
}

function isCaptionFetchMsg(msg: unknown): msg is CaptionFetchMsg {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'caption.fetch' &&
    typeof (msg as { baseUrl?: unknown }).baseUrl === 'string'
  );
}
