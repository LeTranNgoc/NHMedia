/**
 * StatusBadge — fixed top-right badge on the YouTube page.
 *
 * Shows current pipeline state: "VN: ON ●" / "VN: OFF".
 * Click dispatches a toggle message to the SW.
 * Uses textContent only — no innerHTML.
 */

import type { PopupStopMsg, ContentStartSessionMsg } from '../../shared/messaging-types';

const BADGE_ID = 'tv-status-badge';

type BadgeStatus = 'idle' | 'capturing' | 'translating' | 'playing' | 'error';

const STATUS_LABELS: Record<BadgeStatus, string> = {
  idle: 'VN: OFF',
  capturing: 'VN: ON ◉',
  translating: 'VN: ◌',
  playing: 'VN: ON ●',
  error: 'VN: ERR',
};

export class StatusBadge {
  private el: HTMLButtonElement | null = null;
  private enabled = false;
  private activeTabId: number | null = null;

  /** Mount the badge into document.body. Safe to call multiple times. */
  mount(): void {
    if (document.getElementById(BADGE_ID)) {
      this.el = document.getElementById(BADGE_ID) as HTMLButtonElement;
      return;
    }
    const btn = document.createElement('button');
    btn.id = BADGE_ID;
    btn.setAttribute('aria-label', 'Translate Voice — toggle');
    btn.addEventListener('click', () => this.handleClick());
    document.body.appendChild(btn);
    this.el = btn;
    this.render('idle', false);
  }

  /** Update the badge to reflect current pipeline status. */
  update(status: BadgeStatus, enabled: boolean): void {
    this.enabled = enabled;
    this.render(status, enabled);
  }

  setActiveTabId(tabId: number): void {
    this.activeTabId = tabId;
  }

  /** Remove badge from DOM. */
  unmount(): void {
    this.el?.remove();
    this.el = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private render(status: BadgeStatus, enabled: boolean): void {
    if (!this.el) return;
    this.el.textContent = enabled ? STATUS_LABELS[status] : STATUS_LABELS['idle'];
    this.el.setAttribute('data-status', status);
    this.el.setAttribute('data-enabled', String(enabled));
  }

  private handleClick(): void {
    if (this.enabled) {
      const msg: PopupStopMsg = { type: 'popup.stop' };
      chrome.runtime.sendMessage(msg).catch(() => {});
    } else {
      // Ask SW to start capture on this tab.
      // SW uses sender.tab.id — no `tabs` permission needed in content script.
      const msg: ContentStartSessionMsg = { type: 'content.startSession' };
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  }
}
