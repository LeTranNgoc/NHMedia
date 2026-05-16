import * as Sentry from '@sentry/browser';

/**
 * Initialize Sentry in the current extension context (SW / offscreen / popup).
 *
 * No-op when `WXT_SENTRY_DSN` is empty (dev default). Build-time inlined by
 * WXT via `import.meta.env` — does not require runtime config fetch.
 *
 * Each entrypoint (background.ts, offscreen/index.ts, popup main) should
 * call this once at module top so unhandled errors are captured before
 * any business logic runs.
 */
export function initSentry(context: 'sw' | 'offscreen' | 'popup' | 'content'): void {
  const dsn =
    (typeof import.meta.env !== 'undefined' &&
      (import.meta.env['WXT_SENTRY_DSN'] as string | undefined)) ||
    '';
  if (!dsn) return;

  const release =
    (typeof import.meta.env !== 'undefined' &&
      (import.meta.env['WXT_APP_RELEASE'] as string | undefined)) ||
    undefined;

  Sentry.init({
    dsn,
    release,
    environment: import.meta.env.MODE === 'production' ? 'production' : 'development',
    // No Sentry replays / session tracking — extension users are sensitive
    // about browser surveillance. Errors only.
    integrations: [],
    tracesSampleRate: 0,
    beforeSend(event) {
      // Tag every event with the entrypoint so we can split errors by surface.
      event.tags = { ...(event.tags ?? {}), surface: context };
      // Strip URL query strings (may contain JWT in the magic-link bridge URL).
      if (event.request?.url) {
        event.request.url = event.request.url.split('?')[0];
      }
      return event;
    },
  });
}

/** Capture an error manually (use sparingly — global handler covers most). */
export function captureError(err: unknown, hint?: Record<string, unknown>): void {
  if (err instanceof Error) {
    Sentry.captureException(err, { extra: hint });
  } else {
    Sentry.captureMessage(String(err), 'error');
  }
}
