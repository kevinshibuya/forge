import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { SettingsModule } from '../src/settings/settings.module';
import { RunnerModule } from '../src/runner/runner.module';
import { RunnerService } from '../src/runner/runner.service';
import { extractJson } from '../src/runner/runner.service';
import { ENGINE_BACKEND, ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { RunEventsHub } from '../src/runner/run-events.hub';
import type { EngineEvent, Engine, EngineRequest, EngineResult } from '../src/engines/engine.interface';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('extractJson', () => {
  it('parses fenced and prose-wrapped JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('RunEventsHub', () => {
  it('stream() for an unknown id completes immediately with zero events', async () => {
    const hub = new RunEventsHub();
    const seen: EngineEvent[] = [];
    let completed = false;
    await new Promise<void>((resolve) => {
      hub.stream(999).subscribe({
        next: (e) => seen.push(e),
        complete: () => { completed = true; resolve(); },
      });
    });
    expect(seen).toEqual([]);
    expect(completed).toBe(true);
  });

  it('open() then emit() replays the event to a late-but-within-retention subscriber', () => {
    const hub = new RunEventsHub();
    hub.open(1);
    hub.emit(1, { type: 'chunk', data: 'hello' });
    const seen: EngineEvent[] = [];
    hub.stream(1).subscribe((e) => seen.push(e));
    expect(seen).toEqual([{ type: 'chunk', data: 'hello' }]);
  });
});

describe('RunnerService', () => {
  let runner: RunnerService;
  let runsSvc: RunsService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, RunsModule, RunnerModule],
    })
      .overrideProvider(ENGINES)
      .useValue({
        claude: new FakeEngine({
          triage: '{"source":"work","suggested_tier":"T2","news_expiry_days":null,"notes":"n"}',
          draft: 'not json at all',
        }),
        codex: new FakeEngine({ image_gen: 'Generated 4 images' }),
      })
      .compile();
    runner = mod.get(RunnerService);
    runsSvc = mod.get(RunsService);
  });

  it('happy path: validates schema, persists succeeded run', async () => {
    const schema = z.object({ source: z.string(), suggested_tier: z.string(), news_expiry_days: z.number().nullable(), notes: z.string() });
    const res = await runner.execute({ kind: 'triage', system: [], user: 'triage this', schema });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.suggested_tier).toBe('T2');
    const run = await runsSvc.get(res.runId);
    expect(run.status).toBe('succeeded');
    expect(run.parsedOk).toBe(true);
    expect(run.model).toBe('claude-sonnet-5'); // the cli triage row
  });

  it('invalid output is a value, not an exception', async () => {
    const res = await runner.execute({ kind: 'draft', tier: 'T1', system: [], user: 'draft it', schema: z.object({ hooks: z.array(z.string()) }) });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failureKind).toBe('invalid_output');
      expect(res.rawOutput).toContain('not json');
    }
    const run = await runsSvc.get(res.runId);
    expect(run.status).toBe('failed');
    expect(run.model).toBe('claude-opus-4-8'); // draft_t1 default
  });

  it('routes image_gen to the codex engine and skips schema when none given', async () => {
    const res = await runner.execute({ kind: 'image_gen', system: [], user: 'make images' });
    expect(res.ok).toBe(true);
    const run = await runsSvc.get(res.runId);
    expect(run.engine).toBe('codex');
  });

  it('onStart fires with the runId before completion', async () => {
    const seen: number[] = [];
    const res = await runner.execute({ kind: 'image_gen', system: [], user: 'p', onStart: (id) => seen.push(id) });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([res.runId]);
  });

  it('closes the SSE stream only after the run row is terminal (never mid-running)', async () => {
    // A gated engine lets us subscribe to the live stream and assert that the
    // completion notification never arrives while GET /runs/:id is non-terminal.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedEngine: Engine = {
      name: 'fake',
      async run(_req, onEvent) {
        onEvent?.({ type: 'chunk', data: 'partial' });
        await gate;
        return { output: 'done' };
      },
    };
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, RunsModule, RunnerModule],
    })
      .overrideProvider(ENGINES)
      .useValue({ claude: gatedEngine, codex: new FakeEngine({}) })
      .compile();
    const gatedRunner = mod.get(RunnerService);
    const gatedRuns = mod.get(RunsService);
    const hub = mod.get(RunEventsHub);

    const runId = await new Promise<number>((resolve) => {
      void gatedRunner.execute({ kind: 'triage', system: [], user: 'p', onStart: (id) => resolve(id) });
    });

    let statusAtClose: string | undefined;
    const closed = new Promise<void>((resolve) => {
      hub.stream(runId).subscribe({
        complete: () => {
          void gatedRuns.get(runId).then((run) => { statusAtClose = run.status; resolve(); });
        },
      });
    });

    release();
    await closed;
    expect(statusAtClose).toBe('succeeded');
  });
});

