import { describe, it, expect, beforeEach } from 'vitest';
import { extractTracksFromPlayerResponse, pickTrack } from '../youtube-cc-reader';
import type { CcTrack } from '../youtube-cc-reader';

const SAMPLE_MANUAL_EN: CcTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&signature=xyz',
  languageCode: 'en',
  kind: 'standard',
  name: 'English',
};

const SAMPLE_AUTO_EN: CcTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&signature=xyz',
  languageCode: 'en',
  kind: 'asr',
  name: 'English (auto-generated)',
};

const SAMPLE_MANUAL_VI: CcTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=vi&signature=xyz',
  languageCode: 'vi',
  kind: 'standard',
  name: 'Tiếng Việt',
};

describe('extractTracksFromPlayerResponse', () => {
  it('parses tracks from valid ytInitialPlayerResponse JSON', () => {
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://yt/timedtext?v=1&lang=en',
              languageCode: 'en',
              kind: 'standard',
              name: { simpleText: 'English' },
            },
          ],
        },
      },
    })};</script>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].languageCode).toBe('en');
    expect(tracks[0].kind).toBe('standard');
    expect(tracks[0].name).toBe('English');
  });

  it('detects auto-generated kind=asr', () => {
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://yt/timedtext?v=1&lang=en&kind=asr',
              languageCode: 'en',
              kind: 'asr',
              name: { simpleText: 'English (auto-generated)' },
            },
          ],
        },
      },
    })};</script>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks[0].kind).toBe('asr');
  });

  it('returns empty array when no captions section in player response', () => {
    const html = `<script>var ytInitialPlayerResponse = {"someOtherField": true};</script>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks).toEqual([]);
  });

  it('returns empty array when ytInitialPlayerResponse missing entirely', () => {
    const html = `<html><body><p>nothing useful</p></body></html>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks).toEqual([]);
  });

  it('returns empty array when JSON parse fails', () => {
    const html = `<script>var ytInitialPlayerResponse = {malformed json};</script>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks).toEqual([]);
  });

  it('parses multiple language tracks', () => {
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'a', languageCode: 'en', kind: 'standard', name: { simpleText: 'English' } },
            { baseUrl: 'b', languageCode: 'vi', kind: 'standard', name: { simpleText: 'Tiếng Việt' } },
            { baseUrl: 'c', languageCode: 'ko', kind: 'asr', name: { simpleText: 'Korean (auto)' } },
          ],
        },
      },
    })};</script>`;

    const tracks = extractTracksFromPlayerResponse(html);

    expect(tracks).toHaveLength(3);
    expect(tracks.map((t) => t.languageCode)).toEqual(['en', 'vi', 'ko']);
  });
});

describe('pickTrack', () => {
  it('prefers manual CC in source lang over auto CC', () => {
    const tracks = [SAMPLE_AUTO_EN, SAMPLE_MANUAL_EN];

    const picked = pickTrack(tracks, { srcLang: 'en', useAutoCC: true });

    expect(picked).toBe(SAMPLE_MANUAL_EN);
  });

  it('returns auto CC when no manual exists and useAutoCC=true', () => {
    const tracks = [SAMPLE_AUTO_EN];

    const picked = pickTrack(tracks, { srcLang: 'en', useAutoCC: true });

    expect(picked).toBe(SAMPLE_AUTO_EN);
  });

  it('returns null when only auto CC exists and useAutoCC=false', () => {
    const tracks = [SAMPLE_AUTO_EN];

    const picked = pickTrack(tracks, { srcLang: 'en', useAutoCC: false });

    expect(picked).toBeNull();
  });

  it('returns null when no tracks at all', () => {
    const picked = pickTrack([], { srcLang: 'en', useAutoCC: true });

    expect(picked).toBeNull();
  });

  it('returns null when no manual matches srcLang and useAutoCC=false', () => {
    const tracks = [SAMPLE_MANUAL_VI];

    const picked = pickTrack(tracks, { srcLang: 'en', useAutoCC: false });

    expect(picked).toBeNull();
  });

  it('falls back to any manual track when srcLang manual not available (lets YouTube tlang= auto-translate)', () => {
    const tracks = [SAMPLE_MANUAL_VI]; // user wants en source

    const picked = pickTrack(tracks, { srcLang: 'en', useAutoCC: true });

    expect(picked).toBe(SAMPLE_MANUAL_VI);
  });

  it('srcLang=auto picks first manual track', () => {
    const tracks = [SAMPLE_MANUAL_VI, SAMPLE_MANUAL_EN];

    const picked = pickTrack(tracks, { srcLang: 'auto', useAutoCC: true });

    expect(picked?.kind).toBe('standard');
  });
});
