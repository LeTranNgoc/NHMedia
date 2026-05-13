import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtService, JwtClaims } from '../auth/jwt-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtClaims;
  }
}

export function buildAuthGuard(jwtService: JwtService) {
  return async function authGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Bearer token required' });
    }

    const token = auth.slice(7);
    try {
      request.user = await jwtService.verify(token);
    } catch {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
  };
}
