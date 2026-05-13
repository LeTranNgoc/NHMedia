interface UpgradeCtaProps {
  onUpgrade: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * Nút "Nâng cấp Pro" — chỉ hiển thị cho free users.
 * Gọi onUpgrade() → tạo Polar checkout session → mở tab mới.
 */
export function UpgradeCta({ onUpgrade, loading = false, disabled = false }: UpgradeCtaProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">Nâng cấp lên Pro</p>
        <p className="mt-0.5 text-xs text-blue-700">
          Dùng không giới hạn mỗi ngày — không bị ngắt giữa chừng.
        </p>
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        disabled={disabled || loading}
        aria-disabled={disabled || loading}
        className={[
          'flex min-h-[44px] w-full items-center justify-center rounded-md px-4 py-2',
          'text-sm font-semibold text-white transition-colors duration-150',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
          disabled || loading
            ? 'cursor-not-allowed bg-blue-300 opacity-70'
            : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
        ].join(' ')}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              className="h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            Đang mở trang thanh toán…
          </span>
        ) : (
          'Nâng cấp Pro →'
        )}
      </button>
    </div>
  );
}
