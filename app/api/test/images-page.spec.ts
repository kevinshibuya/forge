import { beforeAll, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { DB, type ForgeDb } from '../src/db/client';
import { assets, posts, runs } from '../src/db/schema';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';
import { ImageComposeService } from '../src/images/image-compose.service';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { SettingsModule } from '../src/settings/settings.module';
import { RunnerModule } from '../src/runner/runner.module';
import { ENGINES } from '../src/engines/engine.interface';
import type { Engine, EngineRequest, EngineResult } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

function png1200(): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(1200, 20);
  return b;
}

class BgWritingEngine implements Engine {
  readonly name = 'fake' as const;
  async run(req: EngineRequest): Promise<EngineResult> {
    if (req.cwd) await writeFile(join(req.cwd, 'bg.png'), png1200());
    return { output: 'bg written' };
  }
}

const VALID_PLAN = '```json\n{"backgroundPrompt":"navy gradient","headline":"H","textZone":"lower-third","palette":"navy"}\n```';
const TEXT_HTML = "```html\n<!doctype html><html><body><div style=\"background-image:url('__HYBRID_BG__')\"></div></body></html>\n```";

describe('B1 listPage + breakdown', () => {
  let db: ForgeDb;
  let images: ImagesService;
  let compose: ImageComposeService;
  let runsSvc: RunsService;
  let postId: number;
  const ids: number[] = [];

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({
        claude: new FakeEngine({ image_plan: VALID_PLAN, image_html: TEXT_HTML }),
        codex: new BgWritingEngine(),
      })
      .overrideProvider(RENDERER).useValue(new FakeRenderer())
      .compile();
    db = mod.get(DB);
    images = mod.get(ImagesService);
    compose = mod.get(ImageComposeService);
    runsSvc = mod.get(RunsService);
    const [post] = await db.insert(posts).values({ tier: 'T1' }).returning();
    postId = post!.id;
    const base = Date.parse('2026-08-01T12:00:00Z');
    for (let i = 0; i < 5; i++) {
      const [a] = await db.insert(assets).values({
        postId, lane: 'hybrid', pngPath: `p${i}.png`, width: 1, height: 1, candidateGroupId: `g${i}`,
        createdAt: new Date(base + i * 60_000),
        ...(i === 4 ? { origin: 'bg_refined' as const } : {}),
      }).returning();
      ids.push(a!.id);
    }
  });

  it('pages newest-first by default with a stable total', async () => {
    const p1 = await images.listPage(postId, { limit: 2, offset: 0 });
    expect(p1.total).toBe(5);
    expect(p1.items.map((a) => a.id)).toEqual([ids[4], ids[3]]);
    const p2 = await images.listPage(postId, { limit: 2, offset: 2 });
    expect(p2.items.map((a) => a.id)).toEqual([ids[2], ids[1]]);
  });

  it('supports oldest sort and origin filter', async () => {
    const oldest = await images.listPage(postId, { limit: 3, offset: 0, sort: 'oldest' });
    expect(oldest.items.map((a) => a.id)).toEqual([ids[0], ids[1], ids[2]]);
    const refined = await images.listPage(postId, { limit: 10, offset: 0, origin: 'bg_refined' });
    expect(refined.total).toBe(1);
    expect(refined.items[0]!.id).toBe(ids[4]);
  });

  it('breakdown returns the stored prompt and the linked run steps; no runId -> empty steps', async () => {
    const bare = await images.breakdown(ids[0]!);
    expect(bare.steps).toEqual([]);
    const [run] = await db.insert(runs).values({ engine: 'claude', kind: 'image_hybrid', model: 'm', prompt: 'the augmented brief', postId }).returning();
    await runsSvc.addStep({
      runId: run!.id, seq: 1, kind: 'image_plan', engine: 'claude', model: 'm',
      prompt: 'plan it', output: '{"plan":true}', startedAt: new Date(), finishedAt: new Date(),
    });
    const [linked] = await db.insert(assets).values({
      postId, lane: 'hybrid', pngPath: 'linked.png', width: 1, height: 1, candidateGroupId: 'gl',
      generationPrompt: 'the augmented brief', runId: run!.id,
    }).returning();
    const bd = await images.breakdown(linked!.id);
    expect(bd.generationPrompt).toBe('the augmented brief');
    expect(bd.runId).toBe(run!.id);
    expect(bd.steps.map((s) => [s.seq, s.kind])).toEqual([[1, 'image_plan']]);
  });

  it('a launchHybrid-produced asset carries its run id and origin generated', async () => {
    const [post2] = await db.insert(posts).values({ tier: 'T1' }).returning();
    const launch = await compose.launchHybrid(post2!.id, 'lineage brief');
    await launch.finished;
    const all = await images.listForPost(post2!.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.runId).toBe(launch.runId);   // spec §1b: the archaeology-ending FK
    expect(all[0]!.origin).toBe('generated');
    const bd = await images.breakdown(all[0]!.id);
    expect(bd.steps.map((s) => s.kind)).toEqual(['image_plan', 'image_gen', 'image_html']);
  });
});
