import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { DB, type ForgeDb } from '../src/db/client';
import { assets, posts, runSteps, runs } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('F1 migration: run_steps + asset lineage + usage columns', () => {
  let db: ForgeDb;
  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule] }).compile();
    db = mod.get(DB);
  });

  it('round-trips a step row under an image_refine run and lineage columns on assets', async () => {
    const [post] = await db.insert(posts).values({ tier: 'T1' }).returning();
    const [run] = await db.insert(runs).values({
      engine: 'codex', kind: 'image_refine', model: 'gpt-image-2', prompt: 'patch it',
      postId: post!.id, tokensInput: 11, tokensOutput: 22, imagesGenerated: 1,
    }).returning();
    await db.insert(runSteps).values({
      runId: run!.id, seq: 1, kind: 'image_gen', engine: 'codex', model: 'gpt-image-2',
      prompt: 'edit the attached image', output: 'ok', imagesGenerated: 1,
      startedAt: new Date(), finishedAt: new Date(),
    });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run!.id));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.imagesGenerated).toBe(1);
    expect(run!.tokensOutput).toBe(22);

    const [src] = await db.insert(assets).values({
      postId: post!.id, lane: 'hybrid', pngPath: 'x.png', width: 1, height: 1, candidateGroupId: 'g1',
    }).returning();
    expect(src!.origin).toBe('generated'); // default
    const [child] = await db.insert(assets).values({
      postId: post!.id, lane: 'hybrid', pngPath: 'y.png', width: 1, height: 1, candidateGroupId: 'g2',
      origin: 'bg_refined', sourceAssetId: src!.id, runId: run!.id,
    }).returning();
    expect(child!.origin).toBe('bg_refined');
    expect(child!.sourceAssetId).toBe(src!.id);
    expect(child!.runId).toBe(run!.id);
  });
});
