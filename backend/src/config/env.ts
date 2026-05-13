import { z } from 'zod';

const envSchema = z.object({
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  MAGIC_LINK_BASE_URL: z.string().url('MAGIC_LINK_BASE_URL must be a valid URL'),
  /** Comma-separated Chrome extension IDs allowed to use OAuth/magic-link bridge.
   *  Empty in dev = allow any extension (dev mode). */
  ALLOWED_EXTENSION_IDS: z.string().optional().default(''),
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((v) => parseInt(v, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default('chrome-extension://*'),
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  GOOGLE_CLOUD_TTS_KEY_FILE: z.string().optional().default(''),
  POLAR_API_KEY: z.string().optional().default(''),
  POLAR_WEBHOOK_SECRET: z.string().optional().default(''),
  POLAR_PRODUCT_ID_PRO: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

/** Secrets that must be real (non-empty, non-placeholder) in production. */
const PRODUCTION_REQUIRED_SECRETS: Array<keyof Env> = [
  'DEEPGRAM_API_KEY',
  'GEMINI_API_KEY',
  'POLAR_API_KEY',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_PRODUCT_ID_PRO',
];

/**
 * Validate and parse environment variables. Throws if any required var is missing/invalid.
 * In production, also throws if any secret is empty or equals 'placeholder'.
 * Call once at startup — result is safe to pass around without re-reading process.env.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  const env = result.data;

  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];

    for (const key of PRODUCTION_REQUIRED_SECRETS) {
      const val = env[key] as string;
      if (!val || val === 'placeholder') {
        problems.push(`  ${key}: must be set to a real value in production (got '${val}')`);
      }
    }

    // POLAR_WEBHOOK_SECRET must be at least 32 chars to resist brute-force
    if (env.POLAR_WEBHOOK_SECRET && env.POLAR_WEBHOOK_SECRET !== 'placeholder' && env.POLAR_WEBHOOK_SECRET.length < 32) {
      problems.push(`  POLAR_WEBHOOK_SECRET: must be at least 32 characters in production (got ${env.POLAR_WEBHOOK_SECRET.length})`);
    }

    if (problems.length > 0) {
      throw new Error(`Production secrets validation failed:\n${problems.join('\n')}`);
    }
  }

  return env;
}
