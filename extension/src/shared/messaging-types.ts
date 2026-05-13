// Message types for the popup ↔ SW ↔ offscreen ↔ content script message bus.
// Each direction has its own discriminated union so callers get exhaustive type-checking.

import type { PipelineConfig } from '../offscreen/audio-pipeline-controller';
import type { Settings } from './settings-schema';

// ── Popup → SW ────────────────────────────────────────────────────────────────

export interface PopupGetStatusMsg {
  type: 'popup.getStatus';
}

export interface PopupStartMsg {
  type: 'popup.start';
  tabId: number;
}

export interface PopupStopMsg {
  type: 'popup.stop';
}

export interface PopupSettingsUpdateMsg {
  type: 'popup.settings.update';
  settings: Partial<Settings>;
}

export type PopupToSwMsg =
  | PopupGetStatusMsg
  | PopupStartMsg
  | PopupStopMsg
  | PopupSettingsUpdateMsg;

// ── SW → Offscreen ────────────────────────────────────────────────────────────

export interface SwAudioStartMsg {
  type: 'audio.start';
  streamId: string;
  config: PipelineConfig;
}

export interface SwAudioStopMsg {
  type: 'audio.stop';
}

export interface SwVideoEventMsg {
  type: 'content.video.event';
  event: 'play' | 'pause' | 'seeked' | 'seeking' | 'ended' | 'ratechange';
  currentTime: number;
  playbackRate?: number;
}

export type SwToOffscreenMsg = SwAudioStartMsg | SwAudioStopMsg | SwVideoEventMsg;

// ── Offscreen → SW ────────────────────────────────────────────────────────────

export interface OffscreenPingMsg {
  type: 'offscreen.ping';
}

export interface OffscreenPipelineFrameMsg {
  type: 'pipeline.frame';
  frame: { type: string; [key: string]: unknown };
}

export interface OffscreenPipelineErrorMsg {
  type: 'pipeline.error';
  reason: string;
}

/** Transcript frame from backend. */
export interface PipelineTranscriptMsg {
  type: 'pipeline.transcript';
  text: string;
  lang: string;
}

/** Translation frame from backend. */
export interface PipelineTranslationMsg {
  type: 'pipeline.translation';
  text: string;
}

/** Status update broadcasted to popup/content. */
export interface PipelineStatusMsg {
  type: 'pipeline.status';
  status: 'idle' | 'capturing' | 'translating' | 'playing' | 'error';
  detectedLang?: string;
  errorMessage?: string;
}

/** Telemetry error from offscreen — AudioContext.close and other swallowed errors. */
export interface OffscreenTelemetryErrorMsg {
  type: 'sw.telemetry.error';
  context: string;
  error: string;
}

export type OffscreenToSwMsg =
  | OffscreenPingMsg
  | OffscreenPipelineFrameMsg
  | OffscreenPipelineErrorMsg
  | PipelineTranscriptMsg
  | PipelineTranslationMsg
  | PipelineStatusMsg
  | OffscreenTelemetryErrorMsg;

// ── Content Script → SW ───────────────────────────────────────────────────────

export interface ContentVideoEventMsg {
  type: 'content.video.event';
  event: 'play' | 'pause' | 'seeked' | 'seeking' | 'ended' | 'ratechange';
  currentTime: number;
  playbackRate?: number;
}

/** Sent by content script badge click to ask SW to start capture on this tab. */
export interface ContentStartSessionMsg {
  type: 'content.startSession';
}

export type ContentToSwMsg = ContentVideoEventMsg | ContentStartSessionMsg;

// ── SW → Content Script ───────────────────────────────────────────────────────

export interface SwSubtitleMsg {
  type: 'sw.subtitle';
  text: string;
}

export interface SwStatusBadgeMsg {
  type: 'sw.status.badge';
  status: 'idle' | 'capturing' | 'translating' | 'playing' | 'error';
  enabled: boolean;
}

export interface SwSettingsBroadcastMsg {
  type: 'sw.settings.broadcast';
  settings: Settings;
}

export type SwToContentMsg =
  | SwSubtitleMsg
  | SwStatusBadgeMsg
  | SwSettingsBroadcastMsg;

// ── Status response ───────────────────────────────────────────────────────────

export interface StatusResponse {
  active: boolean;
  tabId?: number;
  status?: 'idle' | 'capturing' | 'translating' | 'playing' | 'error';
  detectedLang?: string;
}

// ── Inbound union (anything the SW can receive) ───────────────────────────────

export type InboundSwMsg = PopupToSwMsg | OffscreenToSwMsg | ContentToSwMsg;
