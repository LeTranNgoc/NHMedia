import type { TTSProvider, TtsVoiceOptions, TtsSynthesisResult } from './tts-provider-interface.js';
import { pickVoice } from './voice-mapping.js';

/** BCP-47 short code → full locale for SSML xml:lang attribute. */
const LANG_TO_LOCALE: Record<string, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  ko: 'ko-KR',
  ja: 'ja-JP',
  fr: 'fr-FR',
  de: 'de-DE',
  hi: 'hi-IN',
  'zh-Hans': 'zh-CN',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface AzureTtsProviderOptions {
  apiKey: string;
  region: string;
}

export class AzureTtsProvider implements TTSProvider {
  private readonly apiKey: string;
  private readonly region: string;

  constructor(opts: AzureTtsProviderOptions) {
    if (!opts.apiKey) throw new Error('AzureTtsProvider: apiKey is required');
    if (!opts.region) throw new Error('AzureTtsProvider: region is required');
    this.apiKey = opts.apiKey;
    this.region = opts.region;
  }

  async synthesize(text: string, voice: TtsVoiceOptions): Promise<TtsSynthesisResult> {
    const voiceName = pickVoice(voice.lang, voice.gender, 'azure');
    if (!voiceName) {
      throw new Error(`unsupported lang: ${voice.lang}`);
    }

    const locale = LANG_TO_LOCALE[voice.lang] ?? voice.lang;
    // +44% rate via SSML prosody — matches Cloud TTS speakingRate=1.44 so user
    // hears consistent pace whichever provider in the chain wins this call.
    const ssml = `<speak version="1.0" xml:lang="${locale}"><voice name="${voiceName}"><prosody rate="+44%">${escapeXml(text)}</prosody></voice></speak>`;

    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!response.ok) {
      throw new Error(
        `Azure TTS HTTP ${response.status}: ${response.statusText || 'auth/unauthorized'}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);
    return { audio, format: 'mp3' };
  }
}
