import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The workspace package ships CJS (`dist/index.js`) for the Node-based api.
      // Vite doesn't prebundle linked workspace packages by default, so the browser
      // would receive raw CJS whose named exports can't be statically resolved,
      // breaking the SPA mount. Point the web build straight at the TS source
      // instead — it's ESM-native and its only dependency (zod) is already hoisted
      // to the workspace root, so this also sidesteps stale-dist staleness entirely.
      '@forge/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
});
