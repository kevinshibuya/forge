import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPrompt, type EngineRequest, type EngineResult } from '@forge/shared';
import { CodexEngine } from './codex.engine';
import { ProcessEngine, type EngineEnded } from './process-engine';

const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({
  kind: 'draft', model: 'm', effort: null, maxOutputTokens: 1024, system: [], user: 'hello', timeoutMs: 5000, ...over,
});

class Scripted extends ProcessEngine {
  readonly name = 'fake' as const;
  seen: EngineEnded | undefined;
  interpreted = false;
  constructor(private readonly script: string) { super(); }
  protected command() {
    return { bin: process.execPath, args: ['-e', this.script], env: {} as Record<string, string> };
  }
  protected override endedResult(stdout: string, ended: EngineEnded): EngineResult {
    this.seen = ended;
    return super.endedResult(stdout, ended);
  }
  protected interpret(stdout: string): EngineResult {
    this.interpreted = true;
    return { output: stdout };
  }
}

describe('ProcessEngine', () => {
  it('interprets a child that ends on its own', async () => {
    const engine = new Scripted('console.log("one"); console.log("two");');
    const res = await engine.run(req());
    expect(res.failureKind).toBeUndefined();
    expect(engine.interpreted).toBe(true);
    expect(res.output).toContain('two');
  }, 10_000);

  it('ends a child at the timeout and never reads its truncated stream as the answer', async () => {
    const engine = new Scripted('setTimeout(() => {}, 10000)');
    const res = await engine.run(req({ timeoutMs: 200 }));
    expect(res.failureKind).toBe('timeout');
    expect(res.errorDetail).toBe('killed after 200ms');
    expect(engine.seen?.kind).toBe('timeout');
    expect(engine.interpreted).toBe(false);
  }, 10_000);
});

describe('CodexEngine', () => {
  it('keeps its timeout result exactly as before', async () => {
    const engine = new CodexEngine(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    const res = await engine.run(req({ timeoutMs: 200 }));
    expect(res.failureKind).toBe('timeout');
    expect(res.errorDetail).toBe('killed after 200ms');
  }, 10_000);
});

const FIXTURES = join(__dirname, '../test/fixtures');

class StubEngine extends ProcessEngine {
  readonly name = 'fake' as const;
  constructor(private readonly script: string) { super(); }
  protected command(r: EngineRequest) {
    return { bin: process.execPath, args: [join(FIXTURES, this.script)], stdin: renderPrompt(r), env: {} };
  }
  protected interpret(stdout: string, stderr: string, exitCode: number): EngineResult {
    if (exitCode !== 0) return { output: stdout, failureKind: 'nonzero_exit', errorDetail: stderr };
    return { output: stdout };
  }
}

describe('ProcessEngine with stub children', () => {
  it('pipes stdin, collects stdout, emits chunk events', async () => {
    const events: string[] = [];
    const res = await new StubEngine('stub-ok.mjs').run(req({ timeoutMs: 2000 }), (e) => events.push(e.type));
    expect(res.output).toBe('OUT:hello');
    expect(res.failureKind).toBeUndefined();
    expect(events).toContain('chunk');
  });

  it('kills on timeout and reports failureKind=timeout', async () => {
    const res = await new StubEngine('stub-slow.mjs').run(req({ timeoutMs: 300 }));
    expect(res.failureKind).toBe('timeout');
  }, 10_000);

  it('captures stderr on nonzero exit', async () => {
    const res = await new StubEngine('stub-fail.mjs').run(req({ timeoutMs: 2000 }));
    expect(res.failureKind).toBe('nonzero_exit');
    expect(res.errorDetail).toContain('quota exceeded');
  });

  it('reports spawn_error for a missing binary', async () => {
    class Broken extends StubEngine {
      protected override command(r: EngineRequest) {
        return { ...super.command(r), bin: '/nonexistent/binary' };
      }
    }
    const res = await new Broken('stub-ok.mjs').run(req({ timeoutMs: 2000 }));
    expect(res.failureKind).toBe('spawn_error');
  });
});
