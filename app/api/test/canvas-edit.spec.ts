import { beforeAll, describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
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
import { candidateDir, newGroupId, readPngSize, writePng } from '../src/images/asset-store';
import { ENGINES } from '../src/engines/engine.interface';
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

const TOKEN_HTML = "<!doctype html><html><body style=\"background-image:url('__HYBRID_BG__')\"><h1>ORIGINAL</h1></body></html>";
const EDITED_HTML = "<!doctype html><html><body style=\"background-image:url('__HYBRID_BG__')\"><h1 style=\"position:absolute;left:40px;top:60px;color:#fff\">MOVED</h1></body></html>";

describe('B4a canvas edit', () => {
  let refine: ImageRefineService;
  let images: ImagesService;
  let posts: PostsService;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, ImagesModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .overrideProvider(RENDERER).useValue(new FakeRenderer())
      .compile();
    refine = mod.get(ImageRefineService);
    images = mod.get(ImagesService);
    posts = mod.get(PostsService);
  });

  async function seedSource() {
    const post = await posts.create({ tier: 'T1' });
    const dir = candidateDir(post.id, newGroupId());
    const png = await writePng(dir, 0, png1200());
    await writeFile(join(dir, 'bg.png'), png1200());
    return images.create({
      postId: post.id, lane: 'hybrid', htmlSource: TOKEN_HTML, generationPrompt: 'the brief',
      pngPath: png, width: 1200, height: 1200, candidateGroupId: 'cv-src',
    });
  }

  it('editable-html substitutes the bg and hands back the data uri for reversal', async () => {
    const src = await seedSource();
    const { html, bgDataUri } = await refine.editableHtml(src.id);
    expect(bgDataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(html).not.toContain('__HYBRID_BG__');
    expect(html).toContain(bgDataUri);
    expect(html.split(bgDataUri).join('__HYBRID_BG__')).toBe(TOKEN_HTML); // reversal round-trips
  });

  it('applyCanvasEdit lands a canvas_edited child with a copied bg.png and no run', async () => {
    const src = await seedSource();
    const child = await refine.applyCanvasEdit(src.id, EDITED_HTML);
    expect(child.origin).toBe('canvas_edited');
    expect(child.sourceAssetId).toBe(src.id);
    expect(child.runId).toBeNull();
    expect(child.htmlSource).toBe(EDITED_HTML);
    expect(child.generationPrompt).toBe('the brief');
    expect(child.candidateGroupId).not.toBe(src.candidateGroupId);
    expect(await readPngSize(join(dirname(child.pngPath!), 'bg.png'))).toEqual({ w: 1200, h: 1200 }); // bg copied
    expect((await readFile(child.pngPath!)).length).toBeGreaterThan(0);
  });

  it('422s a payload that still contains the substituted data uri (missing token)', async () => {
    const src = await seedSource();
    const bad = EDITED_HTML.replace('__HYBRID_BG__', 'data:image/png;base64,AAAA');
    await expect(refine.applyCanvasEdit(src.id, bad)).rejects.toThrow(UnprocessableEntityException);
  });
});
