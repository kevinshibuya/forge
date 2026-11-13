import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { DB, type ForgeDb } from '../src/db/client';
import { runs } from '../src/db/schema';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { RunsLogController } from '../src/runs/runs-log.controller';
import { SettingsModule } from '../src/settings/settings.module';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('C1 run detail with steps + recorded cost', () => {
  let db: ForgeDb;
  let ctrl: RunsLogController;
  let runsSvc: RunsService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, RunsModule] }).compile();
    db = mod.get(DB);
    ctrl = mod.get(RunsLogController);
    runsSvc = mod.get(RunsService);
  });

  it('serves the cost recorded on the run and on each step, as numbers, never re-priced', async () => {
    // The run row's totals would price at thousands of dollars at any rate; the detail must serve
    // the recorded cost, not an estimate from the totals.
    const [run] = await db.insert(runs).values({
      engine: 'claude', kind: 'image_hybrid', model: 'claude-opus-4-8', prompt: 'p',
      status: 'succeeded', tokensInput: 5_000_000, tokensOutput: 9_000_000, imagesGenerated: 7, costUsd: '1.275',
    }).returning();
    await runsSvc.addStep({
      runId: run!.id, seq: 1, kind: 'image_plan', engine: 'claude', model: 'claude-opus-4-8',
      prompt: 'plan', output: 'ok', tokensInput: 1_000_000, tokensCacheRead: 200_000, tokensOutput: 1_000_000, costUsd: 1.025,
      startedAt: new Date(), finishedAt: new Date(),
    });
    await runsSvc.addStep({
      runId: run!.id, seq: 2, kind: 'image_gen', engine: 'codex', model: 'gpt-image-2',
      prompt: 'bg', output: 'ok', imagesGenerated: 1, costUsd: 0.25,
      startedAt: new Date(), finishedAt: new Date(),
    });
    const detail = await ctrl.get(run!.id);
    expect(detail.costUsd).toBe(1.275);
    expect(detail.steps.map((x) => [x.seq, x.costUsd, x.tokensCacheRead])).toEqual([[1, 1.025, 200_000], [2, 0.25, null]]);
  });

  it('a run with no recorded cost serves null, whatever its token totals say', async () => {
    const [legacy] = await db.insert(runs).values({
      engine: 'claude', kind: 'draft', model: 'claude-opus-4-8', prompt: 'p', status: 'succeeded',
      tokensInput: 2_000_000, tokensOutput: 0,
    }).returning();
    const d = await ctrl.get(legacy!.id);
    expect(d.steps).toEqual([]);
    expect(d.costUsd).toBeNull();
  });
});
