/**
 * SubtitleOverlay — renders translated text below the YouTube video.
 *
 * Creates a fixed-position div (#tv-subtitle-overlay) above YouTube controls.
 * Text auto-clears after 5 s. Toggle visibility via show/hide.
 * Uses textContent only — no innerHTML on user data (security constraint).
 */

const OVERLAY_ID = 'tv-subtitle-overlay';
const AUTO_CLEAR_MS = 5_000;
const MAX_TEXT_LENGTH = 200;

export class SubtitleOverlay {
  private el: HTMLDivElement | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = true;

  /** Mount the overlay div into document.body if not already present. */
  mount(): void {
    if (document.getElementById(OVERLAY_ID)) {
      this.el = document.getElementById(OVERLAY_ID) as HTMLDivElement;
      return;
    }
    const div = document.createElement('div');
    div.id = OVERLAY_ID;
    document.body.appendChild(div);
    this.el = div;
  }

  /** Display a translation string. Truncates at 200 chars. */
  show(text: string): void {
    if (!this.el) this.mount();

    const truncated =
      text.length > MAX_TEXT_LENGTH
        ? text.slice(0, MAX_TEXT_LENGTH) + '…'
        : text;

    this.el!.textContent = truncated;
    if (text.length > MAX_TEXT_LENGTH) {
      this.el!.title = text;
    } else {
      this.el!.removeAttribute('title');
    }

    if (this.visible) {
      this.el!.removeAttribute('hidden');
    }

    this.scheduleAutoClear();
  }

  /** Enable subtitle display. */
  enable(): void {
    this.visible = true;
    if (this.el && this.el.textContent) {
      this.el.removeAttribute('hidden');
    }
  }

  /** Disable subtitle display without destroying the element. */
  disable(): void {
    this.visible = false;
    this.el?.setAttribute('hidden', '');
  }

  /** Clear text immediately and cancel auto-clear timer. */
  clear(): void {
    if (this.el) this.el.textContent = '';
    this.cancelAutoClear();
  }

  /** Remove overlay from DOM. */
  unmount(): void {
    this.cancelAutoClear();
    this.el?.remove();
    this.el = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private scheduleAutoClear(): void {
    this.cancelAutoClear();
    this.clearTimer = setTimeout(() => {
      if (this.el) this.el.textContent = '';
    }, AUTO_CLEAR_MS);
  }

  private cancelAutoClear(): void {
    if (this.clearTimer !== null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }
}
