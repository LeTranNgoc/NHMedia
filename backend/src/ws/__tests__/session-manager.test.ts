import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../session-manager.js';

function makeMockWs() {
  return {
    close: vi.fn(),
    send: vi.fn(),
    readyState: 1, // OPEN
  };
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('registers a new session without error', () => {
    const ws = makeMockWs();
    expect(() => manager.register('user1', ws as never)).not.toThrow();
  });

  it('second register for same user kicks the first connection (close 4002)', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    manager.register('user1', ws1 as never);
    manager.register('user1', ws2 as never);

    expect(ws1.close).toHaveBeenCalledWith(4002, expect.any(String));
    expect(ws2.close).not.toHaveBeenCalled();
  });

  it('get returns the active session after register', () => {
    const ws = makeMockWs();
    manager.register('user1', ws as never);
    const session = manager.get('user1');
    expect(session).toBeDefined();
    expect(session!.ws).toBe(ws);
  });

  it('delete removes the session', () => {
    const ws = makeMockWs();
    manager.register('user1', ws as never);
    manager.delete('user1');
    expect(manager.get('user1')).toBeUndefined();
  });

  it('get returns undefined for unknown user', () => {
    expect(manager.get('unknown')).toBeUndefined();
  });

  it('updateActivity resets lastActivity', () => {
    const ws = makeMockWs();
    manager.register('user1', ws as never);

    const before = manager.get('user1')!.lastActivity;
    // Advance time slightly
    vi.useFakeTimers();
    vi.advanceTimersByTime(1000);
    manager.updateActivity('user1');
    const after = manager.get('user1')!.lastActivity;
    vi.useRealTimers();

    expect(after).toBeGreaterThan(before);
  });

  it('hasSession returns true only when user registered', () => {
    const ws = makeMockWs();
    expect(manager.hasSession('user1')).toBe(false);
    manager.register('user1', ws as never);
    expect(manager.hasSession('user1')).toBe(true);
    manager.delete('user1');
    expect(manager.hasSession('user1')).toBe(false);
  });

  it('delete with ws guard — ws1 close handler does NOT clobber ws2 entry', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    // ws1 connects, ws2 kicks it
    manager.register('user1', ws1 as never);
    manager.register('user1', ws2 as never);

    // ws1's late close handler fires — should be a no-op because ws2 owns the slot
    manager.delete('user1', ws1 as never);

    // ws2's entry must still be in the map
    const session = manager.get('user1');
    expect(session).toBeDefined();
    expect(session!.ws).toBe(ws2);
  });

  it('delete with matching ws removes the entry', () => {
    const ws = makeMockWs();
    manager.register('user1', ws as never);
    manager.delete('user1', ws as never);
    expect(manager.get('user1')).toBeUndefined();
  });

  it('delete without ws arg removes entry unconditionally (backward compat)', () => {
    const ws = makeMockWs();
    manager.register('user1', ws as never);
    manager.delete('user1');
    expect(manager.get('user1')).toBeUndefined();
  });
});
