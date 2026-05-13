import type { IncomingMessage } from 'node:http';
import type { JwtService, JwtClaims } from '../auth/jwt-service.js';

/**
 * Extract and verify JWT from the WS upgrade request query string.
 * Returns claims on success, or rejects by calling socket.destroy() with 4001.
 *
 * Called BEFORE the WS upgrade is accepted — await this result before calling
 * socket.accept(). This closes the auth-bypass risk where an async verify
 * resolves after the socket is already open.
 */
export async function verifyWsToken(
  request: IncomingMessage,
  jwtService: JwtService,
): Promise<JwtClaims | null> {
  const raw = request.url ?? '';
  const qIndex = raw.indexOf('?');
  const queryString = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
  const params = new URLSearchParams(queryString);
  const token = params.get('token');

  if (!token) return null;

  try {
    return await jwtService.verify(token);
  } catch {
    return null;
  }
}
