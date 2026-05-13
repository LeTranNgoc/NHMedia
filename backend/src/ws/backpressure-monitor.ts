export interface BackpressureMonitorOptions {
  /** Maximum frames in flight before drop policy kicks in (default: 5) */
  maxFramesInFlight?: number;
  /** Called once per shouldDrop() invocation that returns true */
  onBackpressure: () => void;
}

/**
 * BackpressureMonitor tracks outstanding audio frames sent to ASR but not yet
 * acknowledged (i.e. transcript returned). When framesInFlight > maxFramesInFlight
 * shouldDrop() returns true and fires the onBackpressure callback.
 */
export class BackpressureMonitor {
  private _framesInFlight = 0;
  private readonly _max: number;
  private readonly _onBackpressure: () => void;

  constructor(opts: BackpressureMonitorOptions) {
    this._max = opts.maxFramesInFlight ?? 5;
    this._onBackpressure = opts.onBackpressure;
  }

  get framesInFlight(): number {
    return this._framesInFlight;
  }

  frameSent(): void {
    this._framesInFlight++;
  }

  frameAcknowledged(): void {
    if (this._framesInFlight > 0) {
      this._framesInFlight--;
    }
  }

  /**
   * Returns true if the server should drop the next incoming audio frame.
   * Side-effect: calls onBackpressure callback when returning true.
   */
  shouldDrop(): boolean {
    if (this._framesInFlight > this._max) {
      this._onBackpressure();
      return true;
    }
    return false;
  }

  reset(): void {
    this._framesInFlight = 0;
  }
}
