import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MagicLinkService } from '../auth/magic-link-service.js';
import type { GoogleOAuthService } from '../auth/google-oauth-service.js';
import type { JwtService } from '../auth/jwt-service.js';
import { buildAuthGuard } from '../middleware/auth-guard.js';
import type { User } from '../db/models/user.js';
import type { EmailRateLimiter } from '../lib/email-rate-limiter.js';

const magicLinkRequestBody = z.object({
  email: z.string().email('Invalid email address'),
});

const googleCallbackBody = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

export interface AuthRoutesOptions {
  magicLinkService: MagicLinkService;
  googleOAuthService: GoogleOAuthService;
  jwtService: JwtService;
  /** Rate limiter for /magic-link/request — keyed per email, 5 req/hour */
  emailRateLimiter: EmailRateLimiter;
}

function userToDto(user: User) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions): Promise<void> {
  const { magicLinkService, googleOAuthService, jwtService, emailRateLimiter } = opts;
  const authGuard = buildAuthGuard(jwtService);

  // POST /magic-link/request — rate-limited 5/hour per email
  app.post('/magic-link/request', async (request, reply) => {
    const parsed = magicLinkRequestBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      });
    }

    const { email } = parsed.data;

    if (!emailRateLimiter.check(email)) {
      return reply.status(429).send({
        code: 'RATE_LIMITED',
        message: 'Too many requests — try again later',
      });
    }

    await magicLinkService.request(email);
    return reply.status(204).send();
  });

  // GET /magic-link/verify?token=...
  app.get('/magic-link/verify', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const rawToken = query['token'];

    if (!rawToken) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'token is required' });
    }

    const user = await magicLinkService.verify(rawToken);
    const jwt = await jwtService.sign({ userId: user._id.toString(), email: user.email });

    return reply.status(200).send({ token: jwt, user: userToDto(user) });
  });

  // POST /google/callback
  app.post('/google/callback', async (request, reply) => {
    const parsed = googleCallbackBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      });
    }

    const user = await googleOAuthService.verifyIdToken(parsed.data.idToken);
    const jwt = await jwtService.sign({ userId: user._id.toString(), email: user.email });

    return reply.status(200).send({ token: jwt, user: userToDto(user) });
  });

  // POST /logout — stateless JWT; exists for parity + future revocation list
  app.post('/logout', { preHandler: authGuard }, async (_request, reply) => {
    return reply.status(204).send();
  });

  // GET /me — protected
  app.get('/me', { preHandler: authGuard }, async (request, reply) => {
    return reply.status(200).send({ user: request.user });
  });
}
