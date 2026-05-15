/**
 * YouTube Closed Caption reader.
 * Extracts track metadata from ytInitialPlayerResponse and provides
 * a track picker + native cuechange listener.
 *
 * CORS constraint: content script cannot fetch timedtext directly.
 * Use caption-fetcher.ts (SW relay) to fetch the events[] array.
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

  const tracks: unknown[] | undefined =
    (data as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } })
      ?.captions
      ?.playerCaptionsTracklistRenderer
      ?.captionTracks;

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
  targetLang: string;
  onChunk: (text: string, startTimeMs: number) => void;
}

/**
 * Start a native cuechange listener on the page's video element.
 * Polls for textTracks to populate (up to 5s / 10 tries × 500ms).
 * Returns a cleanup function to remove the listener.
 */
export function startCueListener(
  video: HTMLVideoElement,
  opts: CueListenerOpts,
): () => void {
  let track: TextTrack | null = null;
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

    const found =
      Array.from(video.textTracks).find((t) => t.language === opts.targetLang) ??
      (video.textTracks.length > 0 ? video.textTracks[0] : null);

    if (found) {
      track = found;
      track.mode = 'hidden';
      track.addEventListener('cuechange', handler);
      return;
    }

    attempts++;
    if (attempts < MAX_ATTEMPTS) {
      timer = setTimeout(tryAttach, 500);
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
      track = null;
    }
  };
}
