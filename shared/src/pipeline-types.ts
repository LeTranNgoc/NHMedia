// ── Pipeline event types shared between backend and (future) FE ───────────────

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  ts: number;
}

export interface TranslationEvent {
  srcText: string;
  translatedText: string;
  srcLang: string;
  ts: number;
}

export interface AudioEvent {
  audio: Buffer;
  format: 'mp3' | 'opus';
  ts: number;
}
