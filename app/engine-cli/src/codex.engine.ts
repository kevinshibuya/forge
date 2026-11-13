import { renderPrompt, type EngineEvent, type EngineRequest, type EngineResult, type EngineUsage } from '@forge/shared';
import { ProcessEngine, scrubbedEnv } from './process-engine';

const QUOTA_PATTERNS = /usage limit|rate limit|quota|plan limit/i;

/** codex reports a single total ("tokens used: 12,345"), not an in/out split. */
const TOKENS_USED = /tokens used:?\s*([\d,]+)/i;

/** The session total, filed under `outputTokens` by convention. It is a session total, not a count
 *  of image output (R12's correction), and the image count is the runner's to report, not ours. */
function sessionTotal(text: string): EngineUsage | undefined {
  const match = TOKENS_USED.exec(text);
  const total = match?.[1] ? Number(match[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(total) ? { outputTokens: total } : undefined;
}

/**
 * Headless Codex CLI (image generation via gpt-image-2).
 * BILLING SAFETY: OPENAI_API_KEY is stripped from the child env — setting it
 * would silently switch billing from the ChatGPT subscription to the metered API.
 */
export class CodexEngine extends ProcessEngine {
  readonly name = 'codex' as const;

  constructor(
    private readonly bin = 'codex',
    private readonly prefixArgs: string[] = ['exec', '--sandbox', 'workspace-write'],
    private readonly extraEnv: Record<string, string> = {},
  ) { super(); }

  /** No codex kind carries an output schema and codex's `--output-schema` is not wired here (ADR
   *  0016). Refusing is what keeps a schema-bearing kind from ever running unenforced. */
  override run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    if (req.outputSchema !== undefined) {
      return Promise.resolve({ output: '', failureKind: 'other', errorDetail: 'codex engine has no output contract' });
    }
    return super.run(req, onEvent);
  }

  protected command(req: EngineRequest) {
    const env = scrubbedEnv(this.extraEnv);
    // Attached form (-i=path) is required: codex's variadic `-i <FILE>...` greedily consumes the
    // following positional prompt as another image path, then falls back to reading stdin (which
    // ProcessEngine closes) -> "No prompt provided via stdin". Live-verified 2026-07-19.
    const imageArgs = (req.images ?? []).map((p) => `-i=${p}`);
    return { bin: this.bin, args: [...this.prefixArgs, ...imageArgs, renderPrompt(req)], env };
  }

  /** The session total rides on every path it appears on: success, quota, non-zero exit. */
  protected interpret(stdout: string, stderr: string, exitCode: number): EngineResult {
    const combined = `${stdout}\n${stderr}`;
    const usage = sessionTotal(combined);
    const result = (r: EngineResult): EngineResult => (usage ? { ...r, usage } : r);
    if (QUOTA_PATTERNS.test(combined) && exitCode !== 0) {
      return result({ output: stdout, failureKind: 'quota', errorDetail: stderr || stdout });
    }
    if (exitCode !== 0) {
      return result({ output: stdout, failureKind: 'nonzero_exit', errorDetail: stderr || `exit ${exitCode}` });
    }
    return result({ output: stdout });
  }
}
