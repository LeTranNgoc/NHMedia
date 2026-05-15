/**
 * TTSProvider — thin abstraction over TTS backends.
 * GoogleCloudTtsProvider is the sole implementation for MVP.
 * ElevenLabs / FPT.AI can swap in later without touching the pipeline layer.
 */
export type SupportedLang = 'vi' | 'en' | 'ko' | 'ja' | 'fr' | 'de' | 'hi' | 'zh-Hans';

export interface TtsVoiceOptions {
  lang: SupportedLang;
  gender: 'male' | 'female';
}

export interface TtsSynthesisResult {
  audio: Buffer;
  format: 'mp3' | 'opus';
}

export interface TTSProvider {
  synthesize(text: string, voice: TtsVoiceOptions): Promise<TtsSynthesisResult>;
}
