import { beforeAll, describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
import { RunnerModule } from '../src/runner/runner.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';
import { ImageRefineService } from '../src/images/image-refine.service';
import { candidateDir, newGroupId, writePng } from '../src/images/asset-store';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { RENDERER, type Renderer } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

/** FakeRenderer ignores its arguments, so a spy is the only way to see WHICH background got composited. */
class RecordingRenderer implements Renderer {
  readonly htmls: string[] = [];
  render(html: string): Promise<Buffer> {
    this.htmls.push(html);
    return new FakeRenderer().render();
  }
}

function png1200(extra = 0): Buffer {
  const b = Buffer.alloc(24 + extra);           // trailing bytes distinguish patch from source
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(1200, 20);
  return b;
}

const TOKEN_HTML = "<!doctype html><html><body style=\"background-image:url('__HYBRID_BG__')\"><h1>ORIGINAL</h1></body></html>";
const EDITED_HTML = "<!doctype html><html><body style=\"background-image:url('__HYBRID_BG__')\"><h1 style=\"position:absolute;left:40px;top:60px\">MOVED</h1></body></html>";

describe('V2 canvas edit with a patched background', () => {
  let db: ForgeDb;
  let refine: ImageRefineService;
  let images: ImagesService;
  let posts: PostsService;
  const renderer = new RecordingRenderer();

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .overrideProvider(RENDERER).useValue(renderer)
      .compile();
    db = mod.get(DB);
    refine = mod.get(ImageRefineService);
    images = mod.get(ImagesService);
    posts = mod.get(PostsService);
  });

  async function seedSource() {
    const post = await posts.create({ tier: 'T1' });
    const dir = candidateDir(post.id, newGroupId());
    const png = await writePng(dir, 0, png1200());
    await writeFile(join(dir, 'bg.png'), png1200());
    const asset = await images.create({
      postId: post.id, lane: 'hybrid', htmlSource: TOKEN_HTML, generationPrompt: 'the brief',
      pngPath: png, width: 1200, height: 1200, candidateGroupId: 'v2-src-' + newGroupId().slice(0, 8),
    });
    return { post, asset };
  }

  async function seedPatchRun(postId: number, withFile: boolean, kind = 'image_refine' as const) {
    const [run] = await db.insert(runs).values({
      engine: 'codex', kind, model: 'm', prompt: 'patch it', postId, status: 'succeeded',
    }).returning();
    if (withFile) {
      const dir = candidateDir(postId, 'patch-' + run!.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'bg.png'), png1200(64));
    }
    return run!;
  }

  it('composites the PATCH background, copies it into the child dir, and lands bg_refined with runId', async () => {
    const { post, asset } = await seedSource();
    const run = await seedPatchRun(post.id, true);
    const child = await refine.applyCanvasEdit(asset.id, EDITED_HTML, run.id);
    expect(child.origin).toBe('bg_refined');
    expect(child.runId).toBe(run.id);
    expect(child.sourceAssetId).toBe(asset.id);
    expect(child.htmlSource).toBe(EDITED_HTML);
    expect(child.generationPrompt).toBe('patch it');   // bg_refined provenance = the refine instruction
    const childBg = await readFile(join(dirname(child.pngPath!), 'bg.png'));
    expect(childBg.length).toBe(24 + 64);       // the PATCH file (88 bytes), not the source (24)
    // The composite itself rendered over the PATCH background — the copied file alone can't prove that.
    expect(renderer.htmls.at(-1)).toContain('data:image/png;base64,' + png1200(64).toString('base64'));
  });

  it('422s each bad bgRunId with a named reason, before any file work', async () => {
    const { post, asset } = await seedSource();
    await expect(refine.applyCanvasEdit(asset.id, EDITED_HTML, 99_999_999))
      .rejects.toThrow(UnprocessableEntityException);            // run does not exist
    const wrongKind = await seedPatchRun(post.id, true, 'draft' as never);
    await expect(refine.applyCanvasEdit(asset.id, EDITED_HTML, wrongKind.id))
      .rejects.toThrow(UnprocessableEntityException);            // not an image_refine run
    const other = await posts.create({ tier: 'T1' });
    const crossPost = await seedPatchRun(other.id, true);
    await expect(refine.applyCanvasEdit(asset.id, EDITED_HTML, crossPost.id))
      .rejects.toThrow(UnprocessableEntityException);            // another post's background
    const noFile = await seedPatchRun(post.id, false);
    await expect(refine.applyCanvasEdit(asset.id, EDITED_HTML, noFile.id))
      .rejects.toThrow(UnprocessableEntityException);            // patch bg.png unreadable
    expect(await images.listForPost(post.id)).toHaveLength(1);   // validation ran before any child landed
  });
});
