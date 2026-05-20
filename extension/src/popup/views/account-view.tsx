import { useState, useEffect, useCallback, useRef } from 'react';
import type { BillingMeResponse, Tier, UsageSummary } from '@translate-voice/shared';
import {
  getBillingMe,
  getUsageHistory,
  startCheckout,
  cancelSubscription,
} from '../../shared/billing-api-client';
import {
  signInWithGoogle,
  requestMagicLink,
  signInWithToken,
  signOut,
  listenForMagicLink,
} from '../../shared/auth-client';
import { PlanBadge } from '../components/plan-badge';
import { UsageMeter } from '../components/usage-meter';

type LoadState = 'loading' | 'loaded' | 'error' | 'unauthenticated';
type SignInStep = 'idle' | 'email-form' | 'link-sent' | 'google-pending';

// ── Tier display metadata ────────────────────────────────────────────────────

type PaidTier = Exclude<Tier, 'free'>;

interface TierMeta {
  tier: PaidTier;
  displayName: string;
  price: string;
  /** limit in seconds — used to compute "X giờ/tháng" display */
  limitSeconds: number;
}

const PAID_TIERS: TierMeta[] = [
  { tier: 'starter', displayName: 'Starter', price: '$4.99/tháng', limitSeconds: 5 * 3600 },
  { tier: 'standard', displayName: 'Standard', price: '$9.99/tháng', limitSeconds: 15 * 3600 },
  { tier: 'pro', displayName: 'Pro', price: '$19.99/tháng', limitSeconds: 40 * 3600 },
  { tier: 'unlimited', displayName: 'Unlimited', price: '$39.99/tháng', limitSeconds: 200 * 3600 },
];

function capDisplay(limitSeconds: number): string {
  return `${Math.round(limitSeconds / 3600)} giờ/tháng`;
}

/**
 * AccountView — shows plan + usage when authenticated, sign-in card when not.
 * Sign-in paths: Google OAuth (launchWebAuthFlow) + magic-link copy-paste.
 */