describe('RunnerService defensive outer-catch (fix H)', () => {
  beforeAll(async () => { await migrateDb(url); process.env.DATABASE_URL = url; });

  it('an unexpected engine rejection marks the run FAILED (not left running) and resolves ok:false', async () => {
    const throwingEngine: Engine = {
      name: 'fake',
      async run() { throw new Error('engine exploded unexpectedly'); },
    };
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, RunsModule, RunnerModule],
    })
      .overrideProvider(ENGINES)
      .useValue({ claude: throwingEngine, codex: new FakeEngine({}) })
      .compile();
    const runner = mod.get(RunnerService);
    const runsSvc = mod.get(RunsService);

    const res = await runner.execute({ kind: 'triage', system: [], user: 'p' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failureKind).toBe('other');
    const run = await runsSvc.get(res.runId);
    expect(run.status).toBe('failed');
  });
});

/** Records the EngineRequest it receives so we can assert cwd/images forwarding. */
class CapturingEngine implements Engine {
  readonly name = 'fake' as const;
  lastRequest?: EngineRequest;
  async run(req: EngineRequest): Promise<EngineResult> {
    this.lastRequest = req;
    return { output: 'ok' };
  }
}

describe('RunnerService cwd/images/finalize forwarding', () => {
  let runner: RunnerService;
  let capturingEngine: CapturingEngine;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    capturingEngine = new CapturingEngine();
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, RunsModule, RunnerModule],
    })
      .overrideProvider(ENGINES)
      .useValue({ claude: capturingEngine, codex: new FakeEngine({}) })
      .compile();
    runner = mod.get(RunnerService);
  });

  it('forwards cwd + images and runs finalize before success', async () => {
    const seen: string[] = [];
    const res = await runner.execute({
      kind: 'image_review', system: [], user: 'p', cwd: '/tmp/x', images: ['/tmp/x/0.png'],
      finalize: async () => { seen.push('finalize'); },
    });
    expect(res.ok).toBe(true);
    expect(capturingEngine.lastRequest?.cwd).toBe('/tmp/x');
    expect(capturingEngine.lastRequest?.images).toEqual(['/tmp/x/0.png']);
    expect(seen).toEqual(['finalize']); // ran before execute resolved
  });

  it('a throwing finalize fails the run', async () => {
    const res = await runner.execute({
      kind: 'image_html', system: [], user: 'p', schema: undefined,
      finalize: async () => { throw new Error('render boom'); },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failureKind).toBe('other');
  });

  it('finalize completes before the SSE stream closes (run is terminal at close)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedEngine: Engine = {
      name: 'fake',
      async run(_req, onEvent) {
        onEvent?.({ type: 'chunk', data: 'partial' });
        await gate;
        return { output: 'done' };
      },
    };
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, RunsModule, RunnerModule],
    })
      .overrideProvider(ENGINES)
      .useValue({ claude: gatedEngine, codex: new FakeEngine({}) })
      .compile();
    const gatedRunner = mod.get(RunnerService);
    const gatedRuns = mod.get(RunsService);
    const hub = mod.get(RunEventsHub);

    let finalizeDone = false;
    const runId = await new Promise<number>((resolve) => {
      void gatedRunner.execute({
        kind: 'image_review', system: [], user: 'p', onStart: (id) => resolve(id),
        finalize: async () => { finalizeDone = true; },
      });
    });

    let finalizeDoneAtClose = false;
    let statusAtClose: string | undefined;
    const closed = new Promise<void>((resolve) => {
      hub.stream(runId).subscribe({
        complete: () => {
          finalizeDoneAtClose = finalizeDone;
          void gatedRuns.get(runId).then((run) => { statusAtClose = run.status; resolve(); });
        },
      });
    });

    release();
    await closed;
    expect(finalizeDoneAtClose).toBe(true);
    expect(statusAtClose).toBe('succeeded');
  });
});

describe('RunnerService on the api backend without a provider key', () => {
  it('refuses a run whose row needs a missing engine, naming the key', async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, RunsModule, RunnerModule] })
      .overrideProvider(ENGINES).useValue({})
      .overrideProvider(ENGINE_BACKEND).useValue('api')
      .compile();
    const runner = mod.get(RunnerService);
    await expect(runner.execute({ kind: 'triage', system: [], user: 'triage this' }))
      .rejects.toThrow('engine anthropic is not installed in this process (backend api): ANTHROPIC_API_KEY is not set');
  });
});
