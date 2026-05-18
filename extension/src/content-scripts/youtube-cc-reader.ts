/**
 * YouTube Closed Caption reader.
 * Extracts track metadata from ytInitialPlayerResponse and provides
 * a track picker + native cuechange listener.
 *
 * Subtitle source is video.textTracks (the browser's own decoded cues).
 * No direct timedtext fetch — keeps the content script CORS-free and
 * avoids needing credentialed network access for captions.
 */

export interface CcTrack {
  baseUrl: string;
  languageCode: string;
  kind: 'asr' | 'standard';
  name: string;
}

export interface PickTrackOpts {
  srcLang: string;
  useAutoCC: boolean;
}

/**
 * Parse ytInitialPlayerResponse from page HTML and extract caption tracks.
 * Returns [] on any parse error or missing captions section.
 */
export function extractTracksFromPlayerResponse(html: string): CcTrack[] {
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match) return [];

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const tracks: unknown[] | undefined = (
    data as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks)) return [];

  return tracks.map((t) => {
    const track = t as {
      baseUrl?: string;
      languageCode?: string;
      kind?: string;
      name?: { simpleText?: string };
    };
    return {
      baseUrl: track.baseUrl ?? '',
      languageCode: track.languageCode ?? '',
      kind: track.kind === 'asr' ? 'asr' : 'standard',
      name: track.name?.simpleText ?? '',
    } satisfies CcTrack;
  });
}

/**
 * Pick the best caption track given user preferences.
 *
 * Priority:
 *   1. Manual (standard) track matching srcLang
 *   2. Any manual track (YouTube tlang= param will auto-translate)
 *   3. Auto-gen (asr) matching srcLang — only if useAutoCC=true
 *   4. Any auto-gen — only if useAutoCC=true
 *
 * srcLang='auto' → first manual track (any lang), or first asr if useAutoCC=true
 */
export function pickTrack(tracks: CcTrack[], opts: PickTrackOpts): CcTrack | null {
  const { srcLang, useAutoCC } = opts;
  const isAuto = srcLang === 'auto';

  // Priority 1: manual track in srcLang (or first manual for srcLang=auto)
  const manualInLang = isAuto
    ? tracks.find((t) => t.kind === 'standard')
    : tracks.find((t) => t.kind === 'standard' && t.languageCode === srcLang);
  if (manualInLang) return manualInLang;

  if (!useAutoCC) return null;

  // Priority 2: any manual track (YouTube auto-translates via tlang=)
  // Only when useAutoCC=true — user accepts fallback-quality behavior.
  if (!isAuto) {
    const anyManual = tracks.find((t) => t.kind === 'standard');
    if (anyManual) return anyManual;
  }

  // Priority 3: auto-gen in srcLang (or first auto for srcLang=auto)
  const asrInLang = isAuto
    ? tracks.find((t) => t.kind === 'asr')
    : tracks.find((t) => t.kind === 'asr' && t.languageCode === srcLang);
  if (asrInLang) return asrInLang;

  // Priority 4: any auto-gen
  const anyAsr = tracks.find((t) => t.kind === 'asr');
  return anyAsr ?? null;
}

export interface CueListenerOpts {
  /** Source-side language code of the caption track to listen on (e.g. 'en'). */
  srcLang: string;
  onChunk: (text: string, startTimeMs: number) => void;
}

/**
 * Start a native cuechange listener on the page's video element.
 * Polls for textTracks to populate (up to 5s / 10 tries × 500ms).
 *
 * Track-pick priority:
 *   1. Track with `language === srcLang` (e.g. 'en' captions for an English video)
 *   2. The track YouTube is currently displaying (mode === 'showing')
 *   3. First textTrack in the list (last-resort fallback)
 *
 * Auto-enables cue events: if the picked track is in 'disabled' mode (user
 * hasn't clicked YT's CC button), flip it to 'hidden' so the cuechange events
 * fire without YT rendering its own subtitle overlay (we use our own). The
 * original mode is restored on cleanup so YT's button state stays consistent
 * after the extension stops.
 *
 * Returns a cleanup function to remove the listener.
 */
export function startCueListener(video: HTMLVideoElement, opts: CueListenerOpts): () => void {
  let track: TextTrack | null = null;
  let originalMode: TextTrackMode | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removed = false;

  const handler = (): void => {
    if (!track) return;
    const cues = track.activeCues;
    if (!cues) return;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i] as VTTCue;
      opts.onChunk(cue.text, cue.startTime * 1000);
    }
  };

  let attempts = 0;
  const MAX_ATTEMPTS = 10;

  const tryAttach = (): void => {
    if (removed) return;

    const tracks = Array.from(video.textTracks);
    const found =
      tracks.find((t) => t.language === opts.srcLang) ??
      tracks.find((t) => t.mode === 'showing') ??
      tracks[0] ??
      null;

    if (found) {
      track = found;
      originalMode = found.mode;
      // Auto-activate cuechange events. 'hidden' fires cues without rendering
      // YT's own subtitles — perfect for our overlay. Skip when already
      // 'showing' (user manually enabled CC) to avoid overriding their choice.
      if (found.mode === 'disabled') {
        found.mode = 'hidden';
        console.info(`[cc-reader] auto-enabled hidden mode for cuechange (was disabled)`);
      }
      track.addEventListener('cuechange', handler);
      console.info(
        `[cc-reader] attached cuechange — lang=${found.language || '(unknown)'} mode=${found.mode}`,
      );
      return;
    }

    attempts++;
    if (attempts < MAX_ATTEMPTS) {
      timer = setTimeout(tryAttach, 500);
    } else {
      console.warn(
        '[cc-reader] no textTracks found after 5s — CC path inactive, falling back to ASR',
      );
    }
  };

  tryAttach();

  return () => {
    removed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (track) {
      track.removeEventListener('cuechange', handler);
      // Restore YT's original mode so its CC button state stays consistent
      // for the next session / when extension toggles off.
      if (originalMode !== null && track.mode !== originalMode) {
        track.mode = originalMode;
      }
      track = null;
      originalMode = null;
    }
  };
}
