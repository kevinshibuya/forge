import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { costUsd, type Engine, type EngineRequest, type EngineResult, type EngineUsage } from '@forge/shared';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { RunnerModule } from '../src/runner/runner.module';
import { RunnerService, RunRefused } from '../src/runner/runner.service';
import { ENGINE_BACKEND, ENGINES } from '../src/engines/engine.interface';
import { LedgerService } from '../src/ledger/ledger.service';
import { ModelRegistryService } from '../src/registry/model-registry.service';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

type Script = (req: EngineRequest) => Promise<EngineResult>;

/** An engine whose next answers are set per test; the default answers `ok` with no usage. */
class Scripted implements Engine {
  readonly name = 'fake' as const;
  script: Script = async () => ({ output: 'ok' });
  run(req: EngineRequest): Promise<EngineResult> { return this.script(req); }
}

const claude = new Scripted();
const codex = new Scripted();

const Payload = z.object({ x: z.string() });

async function build(backend: 'cli' | 'api'): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [DbModule, SettingsModule, RunsModule, RunnerModule] })
    .overrideProvider(ENGINES).useValue({ claude, codex })
    .overrideProvider(ENGINE_BACKEND).useValue(backend)
    .compile();
}

describe('runner: usage and cost on every exit path', () => {
  let runner: RunnerService;
  let runs: RunsService;
  let ledger: LedgerService;
  let registry: ModelRegistryService;
  let mod: TestingModule;
  let apiMod: TestingModule | undefined;

  const priceOf = async (task: 'draft_t3' | 'image_gen' | 'image_html', usage: EngineUsage) => {
    const row = await registry.resolve(task, 'cli');
    return costUsd(usage, row!.prices);
  };

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    mod = await build('cli');
    runner = mod.get(RunnerService);
    runs = mod.get(RunsService);
    ledger = mod.get(LedgerService);
    registry = mod.get(ModelRegistryService);
  });

  afterAll(async () => {
    await apiMod?.close();
    await mod.close();
  });

  beforeEach(() => {
    claude.script = async () => ({ output: 'ok' });
    codex.script = async () => ({ output: 'ok' });
  });

  it('success: the run and its one ledger row carry the usage and the registry row\'s price', async () => {
    const usage = { inputTokens: 100, cacheWriteTokens: 20, cacheReadTokens: 30, outputTokens: 10 };
    claude.script = async () => ({ output: 'drafted', usage, providerRequestId: 'req_ok' });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write' });
    expect(res.ok).toBe(true);
    const run = await runs.get(res.runId);
    const expected = await priceOf('draft_t3', usage);
    expect([run.status, run.tokensInput, run.tokensCacheWrite, run.tokensCacheRead, run.tokensOutput])
      .toEqual(['succeeded', 100, 20, 30, 10]);
    expect(run.costUsd).toBeCloseTo(expected!, 6);
    // The seeded cli draft_t3 row (Sonnet 5 at 2 / 2.5 / 0.2 / 10), priced by hand:
    // 100×2 + 20×2.5 + 30×0.2 + 10×10 = 356 per million.
    expect(run.costUsd).toBeCloseTo(0.000356, 6);
    const rows = await ledger.forRun(res.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempt: 1, exit: 'succeeded', backend: 'cli', engine: 'claude', category: 'text', providerRequestId: 'req_ok' });
    expect(rows[0]!.costUsd).toBeCloseTo(expected!, 6);
  });

  it('declined: failed as declined, the ledger row says declined, the usage is recorded', async () => {
    claude.script = async () => ({
      output: '{}', structured: { result: { outcome: 'declined', reason: 'nothing to say' } }, usage: { inputTokens: 40, outputTokens: 4 },
    });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write', schema: Payload });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput]).toEqual(['failed', 'declined', 40]);
    expect((await ledger.forRun(res.runId)).map((r) => r.exit)).toEqual(['declined']);
  });

  // A provider refusal (C2, C3) arrives as `declined` plus the envelope the api engine built. It is
  // a decline like an in-schema one, schema or not.
  const refusal = async (): Promise<EngineResult> => ({
    output: '', failureKind: 'declined', errorDetail: 'unsafe',
    structured: { result: { outcome: 'declined', reason: 'unsafe' } }, usage: { inputTokens: 30, outputTokens: 0 },
  });

  for (const withSchema of [true, false]) {
    it(`provider refusal${withSchema ? '' : ' without a schema'}: the decline path keeps the envelope`, async () => {
      claude.script = refusal;
      const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write', ...(withSchema ? { schema: Payload } : {}) });
      expect(res.ok).toBe(false);
      if (!res.ok) expect([res.failureKind, res.declined?.reason]).toEqual(['declined', 'unsafe']);
      const run = await runs.get(res.runId);
      expect([run.status, run.failureKind, run.declined?.reason, run.parsedOk, run.tokensInput])
        .toEqual(['failed', 'declined', 'unsafe', true, 30]);
      expect((await ledger.forRun(res.runId)).map((r) => r.exit)).toEqual(['declined']);
    });
  }

  it('timeout: the usage the provider reported before the kill is kept', async () => {
    claude.script = async () => ({ output: '', failureKind: 'timeout', errorDetail: 'killed', usage: { inputTokens: 900 } });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write' });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput, run.tokensOutput]).toEqual(['timeout', 'timeout', 900, null]);
    expect((await ledger.forRun(res.runId)).map((r) => r.exit)).toEqual(['timeout']);
  });

  it('spawn_error: a ledger row exists with null tokens and null cost', async () => {
    claude.script = async () => ({ output: '', failureKind: 'spawn_error', errorDetail: 'ENOENT' });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write' });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput, run.tokensOutput, run.costUsd]).toEqual(['failed', 'spawn_error', null, null, null]);
    const rows = await ledger.forRun(res.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exit: 'spawn_error', tokensInput: null, tokensOutput: null, costUsd: null });
  });

  it('invalid_output: the run fails, the call itself succeeded and is priced', async () => {
    claude.script = async () => ({ output: 'prose', usage: { inputTokens: 60, outputTokens: 6 } });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write', schema: Payload });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput]).toEqual(['failed', 'invalid_output', 60]);
    expect((await ledger.forRun(res.runId)).map((r) => r.exit)).toEqual(['succeeded']);
  });

  it('finalize throws: the run fails as other, the call is recorded as succeeded', async () => {
    claude.script = async () => ({ output: 'ok', usage: { inputTokens: 70, outputTokens: 7 } });
    const res = await runner.execute({
      kind: 'draft', tier: 'T3', system: [], user: 'write', finalize: async () => { throw new Error('ingest broke'); },
    });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput]).toEqual(['failed', 'other', 70]);
    expect((await ledger.forRun(res.runId)).map((r) => r.exit)).toEqual(['succeeded']);
  });

  it('engine throws: exactly one ledger row, exit other, no usage', async () => {
    claude.script = async () => { throw new Error('engine blew up'); };
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write' });
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind, run.tokensInput, run.costUsd]).toEqual(['failed', 'other', null, null]);
    const rows = await ledger.forRun(res.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exit: 'other', tokensInput: null, costUsd: null });
  });

  it('retry: one ledger row per attempt, and the run carries the final attempt only', async () => {
    let n = 0;
    claude.script = async () => (++n === 1
      ? { output: '', failureKind: 'quota', retryable: { afterMs: 1 }, usage: { inputTokens: 50 } }
      : { output: 'ok', usage: { inputTokens: 100, outputTokens: 10 } });
    const res = await runner.execute({ kind: 'draft', tier: 'T3', system: [], user: 'write' });
    expect(res.ok).toBe(true);
    const run = await runs.get(res.runId);
    expect([run.status, run.tokensInput, run.tokensOutput]).toEqual(['succeeded', 100, 10]);
    const rows = await ledger.forRun(res.runId);
    expect(rows.map((r) => [r.attempt, r.exit, r.tokensInput])).toEqual([[1, 'quota', 50], [2, 'succeeded', 100]]);
  });

  it('raster image: finalize reports the images, the image price lands, the codex session total adds nothing', async () => {
    codex.script = async () => ({ output: 'Generated 3 images', usage: { outputTokens: 33_538 } });
    const res = await runner.execute({
      kind: 'image_gen', system: [], user: 'paint three', finalize: async () => ({ images: 3 }),
    });
    expect(res.ok).toBe(true);
    const run = await runs.get(res.runId);
    expect([run.engine, run.imagesGenerated]).toEqual(['codex', 3]);
    expect(run.costUsd).toBeCloseTo(0.75, 6);
    const rows = await ledger.forRun(res.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exit: 'succeeded', images: 3, category: 'image', engine: 'codex' });
    expect(rows[0]!.costUsd).toBeCloseTo(0.75, 6);
  });

  it('managed: one ledger row per call with its step number, and the run rolls up the sums', async () => {
    claude.script = async () => ({ output: 'PLAN', usage: { inputTokens: 100, outputTokens: 10 } });
    codex.script = async () => ({ output: 'BG', usage: { inputTokens: 7, outputTokens: 3 } });
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async ({ call }) => {
        await call('image_plan', { system: [], user: 'p1' });
        await call('image_gen', { system: [], user: 'p2' });
        return 'FINAL';
      },
    });
    expect(res.ok).toBe(true);
    const steps = await runs.stepsFor(res.runId);
    expect(steps.map((s) => [s.seq, s.kind, s.engine])).toEqual([[1, 'image_plan', 'claude'], [2, 'image_gen', 'codex']]);
    expect(steps[0]!.prompt).toBe('p1');
    expect(steps[0]!.output).toBe('PLAN');
    expect(steps[0]!.imagesGenerated).toBeNull();
    expect(steps[1]!.imagesGenerated).toBe(1);

    const rows = await ledger.forRun(res.runId);
    expect(rows.map((r) => [r.stepSeq, r.exit, r.category])).toEqual([[1, 'succeeded', 'text'], [2, 'succeeded', 'image']]);
    expect(rows[1]).toMatchObject({ images: 1, engine: 'codex' });
    const planCost = await priceOf('image_html', { inputTokens: 100, outputTokens: 10 });
    const imageCost = await priceOf('image_gen', { inputTokens: 7, outputTokens: 3, images: 1 });
    expect(rows[0]!.costUsd).toBeCloseTo(planCost!, 6);
    // The seeded cli image_html row (Opus 4.8 at 5 / 25), priced by hand: 100×5 + 10×25 = 750 per million.
    expect(planCost).toBeCloseTo(0.00075, 6);
    expect(rows[1]!.costUsd).toBeCloseTo(imageCost!, 6);
    expect(imageCost).toBeCloseTo(0.25, 6);

    const run = await runs.get(res.runId);
    expect([run.engine, run.tokensInput, run.tokensOutput, run.imagesGenerated]).toEqual(['claude', 107, 13, 1]);
    expect(run.costUsd).toBeCloseTo(planCost! + imageCost!, 6);
  });

  it('managed: an engine that throws inside call leaves a ledger row and a step row, and the run fails other', async () => {
    claude.script = async () => { throw new Error('socket closed'); };
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async ({ call }) => { await call('image_plan', { system: [], user: 'p1' }); return 'FINAL'; },
    });
    expect(res.ok).toBe(false);
    const run = await runs.get(res.runId);
    expect([run.status, run.failureKind]).toEqual(['failed', 'other']);
    expect(run.error).toContain('socket closed');
    const steps = await runs.stepsFor(res.runId);
    expect(steps.map((st) => [st.seq, st.failureKind])).toEqual([[1, 'other']]);
    const rows = await ledger.forRun(res.runId);
    expect(rows.map((r) => [r.stepSeq, r.exit, r.tokensInput])).toEqual([[1, 'other', null]]);
  });

  it('managed: a retry inside call writes attempt 1 with its step number, and the step carries attempt 2', async () => {
    let n = 0;
    claude.script = async () => (++n === 1
      ? { output: '', failureKind: 'quota', retryable: { afterMs: 1 }, usage: { inputTokens: 50 } }
      : { output: 'PLAN', usage: { inputTokens: 100, outputTokens: 10 } });
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async ({ call }) => { await call('image_plan', { system: [], user: 'p1' }); return 'FINAL'; },
    });
    expect(res.ok).toBe(true);
    const rows = await ledger.forRun(res.runId);
    expect(rows.map((r) => [r.stepSeq, r.attempt, r.exit, r.tokensInput])).toEqual([[1, 1, 'quota', 50], [1, 2, 'succeeded', 100]]);
    const steps = await runs.stepsFor(res.runId);
    expect(steps.map((st) => st.tokensInput)).toEqual([100]);
    expect((await runs.get(res.runId)).tokensInput).toBe(100);
  });

  it('managed: step usage rolls up even when the body then fails', async () => {
    claude.script = async () => ({ output: 'PLAN', usage: { inputTokens: 100, outputTokens: 10 } });
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async ({ call }) => {
        await call('image_plan', { system: [], user: 'p1' });
        throw Object.assign(new Error('later step exploded'), { failureKind: 'invalid_output' });
      },
    });
    expect(res.ok).toBe(false);
    expect(await runs.stepsFor(res.runId)).toHaveLength(1);
    const run = await runs.get(res.runId);
    expect([run.status, run.tokensInput]).toEqual(['failed', 100]);
    expect(await ledger.forRun(res.runId)).toHaveLength(1);
  });

  it('refused: no registry row for the backend means no run row and no ledger row', async () => {
    apiMod = await build('api');
    const apiRunner = apiMod.get(RunnerService);
    const before = (await runs.list({ kind: 'image_review', limit: 200 })).length;
    await expect(apiRunner.execute({ kind: 'image_review', system: [], user: 'score' })).rejects.toBeInstanceOf(RunRefused);
    await expect(apiRunner.execute({ kind: 'image_review', system: [], user: 'score' }))
      .rejects.toThrow('no model_registry row for task image_review on backend api');
    expect((await runs.list({ kind: 'image_review', limit: 200 })).length).toBe(before);
  });
});
