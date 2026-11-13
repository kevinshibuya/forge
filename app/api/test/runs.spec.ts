import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('RunsService', () => {
  let svc: RunsService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, RunsModule] }).compile();
    svc = mod.get(RunsService);
  });

  it('start → succeed records output and finished_at', async () => {
    const id = await svc.start({ engine: 'claude', kind: 'triage', model: 'claude-sonnet-5', prompt: 'p' });
    await svc.succeed(id, '{"ok":true}', true);
    const run = await svc.get(id);
    expect(run.status).toBe('succeeded');
    expect(run.parsedOk).toBe(true);
    expect(run.finishedAt).not.toBeNull();
  });

  it('timeout failure gets status=timeout, quota keeps kind', async () => {
    const a = await svc.start({ engine: 'codex', kind: 'image_gen', model: 'gpt-image-2', prompt: 'p' });
    await svc.fail(a, { kind: 'timeout', error: 'killed after 600000ms' });
    expect((await svc.get(a)).status).toBe('timeout');

    const b = await svc.start({ engine: 'codex', kind: 'image_gen', model: 'gpt-image-2', prompt: 'p' });
    await svc.fail(b, { kind: 'quota', error: 'plan limit reached' });
    const runB = await svc.get(b);
    expect(runB.status).toBe('failed');
    expect(runB.failureKind).toBe('quota');
  });

  it('a decline persists its envelope and tells, and counts as parsed', async () => {
    const id = await svc.start({ engine: 'claude', kind: 'draft', model: 'm', prompt: 'p' });
    const declined = { outcome: 'declined' as const, reason: 'r', question: 'q' };
    await svc.fail(id, { kind: 'declined', error: 'r', declined, tells: [] });
    const run = await svc.get(id);
    expect(run.status).toBe('failed');
    expect(run.failureKind).toBe('declined');
    expect(run.declined).toEqual(declined);
    expect(run.tells).toEqual([]);
    expect(run.parsedOk).toBe(true);
  });

  it('rejects double transitions', async () => {
    const id = await svc.start({ engine: 'claude', kind: 'draft', model: 'claude-opus-4-8', prompt: 'p' });
    await svc.succeed(id, 'out', false);
    await expect(svc.succeed(id, 'again', true)).rejects.toThrow(/IllegalRunTransition/);
  });
});
