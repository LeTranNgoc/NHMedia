import { useSettings } from '../../shared/settings-store';
import { VoiceModeToggle } from '../components/voice-mode-toggle';
import { DuckingSlider } from '../components/ducking-slider';
import { VoiceGenderToggle } from '../components/voice-gender-toggle';
import { LanguagePicker } from '../components/language-picker';
import { SubtitleToggle } from '../components/subtitle-toggle';

export function SettingsView() {
  const { settings, updateSettings } = useSettings();

  const isVoiceOver = settings.audioMode === 'voice-over';

  return (
    <div className="flex flex-col gap-5 p-4">
      <VoiceModeToggle
        value={settings.audioMode}
        onChange={(mode) => void updateSettings({ audioMode: mode })}
      />

      <DuckingSlider
        value={settings.duckingPercent}
        onChange={(pct) => void updateSettings({ duckingPercent: pct })}
        disabled={!isVoiceOver}
      />

      <div className="border-t border-gray-100" />

      <VoiceGenderToggle
        value={settings.voiceGender}
        onChange={(gender) => void updateSettings({ voiceGender: gender })}
      />

      <LanguagePicker
        value={settings.srcLanguage}
        onChange={(lang) => void updateSettings({ srcLanguage: lang })}
      />

      <div className="border-t border-gray-100" />

      <SubtitleToggle
        checked={settings.subtitle}
        onChange={(on) => void updateSettings({ subtitle: on })}
      />
    </div>
  );
}
