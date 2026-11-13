import type { EngineName } from '../engine.interface';

/** The environment variable each api engine needs. A missing key means no engine (`apiEngines`),
 *  and the runner's refusal names the key when a registry row asks for that engine. Kept apart from
 *  `index.ts` so the runner can name a key without loading the provider SDKs. */
export const API_ENGINE_KEYS: Partial<Record<EngineName, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};
