import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { TTSProvider, TtsVoiceOptions, TtsSynthesisResult } from './tts-provider-interface.js';
import { pickVoice } from './voice-mapping.js';

/** BCP-47 short code → full locale tag used by Cloud TTS. */
const LANG_TO_LOCALE: Record<string, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  ko: 'ko-KR',
  ja: 'ja-JP',
  fr: 'fr-FR',
  de: 'de-DE',
  'zh-Hans': 'zh-CN',
};

export interface GoogleCloudTtsProviderOptions {
  /** Path to service account JSON key file. If empty, uses ADC. */
  keyFilename?: string;
}

export class GoogleCloudTtsProvider implements TTSProvider {
  private readonly client: TextToSpeechClient;

  constructor(opts: GoogleCloudTtsProviderOptions = {}) {
    this.client = new TextToSpeechClient(
      opts.keyFilename ? { keyFilename: opts.keyFilename } : {},
    );
  }

  async synthesize(text: string, voice: TtsVoiceOptions): Promise<TtsSynthesisResult> {
    const voiceName = pickVoice(voice.lang, voice.gender, 'cloud');
    if (!voiceName) {
      const err = new Error('UNSUPPORTED_LANG') as Error & { code: string };
      err.code = 'UNSUPPORTED_LANG';
      throw err;
    }

    const locale = LANG_TO_LOCALE[voice.lang] ?? voice.lang;

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: locale,
        name: voiceName,
        ssmlGender: voice.gender === 'female' ? 'FEMALE' : 'MALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
      },
    });

    const audioContent = response.audioContent;
    if (!audioContent) {
      throw new Error('tts_empty_response');
    }

    const audio =
      audioContent instanceof Buffer
        ? audioContent
        : Buffer.from(audioContent as Uint8Array);

    return { audio, format: 'mp3' };
  }
}
