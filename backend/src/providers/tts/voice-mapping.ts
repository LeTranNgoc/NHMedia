import type { SupportedLang } from './tts-provider-interface.js';

type VoiceEntry = { female: string; male: string };

/** Google Cloud Text-to-Speech Neural2 voices per language.
 *  Hindi (hi) is absent — Cloud Neural2 lacks a production-quality Hindi voice;
 *  use Azure as fallback. */
export const CLOUD_TTS_VOICES: Partial<Record<SupportedLang, VoiceEntry>> = {
  vi: { female: 'vi-VN-Neural2-A', male: 'vi-VN-Neural2-D' },
  en: { female: 'en-US-Neural2-F', male: 'en-US-Neural2-J' },
  ko: { female: 'ko-KR-Neural2-A', male: 'ko-KR-Neural2-C' },
  ja: { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' },
  fr: { female: 'fr-FR-Neural2-A', male: 'fr-FR-Neural2-B' },
  de: { female: 'de-DE-Neural2-A', male: 'de-DE-Neural2-B' },
  // hi: intentionally absent — use Azure Neural for Hindi
};

/** Azure Cognitive Services Neural voices per language.
 *  Covers all 7 MVP target languages including Hindi. */
export const AZURE_TTS_VOICES: Record<SupportedLang, VoiceEntry> = {
  vi: { female: 'vi-VN-HoaiMyNeural', male: 'vi-VN-NamMinhNeural' },
  en: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
  ko: { female: 'ko-KR-SunHiNeural', male: 'ko-KR-InJoonNeural' },
  ja: { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
  fr: { female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural' },
  de: { female: 'de-DE-KatjaNeural', male: 'de-DE-ConradNeural' },
  hi: { female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
  'zh-Hans': { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
};

/**
 * Pick a voice name for the given lang, gender, and provider.
 * Returns undefined when the lang is not supported by that provider.
 */
export function pickVoice(
  lang: SupportedLang | string,
  gender: 'female' | 'male',
  provider: 'cloud' | 'azure',
): string | undefined {
  if (provider === 'cloud') {
    const entry = CLOUD_TTS_VOICES[lang as SupportedLang];
    return entry?.[gender];
  }
  const entry = AZURE_TTS_VOICES[lang as SupportedLang];
  return entry?.[gender];
}
