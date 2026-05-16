import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { connectMongo, closeMongo } from './db/mongo-client.js';
import { buildApp } from './app.js';
import { UsageTracker } from './lib/usage-tracker.js';
import { initSentry } from './lib/observability.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const env = loadEnv();

  // Init Sentry BEFORE anything else so boot-time errors are captured.
  initSentry({
    sentryDsn: env.SENTRY_DSN,
    logtailToken: env.LOGTAIL_SOURCE_TOKEN,
    release: env.APP_RELEASE,
    environment: env.NODE_ENV,
  });

  const db = await connectMongo(env.MONGO_URI);

  // UsageTracker created here so the shutdown handler can stop its interval.
  // Pass env-derived limits explicitly — buildApp's fallback path is only used
  // when no override is supplied, so prod must wire limits at construction.
  const usageTracker = new UsageTracker(db, {
    seconds: env.FREE_TIER_LIMIT_SECONDS,
    translateChars: env.FREE_TIER_LIMIT_TRANSLATE_CHARS,
    ttsChars: env.FREE_TIER_LIMIT_TTS_CHARS,
  });

  const app = await buildApp({ db, env, overrides: { usageTracker } });

  // ── Start background flush now that the app is ready ──────────────────────
  usageTracker.startFlushInterval();
  console.log('[main] usage flush interval started');

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[main] ${signal} received — shutting down`);

    const forceTimer = setTimeout(() => {
      console.error('[main] shutdown timeout — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref(); // Don't keep the event loop alive for the timer alone

    try {
      // 1. Stop accepting new WS connections / HTTP requests
      console.log('[main] closing app...');
      await app.close();

      // 2. Stop interval and flush pending usage to DB one last time
      console.log('[main] flushing usage tracker...');
      usageTracker.stopFlushInterval();
      await usageTracker.flush();

      // 3. Close MongoDB connection pool
      console.log('[main] closing MongoDB...');
      await closeMongo();

      clearTimeout(forceTimer);
      console.log('[main] shutdown complete');
      process.exit(0);
    } catch (err: unknown) {
      console.error('[main] error during shutdown:', err instanceof Error ? err.message : err);
      clearTimeout(forceTimer);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`backend listening on port ${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
