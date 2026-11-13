import { renderPrompt } from '@forge/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { DB, type ForgeDb } from '../src/db/client';
import { runs } from '../src/db/schema';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { RunnerModule } from '../src/runner/runner.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';
import { ImageRefineService } from '../src/images/image-refine.service';
import { bgPathFor, candidateDir, newGroupId, writePng } from '../src/images/asset-store';
import { ENGINES } from '../src/engines/engine.interface';
import type { Engine, EngineRequest, EngineResult } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';

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
  readonly requests: EngineRequest[] = [];
  async run(req: EngineRequest): Promise<EngineResult> {
    this.requests.push(req);
    if (req.cwd) await writeFile(join(req.cwd, 'bg.png'), png1200());
    return { output: 'bg written' };
  }
}

const TOKEN_HTML = "<!doctype html><html><body style=\"background-image:url('__HYBRID_BG__')\"><h1>KEEP ME</h1></body></html>";

describe('V1 background patch', () => {
  let db: ForgeDb;
  let refine: ImageRefineService;
  let images: ImagesService;
  let posts: PostsService;
  let runsSvc: RunsService;
  let codex: BgWritingEngine;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    codex = new BgWritingEngine();
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex })
      .overrideProvider(RENDERER).useValue(new FakeRenderer())
      .compile();
    db = mod.get(DB);
    refine = mod.get(ImageRefineService);
    images = mod.get(ImagesService);
    posts = mod.get(PostsService);
    runsSvc = mod.get(RunsService);
  });

  async function seedSource() {
    const post = await posts.create({ tier: 'T1' });
    const dir = candidateDir(post.id, newGroupId());
    const png = await writePng(dir, 0, png1200());
    await writeFile(join(dir, 'bg.png'), png1200());
    const asset = await images.create({
      postId: post.id, lane: 'hybrid', htmlSource: TOKEN_HTML, generationPrompt: 'orig brief',
      pngPath: png, width: 1200, height: 1200, candidateGroupId: 'src-g',
    });
    return { post, asset, sourceBg: bgPathFor(png) };
  }

  it('attaches the SOURCE bg, lands bg.png in the patch dir, and creates NO asset row', async () => {
    const { post, asset, sourceBg } = await seedSource();
    const launch = await refine.launchBgPatch(asset.id, 'remove the artifact top-left');
    await launch.finished;

    const req = codex.requests.find((r) => r.kind === 'image_gen')!;
    expect(req.images).toEqual([sourceBg]);                       // deliberate single-candidate attach
    expect(renderPrompt(req)).toContain('remove the artifact top-left');
    expect(renderPrompt(req)).not.toContain('base64');                   // no data URI near a prompt
    expect(req.cwd).toBe(candidateDir(post.id, 'patch-' + launch.runId));

    const run = await runsSvc.get(launch.runId);
    expect(run.kind).toBe('image_refine');
    expect(run.status).toBe('succeeded');

    const all = await images.listForPost(post.id);
    expect(all).toHaveLength(1);                                  // source only — the patch made no candidate
    expect(all[0]!.id).toBe(asset.id);

    const { bgDataUri } = await refine.patchedBg(launch.runId);
    expect(bgDataUri.startsWith('data:image/png;base64,')).toBe(true);
    const onDisk = await readFile(join(candidateDir(post.id, 'patch-' + launch.runId), 'bg.png'));
    expect(bgDataUri).toBe('data:image/png;base64,' + onDisk.toString('base64'));
  });

  it('422s when the source has no readable bg.png', async () => {
    const post = await posts.create({ tier: 'T1' });
    const dir = candidateDir(post.id, newGroupId());
    const png = await writePng(dir, 0, png1200()); // NO bg.png sibling
    const noBg = await images.create({
      postId: post.id, lane: 'hybrid', htmlSource: TOKEN_HTML, pngPath: png,
      width: 1200, height: 1200, candidateGroupId: 'nobg-g',
    });
    await expect(refine.launchBgPatch(noBg.id, 'x')).rejects.toThrow(UnprocessableEntityException);
  });

  it('patchedBg: 404 unknown run, 404 while running, 422 for a failed run', async () => {
    await expect(refine.patchedBg(99_999_999)).rejects.toThrow(NotFoundException);
    const post = await posts.create({ tier: 'T1' });
    const [running] = await db.insert(runs).values({
      engine: 'codex', kind: 'image_refine', model: 'm', prompt: 'p', postId: post.id,
    }).returning();
    await expect(refine.patchedBg(running!.id)).rejects.toThrow(NotFoundException);
    const [failed] = await db.insert(runs).values({
      engine: 'codex', kind: 'image_refine', model: 'm', prompt: 'p', postId: post.id,
      status: 'failed', error: 'engine exploded',
    }).returning();
    await expect(refine.patchedBg(failed!.id)).rejects.toThrow(UnprocessableEntityException);
  });
});
