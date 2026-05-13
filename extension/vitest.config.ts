import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    setupFiles: ['src/test-setup.ts'],
    // SharedArrayBuffer requires cross-origin isolation headers.
    // In happy-dom test environment we polyfill SAB via a simple fallback buffer.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/shared/messaging-types.ts',
      ],
      thresholds: {
        statements: 25,
        branches: 70,
        functions: 60,
        lines: 25,
      },
    },
  },
});
