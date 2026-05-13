import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { TTSProvider, TtsVoiceOptions, TtsSynthesisResult } from './tts-provider-interface.js';

// Voice name mapping: Neural2 vi-VN voices
const VOICE_MAP: Record<'male' | 'female', string> = {
  female: 'vi-VN-Neural2-A',
  male: 'vi-VN-Neural2-D',
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
    const voiceName = VOICE_MAP[voice.gender];

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: 'vi-VN',
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
