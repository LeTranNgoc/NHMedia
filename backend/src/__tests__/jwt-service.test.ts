import { describe, it, expect, beforeAll } from 'vitest';
import { JwtService } from '../auth/jwt-service.js';

const SECRET = 'a'.repeat(32); // 32-char secret for testing
let svc: JwtService;

beforeAll(() => {
  svc = new JwtService(SECRET);
});

describe('JwtService.sign + verify', () => {
  it('signs and verifies a payload', async () => {
    const token = await svc.sign({ userId: 'u1', email: 'a@b.com' });
    expect(typeof token).toBe('string');

    const payload = await svc.verify(token);
    expect(payload.userId).toBe('u1');
    expect(payload.email).toBe('a@b.com');
  });

  it('throws on tampered token', async () => {
    const token = await svc.sign({ userId: 'u2', email: 'b@b.com' });
    const tampered = token.slice(0, -4) + 'XXXX';
    await expect(svc.verify(tampered)).rejects.toThrow();
  });

  it('throws on wrong secret', async () => {
    const other = new JwtService('b'.repeat(32));
    const token = await other.sign({ userId: 'u3', email: 'c@b.com' });
    await expect(svc.verify(token)).rejects.toThrow();
  });

  it('throws on expired token', async () => {
    // sign with -1s TTL (already expired)
    const token = await svc.sign({ userId: 'u4', email: 'd@b.com' }, '-1s');
    await expect(svc.verify(token)).rejects.toThrow();
  });
});
