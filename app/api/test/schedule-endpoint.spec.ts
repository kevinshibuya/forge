import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { posts } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('PATCH /posts/:id/schedule', () => {
  let app: INestApplication;
  let db: ForgeDb;
  let id: number;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    db = createDb(url);
    id = (await mod.get(PostsService).create({ tier: 'T3' })).id;
  });

  it('schedules, reschedules (clearing time), unschedules', async () => {
    const a = await request(app.getHttpServer())
      .patch(`/api/posts/${id}/schedule`).send({ date: '2027-04-02', time: '10:30' }).expect(200);
    expect(a.body.scheduledDate).toBe('2027-04-02');
    expect(a.body.scheduledTime).toBe('10:30:00');

    const b = await request(app.getHttpServer())
      .patch(`/api/posts/${id}/schedule`).send({ date: '2027-04-03' }).expect(200);
    expect(b.body.scheduledDate).toBe('2027-04-03');
    expect(b.body.scheduledTime).toBeNull(); // full-state: omitted time clears

    const c = await request(app.getHttpServer())
      .patch(`/api/posts/${id}/schedule`).send({ date: null }).expect(200);
    expect(c.body.scheduledDate).toBeNull();
    expect(c.body.scheduledTime).toBeNull();
  });

  it('rejects bad shapes, bad calendar values, published posts, unknown ids', async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${id}/schedule`)
      .send({ date: null, time: '10:00' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/posts/${id}/schedule`)
      .send({ date: '2027-13-40' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/posts/${id}/schedule`)
      .send({ date: '2027-04-02', time: '25:99' }).expect(400);
    await request(app.getHttpServer()).patch('/api/posts/999999/schedule')
      .send({ date: '2027-04-02' }).expect(404);

    await db.update(posts).set({ publishedAt: new Date() }).where(eq(posts.id, id));
    await request(app.getHttpServer()).patch(`/api/posts/${id}/schedule`)
      .send({ date: '2027-04-02' }).expect(400);
    await db.delete(posts).where(eq(posts.id, id));
  });
});
