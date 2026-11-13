import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { ImagesModule } from '../src/images/images.module';
import { ENGINES } from '../src/engines/engine.interface';
import { structuredFrom } from '../src/engines/fake.engine';
import type { Engine, EngineRequest, EngineResult, EngineEvent } from '../src/engines/engine.interface';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

// A 1200×1200 PNG header — readPngSize only inspects the 24-byte signature + IHDR.
function png1200(): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(1200, 20);
  return b;
}

// codex slot: writes bg.png into the run's cwd, mirroring the real image_gen tool.
class BgWritingEngine implements Engine {
  readonly name = 'fake' as const;
  async run(req: EngineRequest): Promise<EngineResult> {
    if (req.cwd) await writeFile(join(req.cwd, 'bg.png'), png1200());
    return { output: 'bg written' };
  }
}

// claude slot: queue canned responses per kind (localize + verify share kind `image_review`, so
// they pop in call order; the last entry repeats so loops terminate).
class QueueClaude implements Engine {
  readonly name = 'fake' as const;
  constructor(private readonly queues: Partial<Record<EngineRequest['kind'], string[]>>) {}
  async run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    const q = this.queues[req.kind];
    const output = q && q.length > 0 ? (q.length > 1 ? q.shift()! : q[0]!) : `fake:${req.kind}`;
    onEvent?.({ type: 'chunk', data: output });
    return { output, structured: structuredFrom(output) };
  }
}

const VALID_PLAN = '```json\n{"backgroundPrompt":"deep navy gradient","headline":"The Idle Transaction","subtext":"why it flips","textZone":"lower-third","palette":"navy/teal"}\n```';
const TEXT_HTML = "```html\n<!doctype html><html><body><div style=\"background-image:url('__HYBRID_BG__');background-size:cover\"></div></body></html>\n```";

describe('images HTTP surface', () => {
  let app: INestApplication;
  let posts: PostsService;
  beforeAll(async () => {
    await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl;
    // Override engines + renderer with fakes so POST /hybrid runs its full background orchestration
    // in-process (no real claude/codex/Playwright), which would otherwise spawn processes that leak
    // past afterAll.
    const mod = await Test.createTestingModule({
      imports: [DbModule, EmbeddingsModule, RunsModule, PostsModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(RENDERER).useValue(new FakeRenderer())
      .overrideProvider(ENGINES).useValue({
        claude: new QueueClaude({ image_plan: [VALID_PLAN], image_html: [TEXT_HTML] }),
        codex: new BgWritingEngine(),
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    posts = mod.get(PostsService);
  });
  afterAll(async () => { await app.close(); });

  // Poll the post's runs until >= n exist AND none are still 'running' — a run stays 'running' until
  // executeManaged's runs.succeed()/fail() finishes, so (unlike polling candidate inserts, which race
  // the trailing runs.succeed write) this guarantees no pipeline leaks past afterAll's app.close().
  async function waitForPostRunsSettled(postId: number, n: number): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const r = await request(app.getHttpServer()).get(`/api/runs?postId=${postId}`);
      const runs: { status: string }[] = r.status === 200 && Array.isArray(r.body) ? r.body : [];
      if (runs.length >= n && runs.every((x) => x.status !== 'running')) return;
      await new Promise((res) => setTimeout(res, 25));
    }
    throw new Error(`runs never settled (>= ${n} terminal) for post ${postId}`);
  }

  it('GET /api/images/posts/:id returns [] for a new post', async () => {
    const post = await posts.create({ tier: 'T1' });
    const res = await request(app.getHttpServer()).get(`/api/images/posts/${post.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('GET /api/images/:id/file 404s for a missing asset', async () => {
    const res = await request(app.getHttpServer()).get('/api/images/999999/file');
    expect(res.status).toBe(404);
  });

  it('POST /api/images/posts/:id/hybrid (batch:1) → 202 { runIds:[x] } and lands one hybrid candidate', async () => {
    const post = await posts.create({ tier: 'T1' });
    const res = await request(app.getHttpServer())
      .post(`/api/images/posts/${post.id}/hybrid`).send({ brief: 'a prose brief', batch: 1 });
    expect(res.status).toBe(202);
    expect(res.body.runIds).toHaveLength(1);
    expect(res.body.runIds[0]).toBeGreaterThan(0);
    await waitForPostRunsSettled(post.id, 1);
    const list = await request(app.getHttpServer()).get(`/api/images/posts/${post.id}`);
    expect(list.body.items.filter((a: { lane: string }) => a.lane === 'hybrid')).toHaveLength(1);
  });

  it('POST /api/images/posts/:id/hybrid (batch:2) → 202 { runIds:[x,y] } and lands two candidates', async () => {
    const post = await posts.create({ tier: 'T1' });
    const res = await request(app.getHttpServer())
      .post(`/api/images/posts/${post.id}/hybrid`).send({ brief: 'a prose brief', batch: 2 });
    expect(res.status).toBe(202);
    expect(res.body.runIds).toHaveLength(2);
    await waitForPostRunsSettled(post.id, 2);
    const list = await request(app.getHttpServer()).get(`/api/images/posts/${post.id}`);
    expect(list.body.items.filter((a: { lane: string }) => a.lane === 'hybrid')).toHaveLength(2);
  });

  it('POST /api/images/posts/:id/hybrid without a brief → 400', async () => {
    const post = await posts.create({ tier: 'T1' });
    const res = await request(app.getHttpServer())
      .post(`/api/images/posts/${post.id}/hybrid`).send();
    expect(res.status).toBe(400);
  });
});
