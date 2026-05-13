import { describe, it, expect } from 'vitest';
import { loadEnv } from '../config/env.js';

const BASE_ENV = {
  MONGO_URI: 'mongodb://localhost:27017',
  JWT_SECRET: 'a'.repeat(32),
  RESEND_API_KEY: 'resend_test',
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  MAGIC_LINK_BASE_URL: 'http://localhost:3000',
  NODE_ENV: 'development',
};

const PROD_SECRETS = {
  DEEPGRAM_API_KEY: 'dg_real_key_1234567890abcdef',
  GEMINI_API_KEY: 'gemini_real_key',
  POLAR_API_KEY: 'polar_real_key',
  POLAR_WEBHOOK_SECRET: 'a'.repeat(32),
  POLAR_PRODUCT_ID_PRO: 'prod_real_123',
};

describe('loadEnv — development', () => {
  it('parses successfully with all required vars', () => {
    const env = loadEnv({ ...BASE_ENV });
    expect(env.NODE_ENV).toBe('development');
  });

  it('DEEPGRAM_API_KEY defaults to empty string when not set', () => {
    const env = loadEnv({ ...BASE_ENV });
    expect(env.DEEPGRAM_API_KEY).toBe('');
  });

  it('allows empty secrets in development', () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, NODE_ENV: 'development', DEEPGRAM_API_KEY: '' }),
    ).not.toThrow();
  });

  it('allows placeholder secrets in development', () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, NODE_ENV: 'development', POLAR_WEBHOOK_SECRET: 'placeholder' }),
    ).not.toThrow();
  });
});

describe('loadEnv — production fail-fast', () => {
  it('throws when DEEPGRAM_API_KEY is empty in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        DEEPGRAM_API_KEY: '',
      }),
    ).toThrow(/DEEPGRAM_API_KEY/);
  });

  it('throws when DEEPGRAM_API_KEY is placeholder in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        DEEPGRAM_API_KEY: 'placeholder',
      }),
    ).toThrow(/DEEPGRAM_API_KEY/);
  });

  it('throws when POLAR_WEBHOOK_SECRET is empty in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        POLAR_WEBHOOK_SECRET: '',
      }),
    ).toThrow(/POLAR_WEBHOOK_SECRET/);
  });

  it('throws when POLAR_WEBHOOK_SECRET is placeholder in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        POLAR_WEBHOOK_SECRET: 'placeholder',
      }),
    ).toThrow(/POLAR_WEBHOOK_SECRET/);
  });

  it('throws when POLAR_WEBHOOK_SECRET is shorter than 32 chars in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        POLAR_WEBHOOK_SECRET: 'tooshort',
      }),
    ).toThrow(/POLAR_WEBHOOK_SECRET/);
  });

  it('throws when POLAR_API_KEY is empty in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        POLAR_API_KEY: '',
      }),
    ).toThrow(/POLAR_API_KEY/);
  });

  it('succeeds with all real secrets in production', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  it('reports multiple missing secrets in one throw', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        DEEPGRAM_API_KEY: '',
        GEMINI_API_KEY: '',
        POLAR_API_KEY: '',
        POLAR_WEBHOOK_SECRET: '',
        POLAR_PRODUCT_ID_PRO: '',
      }),
    ).toThrow(/Production secrets/);
  });
});
