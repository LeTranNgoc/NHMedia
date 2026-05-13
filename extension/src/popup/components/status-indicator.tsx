export type PipelineStatus = 'idle' | 'capturing' | 'translating' | 'playing' | 'error';

interface StatusIndicatorProps {
  status: PipelineStatus;
  detectedLang?: string;
  errorMessage?: string;
}

const STATUS_CONFIG: Record<
  PipelineStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  idle:        { label: 'Idle',        dotClass: 'bg-gray-400',   textClass: 'text-gray-500' },
  capturing:   { label: 'Capturing',   dotClass: 'bg-yellow-400 animate-pulse', textClass: 'text-yellow-600' },
  translating: { label: 'Translating', dotClass: 'bg-blue-400 animate-pulse',   textClass: 'text-blue-600' },
  playing:     { label: 'Playing',     dotClass: 'bg-green-500',  textClass: 'text-green-600' },
  error:       { label: 'Error',       dotClass: 'bg-red-500',    textClass: 'text-red-600' },
};

export function StatusIndicator({ status, detectedLang, errorMessage }: StatusIndicatorProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex flex-col gap-0.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block h-2.5 w-2.5 rounded-full ${cfg.dotClass}`}
        />
        <span className={`text-sm font-medium ${cfg.textClass}`}>{cfg.label}</span>
        {detectedLang && status !== 'idle' && (
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            {detectedLang.toUpperCase()}
          </span>
        )}
      </div>
      {status === 'error' && errorMessage && (
        <p className="text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}