export function AccountView() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [billing, setBilling] = useState<BillingMeResponse | null>(null);
  const [history, setHistory] = useState<UsageSummary[]>([]);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // ── Cancel subscription state ────────────────────────────────────────────
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelFeedback, setCancelFeedback] = useState<string | null>(null);

  // ── Sign-in state ────────────────────────────────────────────────────────────
  const [signInStep, setSignInStep] = useState<SignInStep>('idle');
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [pastedToken, setPastedToken] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInLoading, setSignInLoading] = useState(false);
  // AbortController for the in-flight SSE listener so Cancel / sign-out kills it.
  const sseAbort = useRef<AbortController | null>(null);

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

    const listener = (message: unknown) => {
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

  // ── Sign-in handlers ─────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    setSignInError(null);
    setSignInLoading(true);
    setSignInStep('google-pending');
    try {
      await signInWithGoogle();
      // Token stored — reload account data
      await load();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
      setSignInStep('idle');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleMagicLinkRequest = async () => {
    if (!email.trim()) return;
    setSignInError(null);
    setSignInLoading(true);
    const trimmed = email.trim();
    try {
      await requestMagicLink(trimmed);
      setSentEmail(trimmed);
      setSignInStep('link-sent');

      // Open SSE in background — when user clicks the email link, backend
      // pushes the JWT here and we auto-load without copy-paste. Cancel
      // path drops back to the textarea fallback below.
      sseAbort.current?.abort();
      sseAbort.current = new AbortController();
      void listenForMagicLink(trimmed, sseAbort.current.signal).then((emailOnSuccess) => {
        if (emailOnSuccess) {
          // JWT already stored by listenForMagicLink; refresh account data.
          void load();
        }
      });
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Gửi link thất bại');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSaveToken = async () => {
    if (!pastedToken.trim()) return;
    setSignInError(null);
    setSignInLoading(true);
    try {
      await signInWithToken(pastedToken.trim());
      await load();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Token không hợp lệ');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSignOut = async () => {
    sseAbort.current?.abort();
    sseAbort.current = null;
    await signOut();
    setBilling(null);
    setHistory([]);
    setSignInStep('idle');
    setEmail('');
    setPastedToken('');
    setSignInError(null);
    setLoadState('unauthenticated');
  };

  // ── Cancel subscription handler ──────────────────────────────────────────────
  const handleCancel = async () => {
    if (!window.confirm('Bạn có chắc muốn hủy gói?')) return;
    setCancelLoading(true);
    setCancelFeedback(null);
    try {
      await cancelSubscription();
      setCancelFeedback('Đã hủy. Bạn vẫn dùng được đến cuối kỳ.');
      await load();
    } catch (err) {
      setCancelFeedback(
        `Hủy thất bại: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`,
      );
    } finally {
      setCancelLoading(false);
    }
  };

  // ── Checkout handler ─────────────────────────────────────────────────────────
  const [checkoutLoading, setCheckoutLoading] = useState<PaidTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = async (tier: PaidTier) => {
    setCheckoutLoading(tier);
    setCheckoutError(null);
    try {
      await startCheckout(tier);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Không thể mở trang thanh toán.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  // Tear down any open SSE on unmount (popup closed).
  useEffect(
    () => () => {
      sseAbort.current?.abort();
    },
    [],
  );

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy="true" aria-label="Đang tải">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-16 w-full animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  // ── Unauthenticated — sign-in card ───────────────────────────────────────────
  if (loadState === 'unauthenticated') {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium text-gray-700">Đăng nhập để xem plan và usage</p>

        {signInError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
            Đăng nhập thất bại: {signInError}
          </p>
        )}

        {/* ── Google button ──────────────────────────────────────────────── */}
        {signInStep !== 'email-form' && signInStep !== 'link-sent' && (
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={signInLoading}
            aria-busy={signInLoading}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-60"
          >
            {signInStep === 'google-pending' ? (
              <span className="animate-spin">⟳</span>
            ) : (
              <GoogleIcon />
            )}
            Đăng nhập với Google
          </button>
        )}

        {/* ── Email / magic-link flow ────────────────────────────────────── */}
        {signInStep === 'idle' && (
          <button
            type="button"
            onClick={() => {
              setSignInStep('email-form');
              setSignInError(null);
            }}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Đăng nhập bằng email
          </button>
        )}

        {signInStep === 'email-form' && (
          <div className="flex flex-col gap-2">
            <label htmlFor="signin-email" className="text-xs font-medium text-gray-600">
              Email của bạn
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleMagicLinkRequest();
              }}
              placeholder="ban@example.com"
              className="min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={signInLoading}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleMagicLinkRequest()}
                disabled={signInLoading || !email.trim()}
                aria-busy={signInLoading}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-60"
              >
                {signInLoading ? 'Đang gửi…' : 'Gửi link đăng nhập'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSignInStep('idle');
                  setSignInError(null);
                  setEmail('');
                }}
                className="min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                Hủy
              </button>
            </div>
          </div>
        )}

        {signInStep === 'link-sent' && (
          <div className="flex flex-col gap-2">
            <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
              Đã gửi link đến <strong>{sentEmail}</strong>. Mở email và click vào link — popup sẽ tự
              động đăng nhập khi link được mở.
              <br />
              <span className="text-gray-500">
                (Nếu auto không hoạt động: sao chép token từ trang đăng nhập và dán bên dưới.)
              </span>
            </p>
            <label htmlFor="paste-token" className="text-xs font-medium text-gray-600">
              Dán token từ trang đăng nhập
            </label>
            <textarea
              id="paste-token"
              rows={3}
              value={pastedToken}
              onChange={(e) => setPastedToken(e.target.value)}
              placeholder="Dán JWT token vào đây..."
              className="rounded-md border border-gray-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={signInLoading}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveToken()}
                disabled={signInLoading || !pastedToken.trim()}
                aria-busy={signInLoading}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-60"
              >
                {signInLoading ? 'Đang xác thực…' : 'Lưu token'}
              </button>
              <button
                type="button"
                onClick={() => {
                  sseAbort.current?.abort();
                  setSignInStep('idle');
                  setPastedToken('');
                  setSignInError(null);
                }}
                className="min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
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

  const { tier, usageToday, customerPortalUrl } = billing;
  const isPaid = tier !== 'free';

  // ── Authenticated ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ── Quota exceeded banner ───────────────────────────────────────── */}
      {quotaExceeded && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          Đã hết quota hôm nay. Chọn gói trả phí để tăng giới hạn.
        </div>
      )}

      {/* ── Plan header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Gói hiện tại</span>
        <PlanBadge tier={tier} />
      </div>

      {/* ── Usage meter ─────────────────────────────────────────────────── */}
      <UsageMeter
        secondsCaptured={usageToday.secondsCaptured}
        limitSeconds={usageToday.limitSeconds}
      />

      {/* ── Paid tier actions ────────────────────────────────────────────── */}
      {isPaid ? (
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
            aria-label={`Trạng thái gói ${tier}`}
          >
            <span className="font-semibold capitalize">{tier}</span>
            <span className="text-green-600">— đang hoạt động</span>
          </div>

          <a
            href={customerPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Quản lý subscription
          </a>

          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelLoading}
            aria-busy={cancelLoading}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-60"
          >
            {cancelLoading ? 'Đang hủy…' : 'Hủy gói'}
          </button>

          {cancelFeedback && (
            <p
              role="status"
              className={[
                'rounded-md px-3 py-2 text-xs',
                cancelFeedback.startsWith('Đã hủy')
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-600',
              ].join(' ')}
            >
              {cancelFeedback}
            </p>
          )}
        </div>
      ) : (
        /* ── Free tier — plan cards ──────────────────────────────────────── */
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Nâng cấp gói
          </p>

          {checkoutError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
              {checkoutError}
            </p>
          )}

          {PAID_TIERS.map((meta) => (
            <div
              key={meta.tier}
              className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-800">{meta.displayName}</span>
                <span className="text-xs text-gray-500">
                  {meta.price} · {capDisplay(meta.limitSeconds)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleCheckout(meta.tier)}
                disabled={checkoutLoading !== null}
                aria-busy={checkoutLoading === meta.tier}
                aria-label={`Chọn gói ${meta.displayName}`}
                className="ml-3 flex min-h-[36px] shrink-0 items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-60"
              >
                {checkoutLoading === meta.tier ? (
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
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
                ) : (
                  'Chọn gói'
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── 7-day usage history ──────────────────────────────────────────── */}
      {history.length > 0 && (
        <section aria-label="Lịch sử usage 7 ngày">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            7 ngày gần đây
          </h3>
          <ul className="flex flex-col gap-1">
            {history.map((day) => {
              const mins = Math.floor(day.secondsCaptured / 60);
              const secs = day.secondsCaptured % 60;
              const label =
                day.secondsCaptured === 0 ? '0s' : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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

      {/* ── Sign out ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="min-h-[44px] w-full rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        Đăng xuất
      </button>
    </div>
  );
}

// ── Internal: Google "G" icon (inline SVG, no external dep) ─────────────────

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M43.6 20.5h-1.9V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.2-.4-3.5z"
        fill="#FFC107"
      />
      <path
        d="M6.3 14.7l6.6 4.8C14.6 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        fill="#FF3D00"
      />
      <path
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
        fill="#4CAF50"
      />
      <path
        d="M43.6 20.5h-1.9V20H24v8h11.3c-.8 2.2-2.3 4.1-4.1 5.4l6.2 5.2C37 38 44 33 44 24c0-1.2-.1-2.2-.4-3.5z"
        fill="#1976D2"
      />
    </svg>
  );
}
