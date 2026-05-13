interface DuckingSliderProps {
  value: number; // 0–100
  onChange: (percent: number) => void;
  disabled?: boolean;
}

export function DuckingSlider({ value, onChange, disabled = false }: DuckingSliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label
          htmlFor="tv-ducking-slider"
          className="text-xs font-medium text-gray-500 uppercase tracking-wide"
        >
          Original volume
        </label>
        <span className="text-xs font-semibold tabular-nums text-gray-700">
          {value}%
        </span>
      </div>
      <input
        id="tv-ducking-slider"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={`Original audio volume: ${value}%`}
        className={[
          'h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200',
          'accent-blue-600',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        ].join(' ')}
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>Mute</span>
        <span>Full</span>
      </div>
    </div>
  );
}
