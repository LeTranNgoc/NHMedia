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

/**
 * Stop AudioCapture + tick loop while keeping the WS + playback queue alive.
 * Sent by the SW when CC subtitle path goes active — the WS will keep
 * receiving caption.chunk frames and playing back TTS, but the offscreen
 * document stops capturing mic/tab audio (saves bandwidth + CPU, and
 * prevents the dual-source double-billing that the backend 5s dedupe
 * defends against). Resume is not supported in MVP — user must toggle the
 * extension off and back on to re-engage audio capture.
 */
export interface SwAudioPauseCaptureMsg {
  type: 'audio.pause-capture';
}

export interface SwVideoEventMsg {
  type: 'content.video.event';
  event: 'play' | 'pause' | 'seeked' | 'seeking' | 'ended' | 'ratechange';
  currentTime: number;
  playbackRate?: number;
}

/** Caption chunk forwarded from content script → SW → offscreen pipeline. */
export interface SwCaptionChunkMsg {
  type: 'caption.chunk';
  text: string;
  ts: number;
}

export type SwToOffscreenMsg =
  | SwAudioStartMsg
  | SwAudioStopMsg
  | SwAudioPauseCaptureMsg
  | SwVideoEventMsg
  | SwCaptionChunkMsg;

// ── Offscreen → SW ────────────────────────────────────────────────────────────

export interface OffscreenPingMsg {
  type: 'offscreen.ping';
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

/** CC source info included in pipeline.status when subtitle path is active. */
export interface CcSourceInfo {
  lang: string;
  kind: 'asr' | 'standard';
}

/** Status update broadcasted to popup/content. */
export interface PipelineStatusMsg {
  type: 'pipeline.status';
  status: 'idle' | 'capturing' | 'translating' | 'playing' | 'error';
  detectedLang?: string;
  errorMessage?: string;
  /** Present when CC subtitle path is active. */
  ccSource?: CcSourceInfo;
}

/** Telemetry error from offscreen — AudioContext.close and other swallowed errors. */
export interface OffscreenTelemetryErrorMsg {
  type: 'sw.telemetry.error';
  context: string;
  error: string;
}

/** Tab-capture stream died silently (Chrome bug, throttling, or YouTube audio
 *  reset). SW should release the dead streamId and request a fresh one via
 *  chrome.tabCapture.getMediaStreamId — same recovery as SPA navigation. */
export interface OffscreenCaptureDeadMsg {
  type: 'offscreen.capture-dead';
  reason: string;
}

export type OffscreenToSwMsg =
  | OffscreenPingMsg
  | OffscreenPipelineErrorMsg
  | PipelineTranscriptMsg
  | PipelineTranslationMsg
  | PipelineStatusMsg
  | OffscreenTelemetryErrorMsg
  | OffscreenCaptureDeadMsg;

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

/** Caption chunk from content script CC reader → SW → offscreen WS. */
export interface ContentCaptionChunkMsg {
  type: 'caption.chunk';
  text: string;
  ts: number;
}

/**
 * Sent by content script when CC subtitle path is active.
 * SW tracks this state and includes ccSource in next pipeline.status broadcast.
 */
export interface ContentCaptionActiveMsg {
  type: 'caption.active';
  lang: string;
  kind: 'asr' | 'standard';
}

/** YouTube SPA navigation finished — tab MediaStream still alive but audio
 *  routing reset internally, so backend Deepgram socket times out. SW restarts
 *  capture with a fresh streamId to resume the dub on the new video. */
export interface ContentSpaNavigatedMsg {
  type: 'content.spa-navigated';
}

export type ContentToSwMsg =
  | ContentVideoEventMsg
  | ContentStartSessionMsg
  | ContentCaptionChunkMsg
  | ContentCaptionActiveMsg
  | ContentSpaNavigatedMsg;

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

export type SwToContentMsg = SwSubtitleMsg | SwStatusBadgeMsg | SwSettingsBroadcastMsg;

// ── Status response ───────────────────────────────────────────────────────────

export interface StatusResponse {
  active: boolean;
  tabId?: number;
  status?: 'idle' | 'capturing' | 'translating' | 'playing' | 'error';
  detectedLang?: string;
}

// ── Inbound union (anything the SW can receive) ───────────────────────────────

export type InboundSwMsg = PopupToSwMsg | OffscreenToSwMsg | ContentToSwMsg;
