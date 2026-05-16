import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MagicLinkBroker, type MagicLinkPayload } from '../lib/magic-link-broker.js';

let broker: MagicLinkBroker;

beforeEach(() => {
  broker = new MagicLinkBroker();
});

afterEach(() => {
  broker.reset();
  vi.useRealTimers();
});

describe('MagicLinkBroker', () => {
  it('publish reaches a single live subscriber', () => {
    const cb = vi.fn();
    broker.subscribe('user@example.com', cb);
    const delivered = broker.publish({
      token: 'jwt',
      userId: 'u1',
      email: 'user@example.com',
    });
    expect(delivered).toBe(1);
    expect(cb).toHaveBeenCalledWith<[MagicLinkPayload]>({
      token: 'jwt',
      userId: 'u1',
      email: 'user@example.com',
    });
  });

  it('email match is case- and whitespace-insensitive', () => {
    const cb = vi.fn();
    broker.subscribe('  User@Example.COM  ', cb);
    broker.publish({ token: 't', userId: 'u', email: 'user@example.com' });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('publish to non-listening email returns 0', () => {
    expect(broker.publish({ token: 't', userId: 'u', email: 'nobody@x.com' })).toBe(0);
  });

  it('multiple subscribers on the same email all receive the event', () => {
    const a = vi.fn();
    const b = vi.fn();
    broker.subscribe('same@x.com', a);
    broker.subscribe('same@x.com', b);
    const delivered = broker.publish({ token: 't', userId: 'u', email: 'same@x.com' });
    expect(delivered).toBe(2);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('subscribers are cleared after publish (one-shot)', () => {
    const cb = vi.fn();
    broker.subscribe('u@x.com', cb);
    broker.publish({ token: 't1', userId: 'u', email: 'u@x.com' });
    broker.publish({ token: 't2', userId: 'u', email: 'u@x.com' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the subscriber without affecting siblings', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = broker.subscribe('u@x.com', a);
    broker.subscribe('u@x.com', b);
    unsubA();
    broker.publish({ token: 't', userId: 'u', email: 'u@x.com' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('throwing subscriber does not block other subscribers', () => {
    const bad = vi.fn(() => {
      throw new Error('SSE closed');
    });
    const good = vi.fn();
    broker.subscribe('u@x.com', bad);
    broker.subscribe('u@x.com', good);
    const delivered = broker.publish({ token: 't', userId: 'u', email: 'u@x.com' });
    expect(delivered).toBe(1); // only the good one counted
    expect(good).toHaveBeenCalled();
  });

  it('subscribers past 15-minute TTL are skipped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const cb = vi.fn();
    broker.subscribe('u@x.com', cb);

    // Jump 16 minutes forward
    vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
    const delivered = broker.publish({ token: 't', userId: 'u', email: 'u@x.com' });
    expect(delivered).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });
});
