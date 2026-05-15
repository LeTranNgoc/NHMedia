import { useState } from 'react';
import { openCheckoutUrl } from '../../shared/billing-api-client';

/**
 * UpgradeButton — "Upgrade to Pro $5/mo" button.
 * Calls GET /billing/checkout-url (server builds URL from JWT), then opens tab.
 * Server derives userId+email from JWT, so the button needs no props.
 */
export function UpgradeButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      await openCheckoutUrl();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể mở trang thanh toán.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        aria-busy={loading}
        aria-label="Nâng cấp lên Pro $5/tháng"
        className={[
          'flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md px-4 py-2',
          'text-sm font-semibold text-white transition-colors duration-150',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
          loading
            ? 'cursor-not-allowed bg-blue-300 opacity-70'
            : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
        ].join(' ')}
      >
        {loading ? (
          <>
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
          </>
        ) : (
          'Nâng cấp Pro — $5/tháng →'
        )}
      </button>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
