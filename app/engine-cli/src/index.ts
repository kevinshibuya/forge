import { ClaudeEngine } from './claude.engine';
import { CodexEngine } from './codex.engine';

export { CLI_SYSTEM_PROMPT, ClaudeEngine, claudeArgv } from './claude.engine';
export { CodexEngine } from './codex.engine';
export { ProcessEngine, type EngineEnded } from './process-engine';

/** The cli backend's engines, on Kevin's subscriptions. Only the dev entry installs them; the
 *  production api never imports this workspace (invariant 9). */
export function cliEngines(): { claude: ClaudeEngine; codex: CodexEngine } {
  return { claude: new ClaudeEngine(), codex: new CodexEngine() };
}
