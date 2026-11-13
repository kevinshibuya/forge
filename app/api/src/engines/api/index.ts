import type { Engine, EngineName } from '../engine.interface';
import { AnthropicEngine } from './anthropic.engine';
import { OpenAiEngine } from './openai.engine';

/** The `api` backend's engines, one per provider key present in `env`. */
export function apiEngines(env: NodeJS.ProcessEnv = process.env): Partial<Record<EngineName, Engine>> {
  const engines: Partial<Record<EngineName, Engine>> = {};
  if (env.ANTHROPIC_API_KEY) engines.anthropic = new AnthropicEngine({ apiKey: env.ANTHROPIC_API_KEY });
  if (env.OPENAI_API_KEY) engines.openai = new OpenAiEngine({ apiKey: env.OPENAI_API_KEY });
  return engines;
}
