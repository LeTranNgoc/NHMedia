import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCloudTtsProvider } from '../google-cloud-tts-provider.js';

// ── Mock @google-cloud/text-to-speech ─────────────────────────────────────────
const mockSynthesizeSpeech = vi.fn();

vi.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: vi.fn().mockImplementation(() => ({
    synthesizeSpeech: mockSynthesizeSpeech,
  })),
}));

describe('GoogleCloudTtsProvider', () => {
  let provider: GoogleCloudTtsProvider;

  beforeEach(() => {
    provider = new GoogleCloudTtsProvider({});
    vi.clearAllMocks();
  });

  it('synthesize("Xin chào", female) → non-empty Buffer, format="mp3"', async () => {
    const fakeAudio = Buffer.from('fake-mp3-data');
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: fakeAudio }]);

    const result = await provider.synthesize('Xin chào', { lang: 'vi', gender: 'female' });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(result.format).toBe('mp3');
  });

  it('uses vi-VN-Neural2-A for female voice', async () => {
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from('data') }]);

    await provider.synthesize('test', { lang: 'vi', gender: 'female' });

    const callArg = mockSynthesizeSpeech.mock.calls[0][0] as {
      voice: { name: string; ssmlGender: string };
    };
    expect(callArg.voice.name).toBe('vi-VN-Neural2-A');
    expect(callArg.voice.ssmlGender).toBe('FEMALE');
  });

  it('uses vi-VN-Neural2-D for male voice', async () => {
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from('data') }]);

    await provider.synthesize('test', { lang: 'vi', gender: 'male' });

    const callArg = mockSynthesizeSpeech.mock.calls[0][0] as {
      voice: { name: string; ssmlGender: string };
    };
    expect(callArg.voice.name).toBe('vi-VN-Neural2-D');
    expect(callArg.voice.ssmlGender).toBe('MALE');
  });

  it('requests MP3 audio encoding', async () => {
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from('data') }]);

    await provider.synthesize('test', { lang: 'vi', gender: 'female' });

    const callArg = mockSynthesizeSpeech.mock.calls[0][0] as {
      audioConfig: { audioEncoding: string };
    };
    expect(callArg.audioConfig.audioEncoding).toBe('MP3');
  });

  it('handles Uint8Array audioContent (converts to Buffer)', async () => {
    const uint8 = new Uint8Array([1, 2, 3, 4]);
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: uint8 }]);

    const result = await provider.synthesize('test', { lang: 'vi', gender: 'female' });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBe(4);
  });

  it('throws tts_empty_response when audioContent is null', async () => {
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: null }]);

    await expect(
      provider.synthesize('test', { lang: 'vi', gender: 'female' }),
    ).rejects.toThrow('tts_empty_response');
  });

  it('API error → rejects with original error', async () => {
    mockSynthesizeSpeech.mockRejectedValue(new Error('quota exceeded'));

    await expect(
      provider.synthesize('test', { lang: 'vi', gender: 'female' }),
    ).rejects.toThrow('quota exceeded');
  });
});
