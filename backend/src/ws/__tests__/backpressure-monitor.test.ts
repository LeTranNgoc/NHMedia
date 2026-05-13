import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackpressureMonitor } from '../backpressure-monitor.js';

describe('BackpressureMonitor', () => {
  let monitor: BackpressureMonitor;
  let warnCb: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warnCb = vi.fn();
    monitor = new BackpressureMonitor({ onBackpressure: warnCb, maxFramesInFlight: 5 });
  });

  it('starts with 0 frames in flight', () => {
    expect(monitor.framesInFlight).toBe(0);
  });

  it('increments framesInFlight on framesSent', () => {
    monitor.frameSent();
    monitor.frameSent();
    expect(monitor.framesInFlight).toBe(2);
  });

  it('decrements framesInFlight on frameAcknowledged', () => {
    monitor.frameSent();
    monitor.frameSent();
    monitor.frameAcknowledged();
    expect(monitor.framesInFlight).toBe(1);
  });

  it('does not go below 0 on extra acknowledgements', () => {
    monitor.frameAcknowledged();
    expect(monitor.framesInFlight).toBe(0);
  });

  it('returns shouldDrop=false when under threshold', () => {
    monitor.frameSent();
    monitor.frameSent();
    expect(monitor.shouldDrop()).toBe(false);
  });

  it('returns shouldDrop=true when at threshold and calls onBackpressure', () => {
    for (let i = 0; i < 6; i++) monitor.frameSent();
    expect(monitor.shouldDrop()).toBe(true);
    expect(warnCb).toHaveBeenCalledOnce();
  });

  it('calls onBackpressure callback only once per shouldDrop call', () => {
    for (let i = 0; i < 10; i++) monitor.frameSent();
    monitor.shouldDrop();
    expect(warnCb).toHaveBeenCalledTimes(1);
  });

  it('resets state on reset()', () => {
    for (let i = 0; i < 6; i++) monitor.frameSent();
    monitor.reset();
    expect(monitor.framesInFlight).toBe(0);
    expect(monitor.shouldDrop()).toBe(false);
  });
});
