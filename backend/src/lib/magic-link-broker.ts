/**
 * In-process pub/sub keyed by email — wires the magic-link verify route to
 * any SSE listeners waiting on the same email.
 *
 * The popup opens an SSE on `/auth/magic-link/listen?email=<>` right after
 * the request endpoint succeeds. When the user clicks the email link,
 * `/auth/magic-link/verify` resolves the user, then publishes `{token}` to
 * this broker. The broker pushes to all subscribed SSE responses + clears
 * the subscriber list (one-shot — magic links are single-use).
 *
 * Scope:
 *   - Single-instance only. Multi-machine deploy needs a Redis pub-sub
 *     swap (subscribe + publish to a "magic-link:<email>" channel). Closed
 *     beta runs on 1 Fly VM so in-memory is sufficient.
 *   - 15-minute subscriber TTL matches the magic-link token TTL — past that
 *     the SSE auto-closes and the popup falls back to the manual paste flow.
 */

export interface MagicLinkPayload {
  token: string;
  userId: string;
  email: string;
}

type Subscriber = (payload: MagicLinkPayload) => void;

const SUBSCRIBER_TTL_MS = 15 * 60 * 1000;

interface SubEntry {
  cb: Subscriber;
  expiresAt: number;
}

export class MagicLinkBroker {
  private readonly subs = new Map<string, SubEntry[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Subscribe to magic-link verify events for `email`. Returns an
   * `unsubscribe` callback — caller MUST invoke it when the SSE closes
   * to avoid leaking subscribers on dropped connections.
   */
  subscribe(email: string, cb: Subscriber): () => void {
    const normalized = normalizeEmail(email);
    const entry: SubEntry = { cb, expiresAt: Date.now() + SUBSCRIBER_TTL_MS };
    const list = this.subs.get(normalized) ?? [];
    list.push(entry);
    this.subs.set(normalized, list);
    this.startCleanupTimer();

    return () => {
      const current = this.subs.get(normalized);
      if (!current) return;
      const idx = current.indexOf(entry);
      if (idx >= 0) current.splice(idx, 1);
      if (current.length === 0) this.subs.delete(normalized);
    };
  }

  /**
   * Publish a verify event. Pushes to every live subscriber for this email,
   * then clears them (one-shot semantics — token is single-use anyway).
   * Returns the number of subscribers notified — 0 means popup wasn't
   * listening, the user will need to paste manually.
   */
  publish(payload: MagicLinkPayload): number {
    const normalized = normalizeEmail(payload.email);
    const list = this.subs.get(normalized);
    if (!list || list.length === 0) return 0;
    const now = Date.now();
    let delivered = 0;
    for (const sub of list) {
      if (sub.expiresAt <= now) continue;
      try {
        sub.cb(payload);
        delivered++;
      } catch {
        // Subscriber threw — drop it. Common when SSE has already closed.
      }
    }
    this.subs.delete(normalized);
    return delivered;
  }

  /** Test helper — drop everything. */
  reset(): void {
    this.subs.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [email, list] of this.subs) {
        const live = list.filter((s) => s.expiresAt > now);
        if (live.length === 0) this.subs.delete(email);
        else this.subs.set(email, live);
      }
      // Stop polling when nothing is subscribed (saves the event-loop tick).
      if (this.subs.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }, 60 * 1000);
    // Don't keep the event loop alive just for this — `unref` on Node-only
    // hosts. fastify shuts the timer down via reset() at process exit.
    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
