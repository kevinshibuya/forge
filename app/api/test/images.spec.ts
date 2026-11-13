import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
// Static import is safe here: assetsRoot() reads process.env.ASSETS_ROOT LAZILY (at call time),
// not at module load, so setting the env var below still governs every call in this file.
// (A top-level `await import(...)` was avoided — this package is CJS under NodeNext and tsc
// rejects top-level await there.)
import * as store from '../src/images/asset-store';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { ImagesModule } from '../src/images/images.module';
import { ImagesService } from '../src/images/images.service';

const ROOT = mkdtempSync(join(tmpdir(), 'forge-assets-'));
process.env.ASSETS_ROOT = ROOT;

describe('asset-store', () => {
  it('candidateDir is under the configured root', () => {
    expect(store.candidateDir(7, 'grp')).toBe(join(ROOT, '7', 'grp'));
  });

  it('writePng + listPngs round-trip, sorted', async () => {
    const dir = store.candidateDir(7, 'grp');
    const p1 = await store.writePng(dir, 1, Buffer.from('a'));
    const p0 = await store.writePng(dir, 0, Buffer.from('b'));
    expect(p0.endsWith('0.png')).toBe(true);
    const list = await store.listPngs(dir);
    expect(list).toEqual([join(dir, '0.png'), join(dir, '1.png')]);
    void p1;
  });

  it('resolveAssetFile accepts a path under the assets root', () => {
    const dir = store.candidateDir(7, 'grp');
    expect(store.resolveAssetFile(join(dir, '0.png'))).toBe(join(dir, '0.png'));
  });

  it('resolveAssetFile rejects a traversal escape', () => {
    expect(() => store.resolveAssetFile(join(ROOT, '..', '..', 'etc', 'passwd'))).toThrow(NotFoundException);
  });

  // Fix F: a symlink that lives INSIDE the root but points OUTSIDE it passes a purely lexical check
  // yet must be rejected — canonicalization catches it.
  it('resolveAssetFile rejects a symlink inside the root that points outside', () => {
    const outside = join(tmpdir(), `forge-escape-${Date.now()}.txt`);
    writeFileSync(outside, 'secret');
    const linkDir = store.candidateDir(99, 'linkgrp');
    mkdirSync(linkDir, { recursive: true });
    const link = join(linkDir, 'escape.png');
    symlinkSync(outside, link);
    expect(() => store.resolveAssetFile(link)).toThrow(NotFoundException);
  });

  // Last in this describe on purpose: ROOT is shared by every case above, and the chain above is
  // order-dependent on post 7. These cases use posts 21 and 22 only.
  it("removePostAssets removes a post's directory whole, every group under it, and leaves its sibling", async () => {
    await store.writePng(store.candidateDir(21, 'g'), 0, Buffer.from('a'));
    await store.writePng(store.candidateDir(21, 'h'), 0, Buffer.from('b'));
    await store.writePng(store.candidateDir(22, 'g'), 0, Buffer.from('c'));
    await store.removePostAssets(21);
    expect(existsSync(join(ROOT, '21'))).toBe(false);
    expect(existsSync(join(store.candidateDir(22, 'g'), '0.png'))).toBe(true);
  });

  it('removePostAssets is a no-op on a directory that is already gone', async () => {
    await expect(store.removePostAssets(21)).resolves.toBeUndefined();
  });

  it('removePostAssets refuses an id that could join to the root itself', async () => {
    const nanDir = join(ROOT, 'NaN');
    mkdirSync(nanDir, { recursive: true });
    for (const id of [0, -1, 1.5, NaN]) {
      await expect(store.removePostAssets(id)).rejects.toThrow(String(id));
    }
    expect(existsSync(nanDir)).toBe(true);
    expect(existsSync(join(ROOT, '22'))).toBe(true);
  });
});

const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

async function buildImages() {
  const mod = await Test.createTestingModule({
    imports: [DbModule, EmbeddingsModule, RunsModule, PostsModule, ImagesModule],
  }).overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider()).compile();
  return { images: mod.get(ImagesService), posts: mod.get(PostsService) };
}

describe('ImagesService', () => {
  beforeAll(async () => { await migrateDb(dbUrl); process.env.DATABASE_URL = dbUrl; });

  it('selecting a candidate is exclusive per post', async () => {
    const { images, posts } = await buildImages();
    const post = await posts.create({ tier: 'T1' });
    const dir = store.candidateDir(post.id, 'g1');
    const a = await images.create({ postId: post.id, lane: 'html', htmlSource: '<i>a</i>', pngPath: await store.writePng(dir, 0, Buffer.from('a')), width: 1200, height: 1200, candidateGroupId: 'g1' });
    const b = await images.create({ postId: post.id, lane: 'raster', generationPrompt: 'p', pngPath: await store.writePng(dir, 1, Buffer.from('b')), width: 1200, height: 1200, candidateGroupId: 'g1' });

    await images.select(post.id, a.id);
    await images.select(post.id, b.id);
    const list = await images.listForPost(post.id);
    expect(list.find((x) => x.id === a.id)!.isSelected).toBe(false);
    expect(list.find((x) => x.id === b.id)!.isSelected).toBe(true);
  });

  it('remove deletes the row', async () => {
    const { images, posts } = await buildImages();
    const post = await posts.create({ tier: 'T2' });
    const dir = store.candidateDir(post.id, 'g2');
    const a = await images.create({ postId: post.id, lane: 'html', htmlSource: '<i>x</i>', pngPath: await store.writePng(dir, 0, Buffer.from('x')), width: 1200, height: 1200, candidateGroupId: 'g2' });
    await images.remove(post.id, a.id);
    expect(await images.listForPost(post.id)).toHaveLength(0);
  });
});
