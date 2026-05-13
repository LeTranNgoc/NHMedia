import { useState, useEffect, useCallback } from 'react';
import type { BillingMeResponse, UsageSummary } from '@translate-voice/shared';
import { getBillingMe, startCheckout, getUsageHistory } from '../../shared/billing-api-client';
import { PlanBadge } from '../components/plan-badge';
import { UsageMeter } from '../components/usage-meter';
import { UpgradeCta } from '../components/upgrade-cta';

type LoadState = 'loading' | 'loaded' | 'error' | 'unauthenticated';

const POLAR_CUSTOMER_PORTAL_URL = 'https://polar.sh/settings';

/**
 * AccountView — replaces Phase 07 stub.
 * Shows live plan + usage from /billing/me, upgrade CTA for free users,
 * manage subscription link for pro users, and 7-day usage history.
 *
 * Also surfaces quota_exceeded banner when WS connection was closed 4003.
 */
export function AccountView() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [billing, setBilling] = useState<BillingMeResponse | null>(null);
  const [history, setHistory] = useState<UsageSummary[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadState('loading');
      const [me, hist] = await Promise.all([getBillingMe(), getUsageHistory(7)]);
      setBilling(me);
      setHistory(hist);
      setLoadState('loaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.includes('403')) {
        setLoadState('unauthenticated');
      } else {
        setLoadState('error');
      }
    }
  }, []);

  useEffect(() => {
    void load();

    // Listen for quota_exceeded events from SW (WS close 4003)
    const listener = (
      message: unknown,
    ) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'quota_exceeded'
      ) {
        setQuotaExceeded(true);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [load]);

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      await startCheckout();
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : 'Không thể kết nối dịch vụ thanh toán.',
      );
    } finally {
      setCheckoutLoading(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy="true" aria-label="Đang tải">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-16 w-full animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (loadState === 'unauthenticated') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-gray-700">
          Đăng nhập để xem plan và usage của bạn.
        </p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (loadState === 'error' || billing === null) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-red-600" role="alert">
          Không thể tải thông tin tài khoản.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[44px] w-full rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Thử lại
        </button>
      </div>
    );
  }

  const { tier, usageToday } = billing;
  const isPro = tier === 'pro';

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ── Quota exceeded banner ─────────────────────────────────────────── */}
      {quotaExceeded && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          Đã hết quota miễn phí hôm nay. Nâng cấp Pro để dùng không giới hạn.
        </div>
      )}

      {/* ── Plan header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Gói hiện tại</span>
        <PlanBadge tier={tier} />
      </div>

      {/* ── Usage meter ───────────────────────────────────────────────────── */}
      <UsageMeter
        secondsCaptured={usageToday.secondsCaptured}
        limitSeconds={usageToday.limitSeconds}
      />

      {/* ── Pro CTA / Manage ──────────────────────────────────────────────── */}
      {isPro ? (
        <a
          href={POLAR_CUSTOMER_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Quản lý subscription
        </a>
      ) : (
        <>
          {checkoutError && (
            <p className="text-xs text-red-600" role="alert">
              {checkoutError}
            </p>
          )}
          <UpgradeCta
            onUpgrade={() => void handleUpgrade()}
            loading={checkoutLoading}
          />
        </>
      )}

      {/* ── 7-day usage history ───────────────────────────────────────────── */}
      {history.length > 0 && (
        <section aria-label="Lịch sử usage 7 ngày">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            7 ngày gần đây
          </h3>
          <ul className="flex flex-col gap-1">
            {history.map((day) => {
              const mins = Math.floor(day.secondsCaptured / 60);
              const secs = day.secondsCaptured % 60;
              const label = day.secondsCaptured === 0
                ? '0s'
                : mins > 0
                  ? `${mins}m ${secs}s`
                  : `${secs}s`;
              return (
                <li
                  key={day.date}
                  className="flex items-center justify-between text-xs text-gray-600"
                >
                  <span>{day.date}</span>
                  <span className="font-medium">{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
