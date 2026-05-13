import type { Settings } from '../../shared/settings-schema';

interface VoiceGenderToggleProps {
  value: Settings['voiceGender'];
  onChange: (gender: Settings['voiceGender']) => void;
  disabled?: boolean;
}

const GENDERS: { value: Settings['voiceGender']; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male',   label: 'Male' },
];

export function VoiceGenderToggle({ value, onChange, disabled = false }: VoiceGenderToggleProps) {
  return (
    <fieldset disabled={disabled} className="space-y-1">
      <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        Voice gender
      </legend>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {GENDERS.map((g, i) => {
          const active = value === g.value;
          return (
            <button
              key={g.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${g.label} voice`}
              onClick={() => onChange(g.value)}
              className={[
                'flex-1 py-2 px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                i > 0 ? 'border-l border-gray-200' : '',
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {g.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
