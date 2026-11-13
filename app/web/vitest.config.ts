import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Same reasoning as vite.config.ts: point at the TS source so the specs
      // exercise ESM-native shared code and never a stale `dist`. Duplicated
      // rather than imported because vite.config.ts also pulls in Tailwind,
      // which the node-side test run has no use for.
      '@forge/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
