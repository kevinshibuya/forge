import { tmpdir } from 'node:os';
import { renderPrompt, type EngineRequest, type EngineResult, type EngineUsage } from '@forge/shared';
import { ProcessEngine, scrubbedEnv } from './process-engine';

/** Replaces Claude Code's own system prompt. Forge's prompt carries the whole task in the user
 *  turn (system blocks included, see `renderPrompt`), so the CLI's needs only this much. */
export const CLI_SYSTEM_PROMPT = 'You write for forge, a content pipeline. Follow the instructions in the user turn exactly.';

/**
 * The argv for one call. Everything Claude Code would load from the operator's machine stays out:
 * MCP servers, settings files (hooks, the user CLAUDE.md), skills, and its own system prompt and
 * tool definitions. Measured on 2.1.282: 22,140 prompt tokens for a one-word answer with the CLI's
 * defaults, 405 with these flags. `--bare` would do the same in one flag, but it authenticates
 * strictly with ANTHROPIC_API_KEY, which bills the API instead of the subscription.
 *
 * Tools stay off unless the request carries images; then Read is offered and allowed, because the
 * caller's prompt lists their absolute paths. Exported so the output-contract probe runs the same
 * flags the engine does.
 */
export function claudeArgv(req: EngineRequest, prefixArgs: string[] = []): string[] {
  const tools = req.images && req.images.length > 0 ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''];
  // The output contract: the CLI enforces this shape and returns the parsed object as
  // `structured_output` on the result line. Absent for a run without a schema.
  const schema = req.outputSchema !== undefined ? ['--json-schema', JSON.stringify(req.outputSchema)] : [];
  return [
    // --verbose is REQUIRED by the real CLI when combining -p (--print) with
    // --output-format stream-json (verified against claude-sonnet-5, Step 5).
    ...prefixArgs, '-p', '--output-format', 'stream-json', '--verbose', '--model', req.model,
    // Every run: the CLI otherwise writes a full session transcript under ~/.claude/projects.
    '--no-session-persistence',
    '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
    '--system-prompt', CLI_SYSTEM_PROMPT,
    ...tools, ...schema,
  ];
}

const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Maps the stream-json `result` line's `usage` block onto EngineUsage, field by field. A missing
 * or non-finite field stays undefined; a block with no usable field is no usage at all. Fail-open:
 * usage parsing never turns a run into a failure.
 */
function parseUsage(raw: unknown): EngineUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const usage: EngineUsage = {};
  const inputTokens = count(u.input_tokens);
  const cacheWriteTokens = count(u.cache_creation_input_tokens);
  const cacheReadTokens = count(u.cache_read_input_tokens);
  const outputTokens = count(u.output_tokens);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/** `r` with `usage` attached when there is any. */
const withUsage = (r: EngineResult, usage: EngineUsage | undefined): EngineResult => (usage ? { ...r, usage } : r);

/**
 * Headless Claude Code with the argv above. The rendered prompt goes in via stdin (avoids
 * ARG_MAX). `effort` and `maxOutputTokens` are ignored: the CLI has no flag for either.
 */
export class ClaudeEngine extends ProcessEngine {
  readonly name = 'claude' as const;

  constructor(
    private readonly bin = 'claude',
    private readonly prefixArgs: string[] = [],
  ) { super(); }

  protected command(req: EngineRequest) {
    const env = scrubbedEnv();
    return {
      bin: this.bin,
      args: claudeArgv(req, this.prefixArgs),
      stdin: renderPrompt(req),
      env,
      // Run children OUTSIDE any git work tree: a repo cwd makes headless children inherit
      // user-level git-project hooks (a Stop hook blocked image_html runs 2026-07-21, replacing
      // the final result text and failing extractHtml). All file access uses absolute paths.
      cwd: req.cwd ?? tmpdir(),
    };
  }

  /** Usage rides on every path that has a result line, error paths included: the CLI billed
   *  those calls and invariant 6 records every exit. A killed child has no result line. */
  protected interpret(stdout: string, stderr: string, exitCode: number, req: EngineRequest): EngineResult {
    const resultLine = findResultLine(stdout);
    const usage = parseUsage(resultLine?.usage);
    // A result line with is_error is the CLI's own verdict and outranks the exit code: it says
    // WHAT failed (the API refused the schema, the model never produced a valid structured
    // output) where the exit code only says that something did.
    if (resultLine?.is_error === true) {
      const detail = String(resultLine.result ?? '');
      const failureKind = resultLine.subtype === 'error_max_structured_output_retries' ? 'invalid_output' : 'other';
      return withUsage({ output: detail, failureKind, errorDetail: detail }, usage);
    }
    if (exitCode !== 0) {
      // Under -p --output-format stream-json the CLI reports the human-readable failure
      // (e.g. a session-limit hit) on STDOUT and exits with empty stderr.
      const detail = (stderr.trim() || stdout.trim()).slice(-500);
      return withUsage({ output: stdout, failureKind: 'nonzero_exit', errorDetail: detail || `exit ${exitCode}` }, usage);
    }
    if (resultLine && typeof resultLine.result === 'string') {
      const base = withUsage({ output: resultLine.result }, usage);
      if (req.outputSchema === undefined) return base;
      // Observed on 2.1.261: a schema-bearing run can end on a success line with no
      // structured_output and no error at all, when the model was talked out of the tool call.
      // The contract was not honoured, so the runner must not read the prose as an answer.
      if (!Object.prototype.hasOwnProperty.call(resultLine, 'structured_output')) {
        return { ...base, failureKind: 'invalid_output', errorDetail: 'result line carries no structured_output' };
      }
      return { ...base, structured: resultLine.structured_output };
    }
    return { output: stdout, failureKind: 'invalid_output', errorDetail: 'no result line in stream-json output' };
  }
}

type ResultLine = { type: 'result'; subtype?: string; is_error?: boolean; result?: unknown; usage?: unknown; structured_output?: unknown };

/** The stream-json `result` line, or undefined when the transcript has none. Malformed lines are skipped. */
function findResultLine(stdout: string): ResultLine | undefined {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: string }).type === 'result') return parsed as ResultLine;
    } catch { /* non-JSON line, ignore */ }
  }
  return undefined;
}
