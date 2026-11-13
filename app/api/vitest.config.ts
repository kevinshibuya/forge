import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // Integration specs share one forge_test database; serialize test FILES to remove the cross-file race (negligible cost at this suite size).
  test: { include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], hookTimeout: 30000, fileParallelism: false, setupFiles: ['test/setup-assets.ts'] },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
