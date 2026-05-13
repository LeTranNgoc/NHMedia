interface UsageMeterProps {
  secondsCaptured: number;
  /** null = unlimited (pro tier) */
  limitSeconds: number | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Progress bar hiển thị usage hôm nay.
 * Pro tier: hiển thị "Không giới hạn".
 * Free tier: thanh từ 0 đến 15 phút (900s), đổi màu khi > 80%.
 */
export function UsageMeter({ secondsCaptured, limitSeconds }: UsageMeterProps) {
  if (limitSeconds === null) {
    return (
      <div className="flex flex-col gap-1" role="region" aria-label="Usage today">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Usage hôm nay</span>
          <span className="font-medium text-amber-600">Không giới hạn</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={100}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Unlimited usage"
          className="h-2 w-full rounded-full bg-amber-100"
        >
          <div className="h-full w-full rounded-full bg-amber-400" />
        </div>
        <p className="text-xs text-gray-400">{formatTime(secondsCaptured)} đã dùng</p>
      </div>
    );
  }

  const percent = Math.min(100, Math.round((secondsCaptured / limitSeconds) * 100));
  const remaining = Math.max(0, limitSeconds - secondsCaptured);
  const isWarning = percent >= 80;
  const isFull = percent >= 100;

  const barColor = isFull
    ? 'bg-red-500'
    : isWarning
      ? 'bg-orange-400'
      : 'bg-blue-500';

  return (
    <div className="flex flex-col gap-1" role="region" aria-label="Usage today">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Usage hôm nay</span>
        <span className={isFull ? 'font-semibold text-red-600' : 'font-medium'}>
          {formatTime(secondsCaptured)} / {formatTime(limitSeconds)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${percent}% of daily limit used`}
        className="h-2 w-full rounded-full bg-gray-200"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {isFull ? 'Đã hết quota hôm nay' : `Còn ${formatTime(remaining)}`}
      </p>
    </div>
  );
}
