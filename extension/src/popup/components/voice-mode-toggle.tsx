import type { Settings } from '../../shared/settings-schema';

interface VoiceModeToggleProps {
  value: Settings['audioMode'];
  onChange: (mode: Settings['audioMode']) => void;
  disabled?: boolean;
}

const MODES: { value: Settings['audioMode']; label: string; description: string }[] = [
  { value: 'voice-over',   label: 'Voice-over',   description: 'Dub over original' },
  { value: 'replacement',  label: 'Replacement',  description: 'Replace original' },
];

export function VoiceModeToggle({ value, onChange, disabled = false }: VoiceModeToggleProps) {
  return (
    <fieldset disabled={disabled} className="space-y-1">
      <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        Audio mode
      </legend>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {MODES.map((mode, i) => {
          const active = value === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={mode.description}
              onClick={() => onChange(mode.value)}
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
              {mode.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
