import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineRequest } from '@forge/shared';
import { CLI_SYSTEM_PROMPT, ClaudeEngine, claudeArgv } from './claude.engine';
import { CodexEngine } from './codex.engine';

const FIXTURES = join(__dirname, '../test/fixtures');

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({
  kind: 'draft', model: 'claude-opus-4-8', effort: null, maxOutputTokens: 1024,
  system: [], user: 'write a post', timeoutMs: 5000, ...over,
});

describe('ClaudeEngine', () => {
  // Absolute stub path: ClaudeEngine children now run from tmpdir (outside any git work tree),
  // so this test also exercises the non-repo default cwd.
  const engine = new ClaudeEngine(process.execPath, [join(FIXTURES, 'stub-claude.mjs')]);

  it('extracts the result payload from stream-json', async () => {
    const res = await engine.run(req());
    expect(res.failureKind).toBeUndefined();
    expect(JSON.parse(res.output)).toEqual({ echo: 'write a post' });
  });

  it('pipes the rendered prompt, system blocks first, on stdin', async () => {
    const res = await engine.run(req({ system: [{ text: 'constitution', cache: true }], user: 'the idea' }));
    expect(JSON.parse(res.output)).toEqual({ echo: 'constitution\n\nthe idea' });
  });
});

describe('CodexEngine', () => {
  it('never passes a provider key or the database url to the child', async () => {
    const scrubbed = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DATABASE_URL'];
    for (const name of scrubbed) process.env[name] = 'should-not-leak';
    const engine = new CodexEngine(process.execPath, [join(FIXTURES, 'stub-codex.mjs')]);
    const res = await engine.run(req({ kind: 'image_gen', model: 'gpt-image-2' }));
    for (const name of scrubbed) delete process.env[name];
    expect(res.errorDetail ?? '').not.toContain('LEAKED_ENV');
    expect(res.failureKind).toBeUndefined();
    expect(res.output).toContain('Generated 4 images');
  });

  it('classifies plan-limit errors as quota', async () => {
    const engine = new CodexEngine(process.execPath, [join(FIXTURES, 'stub-codex.mjs')], { STUB_MODE: 'quota' });
    const res = await engine.run(req({ kind: 'image_gen', model: 'gpt-image-2' }));
    expect(res.failureKind).toBe('quota');
    expect(res.errorDetail).toContain('usage limit');
  });

  it('refuses a schema-bearing request without spawning, so no kind runs unenforced on codex', async () => {
    // A binary that cannot exist: had the engine spawned, this would be spawn_error, not other.
    const engine = new CodexEngine('/nonexistent/codex-must-not-spawn', []);
    const res = await engine.run(req({ kind: 'image_gen', model: 'gpt-image-2', outputSchema: { type: 'object' } }));
    expect(res.failureKind).toBe('other');
    expect(res.errorDetail).toBe('codex engine has no output contract');
    expect(res.output).toBe('');
  });
});

// Probe subclass to inspect the argv ClaudeEngine builds (command is protected).
class ProbeClaude extends ClaudeEngine {
  argv(request: EngineRequest): string[] { return this.command(request).args; }
  outcome(stdout: string, stderr: string, exitCode: number) { return this.interpret(stdout, stderr, exitCode, req()); }
}

describe('ClaudeEngine failure detail', () => {
  const probe = new ProbeClaude();

  it('surfaces the stdout tail when the CLI dies with empty stderr (session-limit case)', () => {
    const res = probe.outcome("You've hit your session limit · resets 7am (America/Sao_Paulo)", '', 1);
    expect(res.failureKind).toBe('nonzero_exit');
    expect(res.errorDetail).toContain('session limit');
  });

  it('falls back to the exit code when both streams are empty', () => {
    const res = probe.outcome('', '', 1);
    expect(res.failureKind).toBe('nonzero_exit');
    expect(res.errorDetail).toBe('exit 1');
  });
});

