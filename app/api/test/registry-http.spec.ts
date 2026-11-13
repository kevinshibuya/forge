import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { modelRegistry } from '../src/db/schema';
import { DbModule } from '../src/db/db.module';
import { ModelRegistryModule } from '../src/registry/model-registry.module';
import { configureApp } from '../src/app.setup';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('model registry http surface', () => {
  let app: NestExpressApplication;
  const db = createDb(url);
  let before: (typeof modelRegistry.$inferSelect)[] = [];
  const idOf = (task: string, backend: string) => {
    const row = before.find((r) => r.task === task && r.backend === backend);
    if (!row) throw new Error(`no registry row ${task}/${backend}`);
    return row.id;
  };

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    before = await db.select().from(modelRegistry);
    const mod = await Test.createTestingModule({ imports: [DbModule, ModelRegistryModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    for (const row of before) await db.update(modelRegistry).set(row).where(eq(modelRegistry.id, row.id));
    await app.close();
  });

  it('lists the 13 rows ordered by backend then task, with numeric prices', async () => {
    const res = await request(app.getHttpServer()).get('/api/registry').expect(200);
    expect(res.body).toHaveLength(13);
    const keys = res.body.map((r: { backend: string; task: string }) => `${r.backend}/${r.task}`);
    expect(keys).toEqual([...keys].sort());
    expect(keys[0]).toBe('api/draft_t1');
    const sonnet = res.body.find((r: { backend: string; task: string }) => r.backend === 'api' && r.task === 'draft_t3');
    expect(sonnet).toMatchObject({
      engine: 'anthropic', model: 'claude-sonnet-5', effort: 'medium', maxOutputTokens: 16384,
      prices: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10, imagePerUnit: 0 },
    });
  });

  it('patches one row and answers it with numbers, not strings', async () => {
    const id = idOf('retro', 'api');
    const res = await request(app.getHttpServer())
      .patch(`/api/registry/${id}`).send({ model: 'claude-opus-5-5', inputPerMtok: 4 }).expect(200);
    expect(res.body).toMatchObject({ id, task: 'retro', backend: 'api', model: 'claude-opus-5-5' });
    expect(res.body.prices.inputPerMtok).toBe(4);
    expect(res.body.prices.outputPerMtok).toBe(10);
    const others = await request(app.getHttpServer()).get('/api/registry').expect(200);
    const changed = others.body.filter((r: { model: string }) => r.model === 'claude-opus-5-5');
    expect(changed).toHaveLength(1);
  });

  it('an engine patch stays inside the row\'s backend', async () => {
    await request(app.getHttpServer()).patch(`/api/registry/${idOf('triage', 'api')}`).send({ engine: 'openai' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/registry/${idOf('triage', 'cli')}`).send({ engine: 'openai' }).expect(422);
  });

  it('refuses an unknown key, a negative price and an unknown id', async () => {
    const id = idOf('draft_t1', 'cli');
    await request(app.getHttpServer()).patch(`/api/registry/${id}`).send({ task: 'x' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/registry/${id}`).send({ outputPerMtok: -1 }).expect(400);
    await request(app.getHttpServer()).patch('/api/registry/999999').send({ model: 'm' }).expect(404);
  });

  it('refuses a price its column cannot hold and google before slice 10, as 400s', async () => {
    const id = idOf('draft_t1', 'api');
    await request(app.getHttpServer()).patch(`/api/registry/${id}`).send({ inputPerMtok: 10_000_000 }).expect(400);
    await request(app.getHttpServer()).patch(`/api/registry/${id}`).send({ engine: 'google' }).expect(400);
  });
});
