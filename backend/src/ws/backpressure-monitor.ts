export interface BackpressureMonitorOptions {
  /** Maximum frames in flight before drop policy kicks in (default: 5) */
  maxFramesInFlight?: number;
  /** Called once per shouldDrop() invocation that returns true */
  onBackpressure: () => void;
  /** Reset the counter if no ACK has fired in this many ms. Defends against
   *  long silences where the ASR doesn't emit Results — counter would otherwise
   *  saturate and start dropping legitimate audio when speech resumes.
   *  Default: 30s. */
  staleResetMs?: number;
}

/**
 * BackpressureMonitor tracks outstanding audio frames sent to ASR but not yet
 * acknowledged (i.e. transcript returned). When framesInFlight > maxFramesInFlight
 * shouldDrop() returns true and fires the onBackpressure callback.
 */
export class BackpressureMonitor {
  private _framesInFlight = 0;
  private _lastAckAt = Date.now();
  private readonly _max: number;
  private readonly _staleResetMs: number;
  private readonly _onBackpressure: () => void;

  constructor(opts: BackpressureMonitorOptions) {
    this._max = opts.maxFramesInFlight ?? 5;
    this._staleResetMs = opts.staleResetMs ?? 30_000;
    this._onBackpressure = opts.onBackpressure;
  }

  get framesInFlight(): number {
    return this._framesInFlight;
  }

  frameSent(): void {
    this._framesInFlight++;
  }

  frameAcknowledged(): void {
    this._lastAckAt = Date.now();
    if (this._framesInFlight > 0) {
      this._framesInFlight--;
    }
  }

  /**
   * Returns true if the server should drop the next incoming audio frame.
   * Side-effect: calls onBackpressure callback when returning true.
   *
   * Counter is force-reset if no ACK arrived in staleResetMs — prevents the
   * "long silence" lockup where audio frames pile up faster than Metadata
   * ACKs arrive, eventually saturating and dropping legitimate speech once
   * the user starts talking again.
   */
  shouldDrop(): boolean {
    if (this._framesInFlight > this._max) {
      if (Date.now() - this._lastAckAt > this._staleResetMs) {
        console.warn(
          `[bp] stale (${this._framesInFlight} in-flight, no ACK in ${this._staleResetMs}ms) — resetting counter`,
        );
        this._framesInFlight = 0;
        this._lastAckAt = Date.now();
        return false;
      }
      this._onBackpressure();
      return true;
    }
    return false;
  }

  reset(): void {
    this._framesInFlight = 0;
    this._lastAckAt = Date.now();
  }
}
