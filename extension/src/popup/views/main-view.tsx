import { useState, useEffect } from 'react';
import { OnOffSwitch } from '../components/on-off-switch';
import { StatusIndicator } from '../components/status-indicator';
import type { PipelineStatus } from '../components/status-indicator';
import { useSettings } from '../../shared/settings-store';
import { getLanguageLabel } from '../../shared/language-options';
import type { StatusResponse, PipelineStatusMsg, CcSourceInfo } from '../../shared/messaging-types';
import type { BillingMeResponse } from '@translate-voice/shared';
import { getBillingMe } from '../../shared/billing-api-client';

// ── Mini quota bar ────────────────────────────────────────────────────────────

interface MiniQuotaBarProps {
  label: string;
  used: number;
  limit: number | null;
  formatUsed?: (n: number) => string;
}

function MiniQuotaBar({ label, used, limit, formatUsed }: MiniQuotaBarProps) {
  const fmt = formatUsed ?? ((n) => String(n));
  if (limit === null) return null; // pro — don't render

  const pct = Math.min(100, Math.round((used / limit) * 100));
  const isWarning = pct >= 50 && pct < 80;
  const isDanger = pct >= 80;

  const barColor = isDanger ? 'bg-red-500' : isWarning ? 'bg-yellow-400' : 'bg-green-500';
  const textColor = isDanger ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-gray-500';

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        <span className={`text-xs font-medium ${textColor}`}>
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct}% used`}
        className="h-1.5 w-full rounded-full bg-gray-200"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function fmtSecs(s: number) {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m` : `${s}s`;
}

function fmtK(n: number) {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

// ── MainView ──────────────────────────────────────────────────────────────────

export function MainView() {
  const { settings, updateSettings } = useSettings();
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [detectedLang, setDetectedLang] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [toggling, setToggling] = useState(false);
  const [ccSource, setCcSource] = useState<CcSourceInfo | undefined>();
  const [billing, setBilling] = useState<BillingMeResponse | null>(null);

  // Load initial SW status
  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'popup.getStatus' })
      .then((resp: StatusResponse) => {
        if (resp?.active) {
          setStatus(resp.status ?? 'capturing');
          setDetectedLang(resp.detectedLang);
        }
      })
      .catch(() => {});
  }, []);

  // Subscribe to pipeline status updates from SW
  useEffect(() => {
    const listener = (msg: PipelineStatusMsg) => {
      if (msg.type !== 'pipeline.status') return;
      setStatus(msg.status);
      if (msg.detectedLang) setDetectedLang(msg.detectedLang);
      if (msg.errorMessage) setErrorMessage(msg.errorMessage);
      else setErrorMessage(undefined);
      setCcSource(msg.ccSource);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Load quota info (best-effort — silent on failure)
  useEffect(() => {
    getBillingMe()
      .then((me) => setBilling(me))
      .catch(() => {});
  }, []);

  const handleToggle = async (on: boolean) => {
    if (toggling) return;
    setToggling(true);
    try {
      if (on) {
        // Prefer the active tab if it's YouTube; otherwise pick any YouTube tab
        // in the current window. Avoids "tab is not a YouTube tab" when the user
        // clicks the toolbar icon while focused on chrome://extensions or DevTools.
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        const isYt = (u?: string) => !!u && /^https?:\/\/(www\.)?youtube\.com\//.test(u);
        let tab = isYt(active?.url) ? active : undefined;
        if (!tab) {
          const yts = await chrome.tabs.query({ url: '*://*.youtube.com/*', currentWindow: true });
          tab = yts[0];
        }
        if (!tab?.id) throw new Error('Mở một tab YouTube trước khi bật');
        await chrome.runtime.sendMessage({ type: 'popup.start', tabId: tab.id });
        setStatus('capturing');
      } else {
        await chrome.runtime.sendMessage({ type: 'popup.stop' });
        setStatus('idle');
        setDetectedLang(undefined);
        setCcSource(undefined);
      }
      await updateSettings({ enabled: on });
    } catch (err) {
      setStatus('error');
      setErrorMessage(String(err));
    } finally {
      setToggling(false);
    }
  };

  const isOn = status !== 'idle' && status !== 'error';
  const isPaid = billing !== null && billing.tier !== 'free';
  const paidLabel = (() => {
    if (!isPaid || billing === null) return '';
    const hours =
      billing.limits.seconds !== null ? Math.round(billing.limits.seconds / 3600) : null;
    const name = billing.tier.charAt(0).toUpperCase() + billing.tier.slice(1);
    return hours !== null ? `${name} — ${hours}h/tháng` : name;
  })();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Translate Voice</h2>
          <p className="text-xs text-gray-500">Vietnamese dubbing for YouTube</p>
        </div>
        <OnOffSwitch
          checked={isOn}
          onChange={handleToggle}
          disabled={toggling}
          label="Enable Translate Voice"
        />
      </div>

      <StatusIndicator status={status} detectedLang={detectedLang} errorMessage={errorMessage} />

      {isOn && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">
            {getLanguageLabel(settings.srcLanguage, 'source')}
          </span>
          {' → '}
          <span className="font-medium text-gray-700">
            {getLanguageLabel(settings.targetLanguage, 'target')}
          </span>
        </p>
      )}

      {status === 'capturing' || status === 'translating' || status === 'playing' ? (
        <p className="text-xs text-gray-500">
          {ccSource ? (
            <span
              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700"
              aria-label={`Source: YouTube CC ${ccSource.lang.toUpperCase()} ${ccSource.kind === 'asr' ? '(auto-generated)' : '(manual)'}`}
            >
              <span aria-hidden="true">CC</span> {ccSource.lang.toUpperCase()}{' '}
              {ccSource.kind === 'asr' ? '(auto)' : '(manual)'}
            </span>
          ) : (
            <span className="text-gray-400">Using audio capture</span>
          )}
        </p>
      ) : null}

      {detectedLang && (
        <p className="text-xs text-gray-500">
          Detected: <span className="font-medium text-gray-700">{detectedLang.toUpperCase()}</span>
        </p>
      )}

      {/* ── Quota section ──────────────────────────────────────────────────── */}
      {billing !== null && (
        <div
          className="flex flex-col gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
          aria-label="Daily quota"
        >
          {isPaid ? (
            <span
              className="inline-flex w-fit items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
              aria-label={paidLabel}
            >
              {paidLabel}
            </span>
          ) : (
            <>
              <MiniQuotaBar
                label="Audio"
                used={billing.usageToday.secondsCaptured}
                limit={billing.limits.seconds}
                formatUsed={fmtSecs}
              />
              <MiniQuotaBar
                label="Dịch"
                used={billing.usageToday.translateChars}
                limit={billing.limits.translateChars}
                formatUsed={fmtK}
              />
              <MiniQuotaBar
                label="TTS"
                used={billing.usageToday.ttsChars}
                limit={billing.limits.ttsChars}
                formatUsed={fmtK}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
