import { EventEmitter } from 'node:events';

// ── Singleton in-process event bus — Phase 08 subscribes to 'usage.tick' ──────
export const lifecycleEmitter = new EventEmitter();

export type ConnectionEvent = 'open' | 'close' | 'error';

export interface UsageTickPayload {
  userId: string;
  sessionId: string;
  event: ConnectionEvent;
  ts: number;
}

/**
 * Emit a structured lifecycle event.
 * Callers: relay-server.ts on connection open/close/error.
 * Consumers: Phase 08 billing module (subscribes to 'usage.tick').
 *
 * Audio data is NEVER included in lifecycle events.
 */
export function emitLifecycleEvent(
  event: ConnectionEvent,
  payload: Omit<UsageTickPayload, 'event' | 'ts'>,
): void {
  const tick: UsageTickPayload = {
    ...payload,
    event,
    ts: Date.now(),
  };
  lifecycleEmitter.emit('usage.tick', tick);
}
