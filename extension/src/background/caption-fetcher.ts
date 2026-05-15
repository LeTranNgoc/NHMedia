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

/** Allowlisted endpoint — only the YouTube timedtext API.
 *  Tighter than a subdomain match: prevents the SW from being coerced into
 *  fetching arbitrary YouTube URLs with credentials (cookie exfil risk). */
const ALLOWED_URL_RE = /^https:\/\/(www\.)?youtube\.com\/api\/timedtext\?/;

export function registerCaptionFetcher(): void {
  chrome.runtime.onMessage.addListener(
    (
      msg: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r: CaptionFetchReply | CaptionFetchErrorReply) => void,
    ): boolean | undefined => {
      if (!isCaptionFetchMsg(msg)) return undefined;

      // Security: only allow the YouTube timedtext endpoint.
      if (!ALLOWED_URL_RE.test(msg.baseUrl)) {
        sendResponse({ ok: false, error: 'Endpoint not allowed' });
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
