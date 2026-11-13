import { extractJson } from '@forge/shared';
import type { Engine, EngineEvent, EngineRequest, EngineResult, EngineUsage } from './engine.interface';

/** Deterministic engine for tests and offline dev: echoes a canned response per kind. */
export class FakeEngine implements Engine {
  readonly name = 'fake' as const;
  constructor(
    private readonly responses: Partial<Record<EngineRequest['kind'], string>> = {},
    /** Optional canned token usage, returned on every run (step/usage recording tests). */
    private readonly usage?: EngineUsage,
  ) {}

  async run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    const output = this.responses[req.kind] ?? `fake:${req.kind}`;
    onEvent?.({ type: 'chunk', data: output });
    const structured = structuredFrom(output);
    return {
      output,
      ...(structured !== undefined ? { structured } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}

/** What the real CLI would have put in `structured_output` for this canned response: the JSON it
 *  holds, wrapped as `{ result }` unless the fixture already is the wrapper. A bare-payload fixture
 *  therefore keeps working under the runner's strict rule; a non-JSON fixture yields none.
 *  Exported for the hand-rolled engine doubles in the specs, which return the same shape. */
export function structuredFrom(output: string): unknown {
  let parsed: unknown;
  try { parsed = extractJson(output); } catch { return undefined; }
  if (typeof parsed === 'object' && parsed !== null && Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed;
  return { result: parsed };
}
