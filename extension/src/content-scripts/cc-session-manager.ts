/**
 * CC session manager for the YouTube content script.
 *
 * Encapsulates the lifecycle of a single subtitle-path session:
 *   1. Extract CC tracks from page HTML
 *   2. Pick best track per user settings
 *   3. Fetch events via SW relay (caption.fetch)
 *   4. Start native cue listener on the video element
 *   5. Forward each cue as caption.chunk to SW
 *   6. Notify SW via caption.active so pipeline.status includes ccSource
 *
 * Returns true if a CC track was found and the session started.
 * Returns false to signal the caller to fall back to ASR.
 *
 * Constraints:
 *   - Only one session at a time (module-level singleton).
 *   - Does NOT modify cc-reader or caption-fetcher modules.
 */

import {
  extractTracksFromPlayerResponse,
  pickTrack,
  startCueListener,
} from './youtube-cc-reader';
import type { CaptionFetchMsg, CaptionFetchReply, CaptionFetchErrorReply } from '../background/caption-fetcher';
import type { ContentCaptionChunkMsg, ContentCaptionActiveMsg } from '../shared/messaging-types';

export interface CcSessionOpts {
  /** Full page HTML used to extract ytInitialPlayerResponse. */
  html: string;
  /** The page's <video> element, if already located. May be undefined if not yet in DOM. */
  video?: HTMLVideoElement;
  /** User's selected source language code, e.g. 'en', 'auto'. */
  srcLang: string;
  /** User's selected target language code, e.g. 'vi'. */
  targetLang: string;
  /** Whether to accept auto-generated CC tracks. */
  useAutoCC: boolean;
}

// Module-level singleton cleanup reference.
let _cleanupCueListen: (() => void) | null = null;

/**
 * Start a CC subtitle session.
 * Returns true if CC path is active, false if ASR fallback should run.
 */
export async function startCcSession(opts: CcSessionOpts): Promise<boolean> {
  // Ensure any prior session is torn down.
  stopCcSession();

  const { html, video, srcLang, targetLang, useAutoCC } = opts;

  const tracks = extractTracksFromPlayerResponse(html);
  const track = pickTrack(tracks, { srcLang, useAutoCC });

  if (!track) {
    // No suitable CC track → caller falls back to ASR.
    return false;
  }

  // Determine whether YouTube should auto-translate (tlang param).
  // Only pass tlang when target differs from the track's actual language.
  const tlang = targetLang !== track.languageCode ? targetLang : undefined;

  // Fetch caption events via SW relay (CORS bypass).
  const fetchMsg: CaptionFetchMsg = {
    type: 'caption.fetch',
    baseUrl: track.baseUrl,
    tlang,
  };

  let reply: CaptionFetchReply | CaptionFetchErrorReply;
  try {
    reply = await chrome.runtime.sendMessage(fetchMsg) as CaptionFetchReply | CaptionFetchErrorReply;
  } catch (err) {
    console.warn('[cc-session-manager] caption.fetch failed:', err);
    return false;
  }

  if (!reply.ok) {
    console.warn('[cc-session-manager] caption.fetch error:', reply.error);
    return false;
  }

  // Locate the video element — may not be available yet, startCueListener handles polling.
  const videoEl = video ?? (document.querySelector<HTMLVideoElement>('video') ?? undefined);
  if (!videoEl) {
    // No video element; CC path not viable.
    return false;
  }

  // Start cue listener — fires onChunk for each active cue.
  _cleanupCueListen = startCueListener(videoEl, {
    targetLang,
    onChunk: (text, ts) => {
      const chunkMsg: ContentCaptionChunkMsg = {
        type: 'caption.chunk',
        text,
        ts,
      };
      chrome.runtime.sendMessage(chunkMsg).catch(() => {});
    },
  });

  // Notify SW that CC path is active — it will broadcast ccSource in pipeline.status.
  const activeMsg: ContentCaptionActiveMsg = {
    type: 'caption.active',
    lang: track.languageCode,
    kind: track.kind,
  };
  chrome.runtime.sendMessage(activeMsg).catch(() => {});

  return true;
}

/** Tear down the active CC session. Safe to call when no session is running. */
export function stopCcSession(): void {
  if (_cleanupCueListen) {
    _cleanupCueListen();
    _cleanupCueListen = null;
  }
}
