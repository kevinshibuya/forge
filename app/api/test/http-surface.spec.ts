import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { posts } from '../src/db/schema';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { PostsModule } from '../src/posts/posts.module';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('runs log + settings + post delete http surface', () => {
  let app: INestApplication;
  let postId: number;
  let runningId: number;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, RunsModule, EmbeddingsModule, PostsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const runs = mod.get(RunsService);
    const id = await runs.start({ engine: 'claude', kind: 'triage', model: 'claude-sonnet-5', prompt: 'log me' });
    await runs.succeed(id, '{"ok":true}', true);
    const db = createDb(url);
    const [p] = await db.insert(posts).values({ tier: 'T3' }).returning({ id: posts.id });
    postId = p!.id;
    runningId = await runs.start({ engine: 'claude', kind: 'draft', model: 'claude-opus-4-8', prompt: 'attached-running', postId });
    const doneId = await runs.start({ engine: 'claude', kind: 'draft', model: 'claude-opus-4-8', prompt: 'attached-done', postId });
    await runs.succeed(doneId, 'out', true);
  });

  it('lists runs newest-first and serves the full row', async () => {
    const list = await request(app.getHttpServer()).get('/api/runs?kind=triage&limit=5').expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].prompt).toBe('log me');
    const one = await request(app.getHttpServer()).get(`/api/runs/${list.body[0].id}`).expect(200);
    expect(one.body.output).toBe('{"ok":true}');
    await request(app.getHttpServer()).get('/api/runs/999999').expect(404);
  });

  it('rejects bad kind and bad limit with 400 instead of 500', async () => {
    await request(app.getHttpServer()).get('/api/runs?kind=not_a_kind').expect(400);
    await request(app.getHttpServer()).get('/api/runs?limit=not_a_number').expect(400);
    await request(app.getHttpServer()).get('/api/runs?limit=0').expect(400);
    await request(app.getHttpServer()).get('/api/runs?limit=201').expect(400);
  });

  it('filters by postId and status, 400s on bad values', async () => {
    const byPost = await request(app.getHttpServer()).get(`/api/runs?postId=${postId}`).expect(200);
    expect(byPost.body).toHaveLength(2);
    expect(byPost.body.every((r: { postId: number | null }) => r.postId === postId)).toBe(true);
    const running = await request(app.getHttpServer()).get(`/api/runs?postId=${postId}&status=running`).expect(200);
    expect(running.body).toHaveLength(1);
    expect(running.body[0].prompt).toBe('attached-running');
    await request(app.getHttpServer()).get('/api/runs?status=nope').expect(400);
    await request(app.getHttpServer()).get('/api/runs?postId=abc').expect(400);
  });

  it('settings round-trip with validation', async () => {
    const got = await request(app.getHttpServer()).get('/api/settings').expect(200);
    expect(typeof got.body.retrievalK).toBe('number');
    // The registry holds models and prices from slice 2 on; the settings payload carries neither.
    expect(got.body).not.toHaveProperty('models');
    expect(got.body).not.toHaveProperty('pricing');
    const patched = await request(app.getHttpServer())
      .patch('/api/settings').send({ retrievalK: 7 }).expect(200);
    expect(patched.body.retrievalK).toBe(7);
    await request(app.getHttpServer()).patch('/api/settings').send({ retrievalK: 999 }).expect(400);
    // restore shared-db state
    await request(app.getHttpServer()).patch('/api/settings').send({ retrievalK: 5 }).expect(200);
  });

  it('rejects unknown settings keys with 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings').send({ notARealSetting: true }).expect(400);
  });
  it('DELETE /posts/:id answers 409 on a run in flight, 200 empty on a free post, 400 on a bad id', async () => {
    const busy = await request(app.getHttpServer()).delete(`/api/posts/${postId}`).expect(409);
    expect(busy.body.message).toBe(`post ${postId} has run ${runningId} in flight`);

    const db = createDb(url);
    const [fresh] = await db.insert(posts).values({ tier: 'T3' }).returning({ id: posts.id });
    const gone = await request(app.getHttpServer()).delete(`/api/posts/${fresh!.id}`).expect(200);
    expect(gone.text).toBe('');
    await request(app.getHttpServer()).get(`/api/posts/${fresh!.id}`).expect(404);

    await request(app.getHttpServer()).delete('/api/posts/abc').expect(400);
    // The 409 deleted nothing: the post still has both its runs.
    const byPost = await request(app.getHttpServer()).get(`/api/runs?postId=${postId}`).expect(200);
    expect(byPost.body).toHaveLength(2);
  });
});
