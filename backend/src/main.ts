import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve .env from the monorepo root, not cwd. Without this, running
// `pnpm -F backend dev` loads `backend/.env` (stale copy) instead of the
// canonical root `.env`. Symptom: env vars present in root .env appear empty
// in process.env, chain falls back to whichever provider's key happens to be
// in backend/.env. Same loader runs in prod (`backend/dist/...`) → resolves to
// `<project>/.env` from `<project>/backend/dist/main.js` two levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');
const dotenvResult = loadDotenv({ path: envPath });
console.log(
  `[main] dotenv: path=${envPath} ${
    dotenvResult.error ? `error=${dotenvResult.error.message}` : 'loaded'
  }`,
);

import { loadEnv } from './config/env.js';
import { connectMongo, closeMongo } from './db/mongo-client.js';
import { buildApp } from './app.js';
import { UsageTracker } from './lib/usage-tracker.js';
import { initSentry } from './lib/observability.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const env = loadEnv();

  // Boot-time env audit — surface key presence without leaking values, so
  // misconfig like "GROQ_API_KEY in .env but backend didnt restart" is obvious.
  const keyStatus = (k: string): string => (k && k !== 'placeholder' ? 'set' : 'EMPTY');
  console.log(
    `[main] env: TRANSLATE_PROVIDER=${env.TRANSLATE_PROVIDER} ` +
      `GROQ=${keyStatus(env.GROQ_API_KEY)} ` +
      `GEMINI=${keyStatus(env.GEMINI_API_KEY)} ` +
      `AZURE_TRANSLATOR=${keyStatus(env.AZURE_TRANSLATOR_KEY)} ` +
      `DEEPGRAM=${keyStatus(env.DEEPGRAM_API_KEY)} ` +
      `INTERIM_DEBOUNCE_MS=${process.env['INTERIM_DEBOUNCE_MS'] ?? '(default)'} ` +
      `BACKEND_TTS_DISABLED=${env.BACKEND_TTS_DISABLED} ` +
      `LIMITS=[sec=${env.FREE_TIER_LIMIT_SECONDS} ` +
      `translate=${env.FREE_TIER_LIMIT_TRANSLATE_CHARS} ` +
      `tts=${env.FREE_TIER_LIMIT_TTS_CHARS}]`,
  );

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
