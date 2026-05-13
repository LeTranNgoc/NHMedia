import { useState, useEffect } from 'react';
import { OnOffSwitch } from '../components/on-off-switch';
import { StatusIndicator } from '../components/status-indicator';
import type { PipelineStatus } from '../components/status-indicator';
import { useSettings } from '../../shared/settings-store';
import type { StatusResponse, PipelineStatusMsg } from '../../shared/messaging-types';

export function MainView() {
  const { updateSettings } = useSettings();
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [detectedLang, setDetectedLang] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [toggling, setToggling] = useState(false);

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
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleToggle = async (on: boolean) => {
    if (toggling) return;
    setToggling(true);
    try {
      if (on) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab');
        await chrome.runtime.sendMessage({ type: 'popup.start', tabId: tab.id });
        setStatus('capturing');
      } else {
        await chrome.runtime.sendMessage({ type: 'popup.stop' });
        setStatus('idle');
        setDetectedLang(undefined);
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

      <StatusIndicator
        status={status}
        detectedLang={detectedLang}
        errorMessage={errorMessage}
      />

      {detectedLang && (
        <p className="text-xs text-gray-500">
          Detected language: <span className="font-medium text-gray-700">{detectedLang.toUpperCase()}</span>
        </p>
      )}
    </div>
  );
}
