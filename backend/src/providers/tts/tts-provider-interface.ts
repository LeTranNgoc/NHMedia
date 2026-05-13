/**
 * TTSProvider — thin abstraction over TTS backends.
 * GoogleCloudTtsProvider is the sole implementation for MVP.
 * ElevenLabs / FPT.AI can swap in later without touching the pipeline layer.
 */
export interface TtsVoiceOptions {
  lang: 'vi';
  gender: 'male' | 'female';
}

export interface TtsSynthesisResult {
  audio: Buffer;
  format: 'mp3' | 'opus';
}

export interface TTSProvider {
  synthesize(text: string, voice: TtsVoiceOptions): Promise<TtsSynthesisResult>;
}
