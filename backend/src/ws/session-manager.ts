import type { WebSocket } from '@fastify/websocket';
import { WS_CLOSE_CODES } from '@translate-voice/shared';
import type { ASRProvider } from '../providers/asr/asr-provider-interface.js';

export interface Session {
  ws: WebSocket;
  asr: ASRProvider | null;
  lastActivity: number;
}

/**
 * SessionManager enforces one active WS connection per userId.
 * On a second connect for the same user, the first connection is closed with 4002.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  register(userId: string, ws: WebSocket): void {
    const existing = this.sessions.get(userId);
    if (existing !== undefined) {
      existing.ws.close(WS_CLOSE_CODES.DUPLICATE_CONNECTION, 'Duplicate connection');
    }

    this.sessions.set(userId, {
      ws,
      asr: null,
      lastActivity: Date.now(),
    });
  }

  get(userId: string): Session | undefined {
    return this.sessions.get(userId);
  }

  setAsr(userId: string, asr: ASRProvider): void {
    const session = this.sessions.get(userId);
    if (session !== undefined) {
      session.asr = asr;
    }
  }

  updateActivity(userId: string): void {
    const session = this.sessions.get(userId);
    if (session !== undefined) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Delete the session for userId only if the current session's ws matches `ws`.
   * This prevents a kicked ws1's late-firing close handler from clobbering ws2's entry.
   * If `ws` is omitted, delete unconditionally (used in tests and shutdown).
   */
  delete(userId: string, ws?: WebSocket): void {
    if (ws !== undefined) {
      const current = this.sessions.get(userId);
      if (current === undefined || current.ws !== ws) {
        // Entry belongs to a newer connection — do not delete
        return;
      }
    }
    this.sessions.delete(userId);
  }

  hasSession(userId: string): boolean {
    return this.sessions.has(userId);
  }
}
