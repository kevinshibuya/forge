import { config } from 'dotenv';

/**
 * Loads `app/api/.env` into `process.env` (cwd-relative — every entry point runs
 * with cwd = app/api, the same convention migrate.ts/seed.ts already rely on).
 *
 * Call this ONLY from executable entry points (main.ts, and the script-invocation
 * paths of migrate.ts / seed.ts), BEFORE the Nest app / DB provider is built. It is
 * deliberately a function, not a top-level side effect: migrate.ts and seed.ts export
 * helpers that the vitest suite imports, and those tests set their own DATABASE_URL and
 * run against fake engines — loading a real OPENAI_API_KEY into the test process could
 * change behavior. The guard keeps env-loading on the run-as-a-program path only.
 *
 * It supplies OPENAI_API_KEY (embeddings, and the `openai` engine on the api backend) and
 * ANTHROPIC_API_KEY (the `anthropic` engine on the api backend); DATABASE_URL still falls back to
 * a code default when absent.
 */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  config();
  loaded = true;
}
