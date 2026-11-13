import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { SettingsModule } from '../src/settings/settings.module';
import { RunnerModule } from '../src/runner/runner.module';
import { RunnerService } from '../src/runner/runner.service';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('RunnerService.executeManaged', () => {
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
        claude: new FakeEngine({ image_plan: 'PLAN' }),
        codex: new FakeEngine({ image_gen: 'BG' }),
      })
      .compile();
    runner = mod.get(RunnerService);
    runsSvc = mod.get(RunsService);
  });

  it('runs multiple engine calls under one run and succeeds with the returned output', async () => {
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async ({ call }) => {
        const a = await call('image_plan', { system: [], user: 'p1' });
        const b = await call('image_gen', { system: [], user: 'p2' });
        expect(a.output).toBe('PLAN'); expect(b.output).toBe('BG');
        return 'FINAL';
      },
    });
    expect(res.ok).toBe(true);
    const run = await runsSvc.get(res.runId);
    expect(run.status).toBe('succeeded');
    expect(run.output).toBe('FINAL');
    expect(run.kind).toBe('image_hybrid');
  });

  it('fails the run with the thrown failureKind when the body throws', async () => {
    const res = await runner.executeManaged({
      kind: 'image_hybrid', prompt: 'brief',
      run: async () => { throw Object.assign(new Error('boom'), { failureKind: 'invalid_output' }); },
    });
    expect(res.ok).toBe(false);
    const run = await runsSvc.get(res.runId);
    expect(run.status).toBe('failed');
    expect(run.failureKind).toBe('invalid_output');
  });
});
