import type { OutputJsonSchema } from './contract';
import type { FailureKind, RunKind } from './runs';

/** Engine v2: the one seam every model call runs through (ADR 0019). The backend is chosen by the
 *  process entry file, never by a request; the registry row names the engine. */
export type EngineBackend = 'api' | 'cli';
export type EngineName = 'claude' | 'codex' | 'anthropic' | 'openai' | 'google' | 'fake';

/** One system block. `cache: true` puts a cache breakpoint after it (api engines); cli ignores it. */
export interface SystemBlock { text: string; cache?: boolean }

export interface EngineRequest {
  kind: RunKind;
  model: string;
  /** From the registry row. Null means "send no effort". Ignored by cli. */
  effort: string | null;
  /** From the registry row. Anthropic max_tokens, OpenAI max_output_tokens. Ignored by cli. */
  maxOutputTokens: number;
  system: SystemBlock[];
  user: string;
  /** Absolute paths in slice 2 (storage keys from slice 7). cli claude: Read is allowed and the prompt
   *  already lists them; cli codex: `-i=`; api: refused until slice 10. Never base64 in prompt text. */
  images?: string[];
  outputSchema?: OutputJsonSchema;
  timeoutMs: number;
  /** cli only: the codex image steps write files here. Api engines ignore it. */
  cwd?: string;
}

export interface EngineUsage {
  /** Uncached input. */
  inputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  /** Set by the runner, not the engine: an engine reports tokens, the runner knows what an image
   *  call produced. */
  images?: number;
}

export interface EngineResult {
  output: string;
  structured?: unknown;
  failureKind?: FailureKind;
  errorDetail?: string;
  /** Whatever the provider reported, on every exit path, including a timeout that arrived after
   *  message_start and a cli result line that carries is_error. Absent means the provider reported
   *  nothing, never zero. */
  usage?: EngineUsage;
  providerRequestId?: string;
  /** Set by an api engine on a 429 with retry-after or a 529/503. The runner retries once. */
  retryable?: { afterMs: number };
}

export type EngineEvent = { type: 'chunk' | 'stderr'; data: string };

export interface Engine {
  readonly name: EngineName;
  run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult>;
}

/** The audit text (runs.prompt) and the cli stdin: system texts then the user turn, joined by one
 *  blank line. Byte-identical to the pre-slice prompt strings for every builder. */
export function renderPrompt(req: Pick<EngineRequest, 'system' | 'user'>): string {
  return [...req.system.map((b) => b.text), req.user].join('\n\n');
}
