import { describe, it, expect } from 'vitest';
import { pickVoice, CLOUD_TTS_VOICES, AZURE_TTS_VOICES } from '../voice-mapping.js';

const REQUIRED_LANGS = ['vi', 'en', 'ko', 'ja', 'fr', 'de', 'hi'] as const;
const GENDERS = ['female', 'male'] as const;

describe('voice-mapping', () => {
  describe('CLOUD_TTS_VOICES table', () => {
    it('vi maps to Google Cloud Neural2 female voice', () => {
      expect(pickVoice('vi', 'female', 'cloud')).toBe('vi-VN-Neural2-A');
    });

    it('en female maps to a Google Cloud Neural2 voice', () => {
      const voice = pickVoice('en', 'female', 'cloud');
      expect(voice).toMatch(/^en-US-Neural2-/);
    });

    it('ko female maps to Korean Neural2 voice', () => {
      const voice = pickVoice('ko', 'female', 'cloud');
      expect(voice).toMatch(/^ko-KR-Neural2-/);
    });

    it('ja female maps to Japanese Neural2 voice', () => {
      const voice = pickVoice('ja', 'female', 'cloud');
      expect(voice).toMatch(/^ja-JP-Neural2-/);
    });

    it('fr female maps to French Neural2 voice', () => {
      const voice = pickVoice('fr', 'female', 'cloud');
      expect(voice).toMatch(/^fr-FR-Neural2-/);
    });

    it('de female maps to German Neural2 voice', () => {
      const voice = pickVoice('de', 'female', 'cloud');
      expect(voice).toMatch(/^de-DE-Neural2-/);
    });

    it('returns undefined for hi on cloud (Cloud Neural2 lacks Hindi)', () => {
      expect(pickVoice('hi', 'female', 'cloud')).toBeUndefined();
    });

    it('every supported lang has both female AND male voices', () => {
      for (const lang of REQUIRED_LANGS) {
        if (lang === 'hi') continue; // hi not in cloud
        for (const gender of GENDERS) {
          const voice = pickVoice(lang, gender, 'cloud');
          expect(voice, `cloud:${lang}:${gender} should be defined`).toBeDefined();
        }
      }
    });
  });

  describe('AZURE_TTS_VOICES table', () => {
    it('hi female maps to Azure Indian Neural voice', () => {
      const voice = pickVoice('hi', 'female', 'azure');
      expect(voice).toMatch(/^hi-IN-/);
    });

    it('vi female maps to Azure Vietnamese Neural voice', () => {
      const voice = pickVoice('vi', 'female', 'azure');
      expect(voice).toMatch(/^vi-VN-/);
    });

    it('every required lang has azure fallback voice (both genders)', () => {
      for (const lang of REQUIRED_LANGS) {
        for (const gender of GENDERS) {
          const voice = pickVoice(lang, gender, 'azure');
          expect(voice, `azure:${lang}:${gender} should be defined`).toBeDefined();
        }
      }
    });
  });

  describe('pickVoice edge cases', () => {
    it('unknown lang on cloud → undefined', () => {
      expect(pickVoice('xx' as never, 'female', 'cloud')).toBeUndefined();
    });

    it('unknown lang on azure → undefined', () => {
      expect(pickVoice('xx' as never, 'female', 'azure')).toBeUndefined();
    });

    it('tables export with frozen structure (read-only)', () => {
      expect(CLOUD_TTS_VOICES).toBeDefined();
      expect(AZURE_TTS_VOICES).toBeDefined();
      expect(Object.keys(CLOUD_TTS_VOICES).length).toBeGreaterThanOrEqual(6);
      expect(Object.keys(AZURE_TTS_VOICES).length).toBeGreaterThanOrEqual(7);
    });
  });
});
