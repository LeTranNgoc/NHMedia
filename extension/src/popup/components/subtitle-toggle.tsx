import { OnOffSwitch } from './on-off-switch';

interface SubtitleToggleProps {
  checked: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export function SubtitleToggle({ checked, onChange, disabled = false }: SubtitleToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700">Subtitles</p>
        <p className="text-xs text-gray-500">Show translated text on video</p>
      </div>
      <OnOffSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label="Toggle subtitle overlay"
      />
    </div>
  );
}
