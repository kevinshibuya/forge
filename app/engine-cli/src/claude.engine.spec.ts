import { describe, expect, it } from 'vitest';
import { ClaudeEngine } from './claude.engine';
import type { EngineRequest, EngineResult } from '@forge/shared';

const resultLine = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: text, ...extra,
});

const BASE: EngineRequest = { kind: 'draft', model: 'm', effort: null, maxOutputTokens: 1024, system: [], user: 'p', timeoutMs: 1 };

/** The protected surface, reached without casting through any. */
class Probe extends ClaudeEngine {
  cmd(req: EngineRequest) { return this.command(req); }
  read(stdout: string, stderr: string, exitCode: number, req?: EngineRequest): EngineResult {
    return this.interpret(stdout, stderr, exitCode, req ?? BASE);
  }
}

describe('ClaudeEngine', () => {
  const engine = new Probe();

  it('never persists a session, so no transcript of a run outlives it', () => {
    // The CLI otherwise writes one directory per run under ~/.claude/projects holding the prompt.
    expect(engine.cmd(BASE).args)
      .toContain('--no-session-persistence');
  });

  it('keeps the operator secrets out of the child environment', () => {
    process.env.OPENAI_API_KEY = 'sk-must-not-reach-the-child';
    process.env.DATABASE_URL = 'postgres://user:pw@host/db';
    // A CLI that honoured this would bill the metered API instead of the subscription.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-must-not-reach-the-child';
    try {
      const env = engine.cmd(BASE).env;
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.PATH).toBeDefined();
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.DATABASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

/**
 * The output contract. Shapes below were observed by scripts/probe-output-contract.mjs on CLI
 * 2.1.261: the structured result rides on the success result line as `structured_output`, the CLI
 * fulfils the schema through its own `StructuredOutput` tool call, and a success line can arrive
 * with NO `structured_output` at all when the model was talked out of the tool.
 */
describe('ClaudeEngine output contract', () => {
  const engine = new Probe();
  const schema = { type: 'object', properties: { result: { oneOf: [] } }, required: ['result'], additionalProperties: false };
  const withSchema: EngineRequest = { ...BASE, outputSchema: schema };
  const payload = { result: { body_linkedin: 'b', hashtags: [] } };

  it('passes --json-schema only when the request carries a schema', () => {
    const args = engine.cmd(withSchema).args;
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(engine.cmd(BASE).args).not.toContain('--json-schema');
  });

  it('returns structured_output as structured, with the result string as output', () => {
    const res = engine.read(resultLine(JSON.stringify(payload), { structured_output: payload }), '', 0, withSchema);
    expect(res.failureKind).toBeUndefined();
    expect(res.structured).toEqual(payload);
    expect(res.output).toBe(JSON.stringify(payload));
  });

  it('classifies the CLI giving up on the schema as invalid_output, any other is_error as other', () => {
    const gaveUp = resultLine('Reached max structured output retries', { subtype: 'error_max_structured_output_retries', is_error: true });
    const res = engine.read(gaveUp, '', 1, withSchema);
    expect(res.failureKind).toBe('invalid_output');
    expect(res.errorDetail).toBe('Reached max structured output retries');

    const apiError = resultLine('API Error: 400 something', { is_error: true });
    const other = engine.read(apiError, '', 1, withSchema);
    expect(other.failureKind).toBe('other');
    expect(other.errorDetail).toBe('API Error: 400 something');
  });

  it('treats a success line with no structured_output as invalid_output when a schema was requested', () => {
    const prose = resultLine('two sentences of plain prose.');
    const res = engine.read(prose, '', 0, withSchema);
    expect(res.failureKind).toBe('invalid_output');
    expect(res.errorDetail).toBe('result line carries no structured_output');
    expect(res.output).toBe('two sentences of plain prose.');
    // Without a schema the same line is a plain success, as before.
    expect(engine.read(prose, '', 0).failureKind).toBeUndefined();
  });
});