describe('ClaudeEngine argv: the forge prompt and nothing of the operator setup', () => {
  const probe = new ProbeClaude();
  const base = req({ kind: 'image_review', timeoutMs: 1000 });
  /** The value that follows `flag`, or undefined when the flag is absent. */
  const valueOf = (argv: string[], flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  it('loads no MCP server, no settings source, no skill, and replaces the system prompt', () => {
    const argv = probe.argv(base);
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--disable-slash-commands');
    expect(valueOf(argv, '--setting-sources')).toBe('');
    expect(valueOf(argv, '--system-prompt')).toBe(CLI_SYSTEM_PROMPT);
    expect(argv).not.toContain('--bare'); // --bare authenticates with ANTHROPIC_API_KEY only
  });

  it('offers no tool without images (tools-disabled invariant)', () => {
    for (const r of [base, { ...base, images: [] }]) {
      const argv = probe.argv(r);
      expect(valueOf(argv, '--tools')).toBe('');
      expect(argv).not.toContain('--allowedTools');
    }
  });

  it('offers and allows Read, and only Read, when the request carries images', () => {
    const argv = probe.argv({ ...base, images: ['/abs/candidate-1.png'] });
    expect(valueOf(argv, '--tools')).toBe('Read');
    expect(valueOf(argv, '--allowedTools')).toBe('Read');
  });

  it('command() and the exported claudeArgv agree, so the probe script proves the engine\'s flags', () => {
    expect(probe.argv(base)).toEqual(claudeArgv(base));
  });
});

// Probe subclass to inspect the argv CodexEngine builds (command is protected).
class ProbeCodex extends CodexEngine {
  argv(request: EngineRequest): string[] { return this.command(request).args; }
  outcome(stdout: string, stderr: string, exitCode: number) { return this.interpret(stdout, stderr, exitCode); }
}

describe('CodexEngine reference images', () => {
  const probe = new ProbeCodex();

  it('appends -i=<path> per image before the prompt (attached form — space-separated `-i FILE` lets the variadic flag swallow the prompt and codex falls back to stdin)', () => {
    const args = probe.argv(req({ kind: 'image_gen', model: 'gpt-image-2', user: 'paint', images: ['/a/bg.png', '/b/bg.png'] }));
    expect(args).toEqual(['exec', '--sandbox', 'workspace-write', '-i=/a/bg.png', '-i=/b/bg.png', 'paint']);
  });

  it('omits -i entirely when images is absent', () => {
    const args = probe.argv(req({ kind: 'image_gen', model: 'gpt-image-2', user: 'paint' }));
    expect(args).toEqual(['exec', '--sandbox', 'workspace-write', 'paint']);
  });
});

describe('F2 usage capture', () => {
  const probe = new ProbeClaude();

  it('claude: parses usage from the stream-json result line', () => {
    const line = JSON.stringify({ type: 'result', result: 'hello', usage: { input_tokens: 1200, output_tokens: 340 } });
    const res = probe.outcome(`${line}\n`, '', 0);
    expect(res.output).toBe('hello');
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it('claude: absent or malformed usage stays undefined and does not fail the run', () => {
    const noUsage = JSON.stringify({ type: 'result', result: 'hello' });
    expect(probe.outcome(`${noUsage}\n`, '', 0).usage).toBeUndefined();
    const badUsage = JSON.stringify({ type: 'result', result: 'hello', usage: { input_tokens: 'NaNsense' } });
    const res = probe.outcome(`${badUsage}\n`, '', 0);
    expect(res.failureKind).toBeUndefined();
    expect(res.output).toBe('hello');
  });

  it('claude: the two cache fields land as cacheWriteTokens and cacheReadTokens', () => {
    const line = JSON.stringify({ type: 'result', result: 'hello', usage: {
      input_tokens: 12, cache_creation_input_tokens: 2048, cache_read_input_tokens: 4096, output_tokens: 340,
    } });
    expect(probe.outcome(`${line}\n`, '', 0).usage).toEqual({
      inputTokens: 12, cacheWriteTokens: 2048, cacheReadTokens: 4096, outputTokens: 340,
    });
  });

  it('claude: a structured-output give-up is invalid_output and still carries its usage', () => {
    const line = JSON.stringify({
      type: 'result', subtype: 'error_max_structured_output_retries', is_error: true,
      result: 'Reached max structured output retries', usage: { input_tokens: 900, output_tokens: 1200 },
    });
    const res = probe.outcome(`${line}\n`, '', 1);
    expect(res.failureKind).toBe('invalid_output');
    expect(res.usage).toEqual({ inputTokens: 900, outputTokens: 1200 });
  });

  it('claude: a non-zero exit with a result line is nonzero_exit and still carries its usage', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'partial', usage: { input_tokens: 70, output_tokens: 5 } });
    const res = probe.outcome(`${line}\n`, '', 1);
    expect(res.failureKind).toBe('nonzero_exit');
    expect(res.usage).toEqual({ inputTokens: 70, outputTokens: 5 });
  });

  it('codex: a quota exit still reports the session total it printed', () => {
    const probeC = new ProbeCodex();
    const res = probeC.outcome('worked a while\ntokens used: 1,234\n', "You've hit your usage limit.", 1);
    expect(res.failureKind).toBe('quota');
    expect(res.usage).toEqual({ outputTokens: 1234 });
  });

  it('codex: best-effort total from "tokens used", comma-tolerant', () => {
    const probeC = new ProbeCodex();
    expect(probeC.outcome('did stuff\ntokens used: 12,345\n', '', 0).usage).toEqual({ outputTokens: 12345 });
    expect(probeC.outcome('no counts here', '', 0).usage).toBeUndefined();
  });
});
