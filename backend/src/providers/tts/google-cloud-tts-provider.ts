import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { TTSProvider, TtsVoiceOptions, TtsSynthesisResult } from './tts-provider-interface.js';
import { pickVoice } from './voice-mapping.js';

// Derive the SDK's ClientOptions type without taking a direct dep on google-gax
// — the TextToSpeechClient constructor's first arg is exactly that type.
type ClientOptions = NonNullable<ConstructorParameters<typeof TextToSpeechClient>[0]>;

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
  /** Path to service account JSON key file. If empty, falls back to credentialsJson then ADC. */
  keyFilename?: string;
  /** Service-account JSON content (stringified). Used when running on Fly /
   *  serverless where mounting a key file is awkward. Wins over keyFilename
   *  when both are provided. */
  credentialsJson?: string;
}

export class GoogleCloudTtsProvider implements TTSProvider {
  private readonly client: TextToSpeechClient;

  constructor(opts: GoogleCloudTtsProviderOptions = {}) {
    this.client = new TextToSpeechClient(this.buildClientConfig(opts));
  }

  private buildClientConfig(opts: GoogleCloudTtsProviderOptions): ClientOptions {
    if (opts.credentialsJson) {
      try {
        const credentials = JSON.parse(opts.credentialsJson) as {
          client_email?: string;
          private_key?: string;
          project_id?: string;
        };
        // google-auth-library accepts `credentials` (parsed) over `keyFilename`.
        const cfg: ClientOptions = {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        };
        if (credentials.project_id) cfg.projectId = credentials.project_id;
        return cfg;
      } catch {
        // Fall through to keyFilename / ADC if JSON is malformed — better to
        // let the SDK emit its native auth error than crash on boot.
      }
    }
    if (opts.keyFilename) return { keyFilename: opts.keyFilename };
    return {};
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
        // 1.44 = +20% on top of the prior +20% bump — user reports dub still
        // trails fast-talking sources. Vietnamese cadence holds up to ~1.5;
        // beyond that quality degrades. Configurable per-call later if needed.
        speakingRate: 1.44,
      },
    });

    const audioContent = response.audioContent;
    if (!audioContent) {
      throw new Error('tts_empty_response');
    }

    const audio =
      audioContent instanceof Buffer ? audioContent : Buffer.from(audioContent as Uint8Array);

    return { audio, format: 'mp3' };
  }
}
