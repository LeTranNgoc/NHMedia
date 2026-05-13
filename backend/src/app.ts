import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocketPlugin from '@fastify/websocket';
import type { Db } from 'mongodb';
import { JwtService } from './auth/jwt-service.js';
import { MagicLinkService } from './auth/magic-link-service.js';
import { EmailService } from './auth/email-service.js';
import { GoogleOAuthService } from './auth/google-oauth-service.js';
import { EmailRateLimiter } from './lib/email-rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth-routes.js';
import { healthRoutes } from './routes/health-routes.js';
import { registerRelayServer } from './ws/relay-server.js';
import { billingRoutes } from './routes/billing-routes.js';
import { UsageTracker } from './lib/usage-tracker.js';
import { PolarClient } from './billing/polar-client.js';

export interface AppEnv {
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  MAGIC_LINK_BASE_URL: string;
  CORS_ORIGINS: string;
  NODE_ENV: string;
  ALLOWED_EXTENSION_IDS?: string;
  MONGO_URI?: string;
  PORT?: string | number;
  DEEPGRAM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLOUD_TTS_KEY_FILE?: string;
  POLAR_API_KEY?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRODUCT_ID_PRO?: string;
}

export interface BuildAppOptions {
  db: Db;
  env: AppEnv;
  /** Optional service overrides — inject mocks in tests */
  overrides?: {
    emailService?: EmailService;
    magicLinkService?: MagicLinkService;
    googleOAuthService?: GoogleOAuthService;
    emailRateLimiter?: EmailRateLimiter;
    usageTracker?: UsageTracker;
    polarClient?: PolarClient;
  };
}

export async function buildApp({ db, env, overrides }: BuildAppOptions) {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cookie);

  // @fastify/cors treats strings as literal matches — chrome-extension://* would
  // never match a real extension origin like chrome-extension://abcdef123456.
  // Use an origin function instead: allow any chrome-extension:// origin plus
  // any explicitly listed origins from CORS_ORIGINS.
  const explicitOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o && !o.startsWith('chrome-extension://'));

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / non-browser requests (no Origin header)
      if (!origin) return cb(null, true);
      // Any Chrome extension origin
      if (origin.startsWith('chrome-extension://')) return cb(null, true);
      // Explicitly listed origins (e.g. FRONTEND_URL in production)
      if (explicitOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: true,
  });

  await app.register(websocketPlugin);

  // ── Raw body parser for /billing/webhook (HMAC needs raw bytes) ────────────
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      // Attach raw buffer for webhook HMAC; also parse JSON for all other routes
      (req as typeof req & { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // ── Services ───────────────────────────────────────────────────────────────
  const jwtService = new JwtService(env.JWT_SECRET);
  const emailService = overrides?.emailService ?? new EmailService(env.RESEND_API_KEY);
  const magicLinkService =
    overrides?.magicLinkService ??
    new MagicLinkService(db, emailService, env.MAGIC_LINK_BASE_URL);
  const googleOAuthService =
    overrides?.googleOAuthService ??
    new GoogleOAuthService(
      db,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET ?? '',
      `${env.MAGIC_LINK_BASE_URL}/auth/google/callback`,
    );
  // Rate limit: 5 requests per email per hour
  const emailRateLimiter =
    overrides?.emailRateLimiter ?? new EmailRateLimiter(5, 60 * 60 * 1000);

  const usageTracker = overrides?.usageTracker ?? new UsageTracker(db);

  const polarClient =
    overrides?.polarClient ??
    new PolarClient({
      apiKey: env.POLAR_API_KEY ?? 'placeholder',
      productIdPro: env.POLAR_PRODUCT_ID_PRO ?? 'placeholder',
    });

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { db });

  const allowedExtensionIds = (env.ALLOWED_EXTENSION_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  await app.register(authRoutes, {
    prefix: '/auth',
    magicLinkService,
    googleOAuthService,
    jwtService,
    emailRateLimiter,
    baseUrl: env.MAGIC_LINK_BASE_URL,
    allowedExtensionIds,
    googleClientId: env.GOOGLE_CLIENT_ID,
  });

  // ── Billing routes ─────────────────────────────────────────────────────────
  await app.register(billingRoutes, {
    prefix: '/billing',
    db,
    jwtService,
    usageTracker,
    polarClient,
    webhookSecret: env.POLAR_WEBHOOK_SECRET ?? 'placeholder',
  });

  // ── WebSocket relay ────────────────────────────────────────────────────────
  await registerRelayServer(app, {
    jwtService,
    deepgramApiKey: env.DEEPGRAM_API_KEY ?? '',
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    googleCloudTtsKeyFile: env.GOOGLE_CLOUD_TTS_KEY_FILE ?? '',
    usageTracker,
  });

  return app;
}
