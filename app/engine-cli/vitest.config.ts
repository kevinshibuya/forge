import { defineConfig } from 'vitest/config';

/** Plain vitest: the process engines spawn stub children and touch no database. */
export default defineConfig({ test: { include: ['src/**/*.spec.ts'] } });
