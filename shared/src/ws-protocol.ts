// ── Client → Server control frames ────────────────────────────────────────────

export interface ConfigFrame {
  type: 'config';
  srcLang: string;
  audioMode: 'voice-over' | 'replacement';
}

export interface PauseFrame {
  type: 'pause';
}

export interface ResumeFrame {
  type: 'resume';
}

export interface FlushFrame {
  type: 'flush';
}

// ── Server → Client frames ─────────────────────────────────────────────────────

export interface TranscriptFrame {
  type: 'transcript';
  text: string;
  isFinal: boolean;
  ts: number;
}

export interface TranslationFrame {
  type: 'translation';
  text: string;
  ts: number;
}

export interface AudioFrame {
  type: 'audio';
  data: string; // base64-encoded audio
  format: 'mp3' | 'opus';
  ts: number;
}

export interface ErrorFrame {
  type: 'error';
  code: string;
  message: string;
}

export interface WarningFrame {
  type: 'warning';
  code: string;
  message?: string;
}

// ── Discriminated union ────────────────────────────────────────────────────────

export type ClientControlFrame = ConfigFrame | PauseFrame | ResumeFrame | FlushFrame;

export type ServerControlFrame =
  | TranscriptFrame
  | TranslationFrame
  | AudioFrame
  | ErrorFrame
  | WarningFrame;

export type ControlFrame = ClientControlFrame | ServerControlFrame;

// ── Close codes ────────────────────────────────────────────────────────────────

export const WS_CLOSE_CODES = {
  IDLE_TIMEOUT: 4000,
  INVALID_JWT: 4001,
  DUPLICATE_CONNECTION: 4002,
  QUOTA_EXCEEDED: 4003,
} as const;

export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

// ── Allowed source languages ───────────────────────────────────────────────────

export const ALLOWED_SRC_LANGS = ['en', 'ja', 'ko', 'fr', 'de'] as const;
export type AllowedSrcLang = (typeof ALLOWED_SRC_LANGS)[number];
