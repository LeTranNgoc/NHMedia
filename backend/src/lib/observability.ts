import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

export interface ObservabilityConfig {
  sentryDsn?: string;
  logtailToken?: string;
  release?: string;
  environment: string;
}

/**
 * Initialize Sentry. Call BEFORE buildApp so unhandled errors during boot are
 * captured. Idempotent — safe to call multiple times (Sentry guards itself).
 *
 * No-op when `SENTRY_DSN` is empty (dev/test envs).
 */
export function initSentry(cfg: ObservabilityConfig): void {
  if (!cfg.sentryDsn) return;

  Sentry.init({
    dsn: cfg.sentryDsn,
    environment: cfg.environment,
    release: cfg.release,
    // Sample rate trade-off: 100% for closed beta (<1k users) so we don't miss
    // anything. Bring down to 0.2-0.3 when DAU > 500 to cap costs.
    tracesSampleRate: cfg.environment === 'production' ? 1.0 : 0,
    // Strip PII at the source — Sentry's default scrubber catches headers but
    // request body / query params (where email + jwt may live) need this hook.
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
        // Wipe query + body if they contain anything resembling a token/email
        if (typeof event.request.query_string === 'string') {
          event.request.query_string = redactSecrets(event.request.query_string);
        }
        if (typeof event.request.data === 'string') {
          event.request.data = redactSecrets(event.request.data);
        }
      }
      return event;
    },
  });
}

/**
 * Wire Sentry's error capture into fastify's onError hook. Reuses the global
 * Sentry hub initialized by `initSentry`. Safe to call when Sentry is disabled.
 */
export function attachSentryErrorHandler(app: FastifyInstance): void {
  app.addHook('onError', (request, _reply, error, done) => {
    Sentry.withScope((scope) => {
      scope.setTag('route', request.routeOptions.url ?? request.url);
      scope.setTag('method', request.method);
      const userId = (request as { user?: { userId?: string } }).user?.userId;
      if (userId) scope.setUser({ id: userId });
      Sentry.captureException(error);
    });
    done();
  });
}

/**
 * Build a pino transport target descriptor. Returns Logtail (Better Stack)
 * transport when `LOGTAIL_SOURCE_TOKEN` is set, otherwise pino's default
 * stdout (suitable for `fly logs` / docker stdout collection).
 *
 * Pass the result to fastify's `{ logger: { transport: ... } }`.
 */
export function buildLoggerTransport(
  cfg: ObservabilityConfig,
): { target: string; options: Record<string, unknown> } | undefined {
  if (!cfg.logtailToken) return undefined;
  return {
    target: '@logtail/pino',
    options: {
      sourceToken: cfg.logtailToken,
      // Buffer + flush so we don't make 1 HTTP call per log line.
      options: { batchSize: 50, batchInterval: 2000 },
    },
  };
}

/** Best-effort regex scrub for tokens / emails leaking into Sentry payloads. */
function redactSecrets(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/token=[A-Za-z0-9._-]+/gi, 'token=<redacted>')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<email>');
}
