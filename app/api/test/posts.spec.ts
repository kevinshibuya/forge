import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BadRequestException, ConflictException, NotFoundException, type INestApplication } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService, dedupAppend } from '../src/posts/posts.service';
import { BodySchema } from '../src/posts/posts.controller';
import {
  assets, dimPost, embeddingJobs, embeddings, factPostLifetime, ideas, postInputs, postRevisions, posts, runs,
} from '../src/db/schema';
import { RunsService } from '../src/runs/runs.service';
import { inputsRoot, writeStored } from '../src/inputs/inputs-store';
import { assetsRoot, candidateDir, writePng } from '../src/images/asset-store';
import type { Source } from '@forge/shared';
import { insertMeasured } from './helpers/measured';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('PostsService', () => {
  let svc: PostsService;
  let app: INestApplication;
  const db = createDb(url);

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    svc = mod.get(PostsService);
    await db.delete(postRevisions);
    await db.delete(embeddings).where(eq(embeddings.sourceType, 'post'));
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('lists a post titled by its promoted idea, with the selected asset alongside', async () => {
    const post = await svc.create({ tier: 'T2' });
    await db.insert(ideas).values({ rawText: 'the idea that became this post', source: 'work', status: 'promoted', promotedPostId: post.id });
    const [before] = (await svc.list()).filter((p) => p.id === post.id);
    expect(before!.ideaText).toBe('the idea that became this post');
    expect(before!.selectedAsset).toBeNull();

    await db.insert(assets).values({ postId: post.id, lane: 'html', width: 1200, height: 1200, isSelected: false });
    const [selected] = await db.insert(assets).values({ postId: post.id, lane: 'hybrid', width: 1200, height: 628, isSelected: true }).returning();
    const [after] = (await svc.list()).filter((p) => p.id === post.id);
    expect(after!.selectedAsset).toEqual({ id: selected!.id, width: 1200, height: 628 });
  });

  it('lists one row per post even when two ideas point at it, and null with no idea', async () => {
    const post = await svc.create({ tier: 'T3' });
    await db.insert(ideas).values({ rawText: 'first idea', source: 'work', status: 'promoted', promotedPostId: post.id });
    await db.insert(ideas).values({ rawText: 'second idea', source: 'work', status: 'promoted', promotedPostId: post.id });
    const rows = (await svc.list()).filter((p) => p.id === post.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ideaText).toBe('second idea');

    const bare = await svc.create({ tier: 'T3' });
    const [row] = (await svc.list()).filter((p) => p.id === bare.id);
    expect(row!.ideaText).toBeNull();
  });

  it('walks the full lifecycle queued → measured', async () => {
    const post = await svc.create({ tier: 'T2' });
    expect(post.status).toBe('queued');

    await svc.updateBody(post.id, { body: 'first body', source: 'run:1' });
    await svc.updateBody(post.id, { body: 'edited body', source: 'manual_edit' });
    const { revisions } = await svc.detail(post.id);
    expect(revisions.map((r) => r.source)).toEqual(['manual_edit', 'run:1']);

    const embRows = await db.select().from(embeddings)
      .where(eq(embeddings.sourceId, post.id));
    expect(embRows.filter((e) => e.sourceType === 'post')).toHaveLength(1);

    await expect(svc.approve(post.id)).rejects.toThrow(); // still queued
    await svc.beginDrafting(post.id);
    await svc.endDrafting(post.id); // has body → draft_ready
    expect((await svc.get(post.id)).hook).toBe('edited body'); // derived, not picked
    await svc.approve(post.id); // body-only gate
    await expect(svc.publish(post.id, { linkedinUrl: '' })).rejects.toThrow(); // empty url
    await svc.publish(post.id, { linkedinUrl: 'https://linkedin.com/posts/x' });
    await svc.markMeasured(post.id);
    await svc.markMeasured(post.id); // idempotent no-op
    expect((await svc.get(post.id)).status).toBe('measured');
    await expect(svc.updateBody(post.id, { body: 'too late', source: 'manual_edit' })).rejects.toThrow(); // measured posts are final
  });

  it('endDrafting falls back to queued when no body exists', async () => {
    const post = await svc.create({ tier: 'T3' });
    await svc.beginDrafting(post.id);
    await svc.endDrafting(post.id);
    expect((await svc.get(post.id)).status).toBe('queued');
  });

  it('restoreRevision writes a new manual_edit revision with the old body', async () => {
    const post = await svc.create({ tier: 'T1' });
    await svc.updateBody(post.id, { body: 'v1', source: 'run:9' });
    await svc.updateBody(post.id, { body: 'v2', source: 'manual_edit' });
    const { revisions } = await svc.detail(post.id);
    const v1 = revisions.find((r) => r.body === 'v1')!;
    await svc.restoreRevision(post.id, v1.id);
    const after = await svc.detail(post.id);
    expect(after.post.bodyLinkedin).toBe('v1');
    expect(after.post.hook).toBe('v1');
    expect(after.revisions).toHaveLength(3);
    await expect(svc.restoreRevision(post.id, 999999)).rejects.toThrow();
  });

  it('finds by url', async () => {
    const found = await svc.findByUrl('https://linkedin.com/posts/x');
    expect(found).not.toBeNull();
    expect(await svc.findByUrl('https://nope')).toBeNull();
  });

  it('PATCH /posts/:id persists imagePrompt (and allows clearing it)', async () => {
    const post = await svc.create({ tier: 'T1' });
    const res = await request(app.getHttpServer())
      .patch(`/api/posts/${post.id}`)
      .send({ imagePrompt: 'a gate holding a drifting request, dark ink, one accent' })
      .expect(200);
    expect(res.body.imagePrompt).toBe('a gate holding a drifting request, dark ink, one accent');
    expect((await svc.get(post.id)).imagePrompt).toBe('a gate holding a drifting request, dark ink, one accent');
    await request(app.getHttpServer()).patch(`/api/posts/${post.id}`).send({ imagePrompt: '' }).expect(200);
    expect((await svc.get(post.id)).imagePrompt).toBe('');
  });

  it('updateBody derives the hook from the first non-empty line and embeds body-only', async () => {
    const post = await svc.create({ tier: 'T2' });
    const body = '\n\n  the gate the model cannot route around  \nrest of the body';
    await svc.updateBody(post.id, { body, source: 'manual_edit' });
    expect((await svc.get(post.id)).hook).toBe('the gate the model cannot route around');
    const embRows = await db.select().from(embeddings).where(eq(embeddings.sourceId, post.id));
    const postEmb = embRows.filter((e) => e.sourceType === 'post');
    expect(postEmb).toHaveLength(1);
    expect(postEmb[0]!.chunkText).toBe(body); // no [hook, body] double-count
  });


  describe('the measured gate, closed whole', () => {
    it('refuses a meta patch on a measured post, through the http edge', async () => {
      const [post] = await db.insert(posts).values({
        tier: 'T3', status: 'published', hook: 'throwaway for the patchMeta gate',
        bodyLinkedin: 'a body the spec never reads',
      }).returning();
      await insertMeasured(db, svc, {
        postId: post!.id, impressions: 10, reactions: 1, comments: 0, reposts: 0, saves: 0,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/posts/${post!.id}`).send({ hashtags: ['#late'] });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('post is measured; its body is final');

      // The refusal is a refusal, not a partial write.
      const [after] = await db.select().from(posts).where(eq(posts.id, post!.id));
      expect(after!.hashtags).toEqual([]);
    });

    it('still patches meta on a post that is not measured', async () => {
      const [post] = await db.insert(posts).values({
        tier: 'T3', status: 'draft_ready', hook: 'still editable',
        bodyLinkedin: 'a body the spec never reads',
      }).returning();
      const updated = await svc.patchMeta(post!.id, { hashtags: ['#fine'] });
      expect(updated.hashtags).toEqual(['#fine']);
    });

    it('still 404s a meta patch on a post that is not there', async () => {
      await expect(svc.patchMeta(999_999, { hashtags: [] })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PostsService.remove', () => {
    const made: number[] = [];

    afterAll(async () => {
      // forge_test is shared, and an input row left behind would block a later spec that wipes
      // posts. The measured post keeps its input through the refusal by design.
      if (made.length > 0) await db.delete(postInputs).where(inArray(postInputs.postId, made));
    });

    async function freshPost(): Promise<number> {
      const post = await svc.create({ tier: 'T3' });
      made.push(post.id);
      return post.id;
    }
    const runsSvc = () => app.get(RunsService);
    const embeddingsOf = (id: number) => db.select().from(embeddings)
      .where(and(eq(embeddings.sourceType, 'post'), eq(embeddings.sourceId, id)));
    const jobsOf = (id: number) => db.select().from(embeddingJobs)
      .where(and(eq(embeddingJobs.sourceType, 'post'), eq(embeddingJobs.sourceId, id)));
    async function attachInput(id: number): Promise<string> {
      const [input] = await db.insert(postInputs)
        .values({ postId: id, kind: 'file', ref: 'notes.md', bytes: 5 }).returning();
      return writeStored(id, input!.id, 'file', 'notes.md', 'hello');
    }

    it('deletes the post and what it owns, keeps its run, returns its ideas to the backlog', async () => {
      const id = await freshPost();
      await db.update(posts).set({ status: 'draft_ready' }).where(eq(posts.id, id));
      await svc.updateBody(id, { body: 'a body', source: 'manual_edit' });
      await db.insert(embeddingJobs).values({ sourceType: 'post', sourceId: id, chunks: ['a body'] });
      await attachInput(id);
      const runId = await runsSvc().start({ engine: 'claude', kind: 'draft', model: 'm', prompt: 'p', postId: id });
      await runsSvc().succeed(runId, 'out', true);
      const png = await writePng(candidateDir(id, 'g1'), 0, Buffer.from('a'));
      const [assetA] = await db.insert(assets).values({ postId: id, lane: 'raster', runId, pngPath: png }).returning();
      await db.insert(assets).values({ postId: id, lane: 'raster', sourceAssetId: assetA!.id });
      await db.update(posts).set({ referenceAssetId: assetA!.id }).where(eq(posts.id, id));
      const [tiered] = await db.insert(ideas).values({
        rawText: 'tiered idea', source: 'work', status: 'promoted', promotedPostId: id, suggestedTier: 'T2',
      }).returning();
      const [plain] = await db.insert(ideas).values({
        rawText: 'untiered idea', source: 'work', status: 'promoted', promotedPostId: id,
      }).returning();

      // An absence proves nothing on a fixture that never existed.
      expect(await db.select().from(postRevisions).where(eq(postRevisions.postId, id))).toHaveLength(1);
      expect(await embeddingsOf(id)).toHaveLength(1);
      expect(await jobsOf(id)).toHaveLength(1);
      expect(existsSync(join(inputsRoot(), String(id)))).toBe(true);
      expect(existsSync(join(assetsRoot(), String(id)))).toBe(true);

      await expect(svc.remove(id)).resolves.toBeUndefined();

      await expect(svc.get(id)).rejects.toThrow(NotFoundException);
      expect(await db.select().from(postRevisions).where(eq(postRevisions.postId, id))).toHaveLength(0);
      expect(await db.select().from(postInputs).where(eq(postInputs.postId, id))).toHaveLength(0);
      expect(await db.select().from(assets).where(eq(assets.postId, id))).toHaveLength(0);
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(run!.status).toBe('succeeded');
      expect(run!.postId).toBeNull();
      expect(await embeddingsOf(id)).toHaveLength(0);
      expect(await jobsOf(id)).toHaveLength(0);
      const [t] = await db.select().from(ideas).where(eq(ideas.id, tiered!.id));
      const [n] = await db.select().from(ideas).where(eq(ideas.id, plain!.id));
      expect(t).toMatchObject({ status: 'triaged', promotedPostId: null });
      expect(n).toMatchObject({ status: 'new', promotedPostId: null });
      expect(existsSync(join(inputsRoot(), String(id)))).toBe(false);
      expect(existsSync(join(assetsRoot(), String(id)))).toBe(false);
    });

    it('refuses a measured post and leaves every row and file in place', async () => {
      const id = await freshPost();
      await svc.beginDrafting(id);
      await svc.updateBody(id, { body: 'measured body', source: 'manual_edit' });
      await svc.endDrafting(id);
      await svc.approve(id);
      await svc.publish(id, { linkedinUrl: `https://linkedin.com/posts/delete-measured-${id}` });
      await insertMeasured(db, svc, { postId: id, impressions: 1, reactions: 0, comments: 0, reposts: 0, saves: 0 });
      const stored = await attachInput(id);
      const png = await writePng(candidateDir(id, 'g1'), 0, Buffer.from('a'));
      await db.insert(assets).values({ postId: id, lane: 'raster', pngPath: png });
      const runId = await runsSvc().start({ engine: 'claude', kind: 'draft', model: 'm', prompt: 'p', postId: id });
      await runsSvc().succeed(runId, 'out', true);
      await db.insert(embeddingJobs).values({ sourceType: 'post', sourceId: id, chunks: ['measured body'] });
      const [idea] = await db.insert(ideas).values({
        rawText: 'measured idea', source: 'work', status: 'promoted', promotedPostId: id,
      }).returning();

      await expect(svc.remove(id)).rejects.toThrow(new ConflictException('post is measured; its record is final'));

      expect((await svc.get(id)).status).toBe('measured');
      expect(await db.select().from(postRevisions).where(eq(postRevisions.postId, id))).not.toHaveLength(0);
      expect(await db.select().from(postInputs).where(eq(postInputs.postId, id))).toHaveLength(1);
      expect(await db.select().from(assets).where(eq(assets.postId, id))).toHaveLength(1);
      expect((await db.select().from(runs).where(eq(runs.id, runId)))[0]!.postId).toBe(id);
      expect(await embeddingsOf(id)).toHaveLength(1);
      expect(await jobsOf(id)).toHaveLength(1);
      expect((await db.select().from(ideas).where(eq(ideas.id, idea!.id)))[0])
        .toMatchObject({ status: 'promoted', promotedPostId: id });
      const dims = await db.select().from(dimPost).where(eq(dimPost.postId, id));
      expect(dims).toHaveLength(1);
      expect(await db.select().from(factPostLifetime).where(eq(factPostLifetime.postUrn, dims[0]!.postUrn)))
        .not.toHaveLength(0);
      // What escapes the transaction is the directory removal after it: this is the assertion
      // that can go red.
      expect(existsSync(stored)).toBe(true);
      expect(existsSync(png)).toBe(true);
    });

    it('refuses a post with a run in flight, and allows it once the run has finished', async () => {
      const id = await freshPost();
      const runId = await runsSvc().start({ engine: 'claude', kind: 'draft', model: 'm', prompt: 'p', postId: id });
      await expect(svc.remove(id)).rejects.toThrow(new ConflictException(`post ${id} has run ${runId} in flight`));
      await runsSvc().succeed(runId, 'out', true);
      await expect(svc.remove(id)).resolves.toBeUndefined();
    });

    it('404s an unknown id', async () => {
      await expect(svc.remove(999999)).rejects.toThrow(NotFoundException);
    });

    it("clears another post's pin on one of the deleted post's candidates", async () => {
      const postAId = await freshPost();
      const postBId = await freshPost();
      const [assetA] = await db.insert(assets).values({ postId: postAId, lane: 'hybrid' }).returning();
      // Bypasses setReference's bg.png check on purpose: the cycle is the point, not the file.
      await db.update(posts).set({ referenceAssetId: assetA!.id }).where(eq(posts.id, postBId));
      await svc.remove(postAId);
      expect((await svc.get(postBId)).referenceAssetId).toBeNull();
    });

    it('never touches a png outside the assets root', async () => {
      const id = await freshPost();
      const legacyDir = await mkdtemp(join(tmpdir(), 'forge-legacy-'));
      const legacy = join(legacyDir, 'legacy.png');
      await writeFile(legacy, 'png');
      await db.insert(assets).values({ postId: id, lane: 'raster', pngPath: legacy });
      await svc.remove(id);
      await expect(svc.get(id)).rejects.toThrow(NotFoundException);
      expect(existsSync(legacy)).toBe(true);
    });
  });

});

// readPngSize inspects only the 24-byte signature + IHDR — this is a sufficient PNG fixture.
function pngBuf(): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12);
  b.writeUInt32BE(1200, 16); b.writeUInt32BE(1200, 20);
  return b;
}

describe('post reference image', () => {
  let postId: number; let otherPostId: number;
  let assetId: number; let htmlAssetId: number; let hybridNoBgId: number;
  let otherSelectedId: number; let otherUnselectedId: number;
  let app: INestApplication;
  const db = createDb(url);

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    const svc = mod.get(PostsService);
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    postId = (await svc.create({ tier: 'T1' })).id;
    otherPostId = (await svc.create({ tier: 'T1' })).id;
    const withBg = await mkdtemp(join(tmpdir(), 'ref-a-'));   // hybrid + bg.png (eligible)
    await writeFile(join(withBg, '0.png'), pngBuf());
    await writeFile(join(withBg, 'bg.png'), pngBuf());
    const noBg = await mkdtemp(join(tmpdir(), 'ref-b-'));     // hybrid, NO bg.png
    await writeFile(join(noBg, '0.png'), pngBuf());
    const otherDir = await mkdtemp(join(tmpdir(), 'ref-c-')); // other post's selected winner
    await writeFile(join(otherDir, '0.png'), pngBuf());
    await writeFile(join(otherDir, 'bg.png'), pngBuf());

    const ins = async (v: typeof assets.$inferInsert) =>
      (await db.insert(assets).values(v).returning())[0]!.id;
    assetId = await ins({ postId, lane: 'hybrid', pngPath: join(withBg, '0.png') });
    htmlAssetId = await ins({ postId, lane: 'html', pngPath: join(withBg, '0.png') });
    hybridNoBgId = await ins({ postId, lane: 'hybrid', pngPath: join(noBg, '0.png') });
    otherSelectedId = await ins({ postId: otherPostId, lane: 'hybrid', pngPath: join(otherDir, '0.png'), isSelected: true });
    otherUnselectedId = await ins({ postId: otherPostId, lane: 'hybrid', pngPath: join(otherDir, '0.png') });
  });

  it('PATCH sets a valid hybrid reference and GET echoes referenceAssetId', async () => {
    const res = await request(app.getHttpServer()).patch(`/api/posts/${postId}/reference`).send({ assetId }).expect(200);
    expect(res.body.referenceAssetId).toBe(assetId);
    const detail = await request(app.getHttpServer()).get(`/api/posts/${postId}`).expect(200);
    expect(detail.body.post.referenceAssetId).toBe(assetId);
  });

  it('PATCH null clears the reference', async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${postId}/reference`).send({ assetId: null }).expect(200);
    const detail = await request(app.getHttpServer()).get(`/api/posts/${postId}`).expect(200);
    expect(detail.body.post.referenceAssetId).toBeNull();
  });

  it('rejects non-hybrid lanes with 422', async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${postId}/reference`).send({ assetId: htmlAssetId }).expect(422);
  });

  it('rejects a hybrid asset whose bg.png is missing with 422', async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${postId}/reference`).send({ assetId: hybridNoBgId }).expect(422);
  });

  it("allows borrowing another post's hybrid asset", async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${otherPostId}/reference`).send({ assetId }).expect(200);
  });

  it("reference-candidates lists own hybrids + other posts' selected hybrids", async () => {
    const res = await request(app.getHttpServer()).get(`/api/posts/${postId}/reference-candidates`).expect(200);
    const ids = res.body.map((c: { assetId: number }) => c.assetId);
    expect(ids).toContain(assetId);            // own hybrid
    expect(ids).toContain(hybridNoBgId);       // own hybrid (listing doesn't require bg — set-time validates)
    expect(ids).toContain(otherSelectedId);    // other post's SELECTED hybrid
    expect(ids).not.toContain(otherUnselectedId);
    expect(ids).not.toContain(htmlAssetId);
  });
});

describe('PostsService — sources travel with the body', () => {
  let svc: PostsService;
  const db = createDb(url);
  const A: Source = { kind: 'web', ref: 'https://a', note: 'the first' };
  const B: Source = { kind: 'file', ref: 'notes.md', note: 'the second' };

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({ imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    svc = mod.get(PostsService);
  });

  it('a body-only save leaves the list alone and snapshots it', async () => {
    const post = await svc.create({ tier: 'T1' });
    await svc.updateBody(post.id, { sources: [A], source: 'manual_edit' });

    await svc.updateBody(post.id, { body: 'a new body', source: 'manual_edit' });

    const { post: after, revisions } = await svc.detail(post.id);
    expect(after.sources).toEqual([A]);
    expect(revisions[0]!.body).toBe('a new body');
    expect(revisions[0]!.sources).toEqual([A]);
  });

  it('a sources-only save keeps the body and hook, and snapshots the body it found', async () => {
    const post = await svc.create({ tier: 'T1' });
    await svc.updateBody(post.id, { body: 'the hook line\nand more', source: 'manual_edit' });

    await svc.updateBody(post.id, { sources: [A, B], source: 'manual_edit' });

    const { post: after, revisions } = await svc.detail(post.id);
    expect(after.bodyLinkedin).toBe('the hook line\nand more');
    expect(after.hook).toBe('the hook line');
    expect(after.sources).toEqual([A, B]);
    expect(revisions[0]!.body).toBe('the hook line\nand more');
    expect(revisions[0]!.sources).toEqual([A, B]);
  });

  it('a sources-only save on a never-drafted post snapshots an empty body, and restoring it spares a body that exists', async () => {
    const post = await svc.create({ tier: 'T2' });
    await svc.updateBody(post.id, { sources: [A], source: 'manual_edit' });
    const emptyBodied = (await svc.detail(post.id)).revisions[0]!;
    expect(emptyBodied.body).toBe('');

    await svc.updateBody(post.id, { body: 'written later', source: 'manual_edit' });
    await svc.restoreRevision(post.id, emptyBodied.id);

    // The revision carries no body to restore, so the one written since stands.
    expect((await svc.get(post.id)).bodyLinkedin).toBe('written later');
  });

  it('restores a revision\'s sources with its body, and leaves them alone when the snapshot predates the column', async () => {
    const post = await svc.create({ tier: 'T1' });
    await svc.updateBody(post.id, { body: 'v1', sources: [A], source: 'manual_edit' });
    const v1 = (await svc.detail(post.id)).revisions[0]!;
    await svc.updateBody(post.id, { body: 'v2', sources: [B], source: 'manual_edit' });

    await svc.restoreRevision(post.id, v1.id);
    const restored = await svc.get(post.id);
    expect(restored.bodyLinkedin).toBe('v1');
    expect(restored.sources).toEqual([A]);

    // A pre-0018 snapshot: null sources, so there is nothing to restore to.
    const [old] = await db.insert(postRevisions)
      .values({ postId: post.id, body: 'ancient', source: 'manual_edit' }).returning();
    await svc.restoreRevision(post.id, old!.id);
    const after = await svc.get(post.id);
    expect(after.bodyLinkedin).toBe('ancient');
    expect(after.sources).toEqual([A]);
    expect((await svc.detail(post.id)).revisions[0]!.sources).toEqual([A]);
  });

  it('an explicit empty list clears the sources, and the revision snapshots the clear', async () => {
    // The destructive half of the plan's first reading: a returned list replaces, empty included.
    // The research prompt says "leave it empty if you used nothing", so a draft reaches this.
    const post = await svc.create({ tier: 'T1' });
    await svc.updateBody(post.id, { body: 'a body', sources: [A, B], source: 'manual_edit' });

    await svc.updateBody(post.id, { sources: [], source: 'manual_edit' });

    const { post: after, revisions } = await svc.detail(post.id);
    expect(after.sources).toEqual([]);
    expect(revisions[0]!.sources).toEqual([]);
  });

  it('refuses a write with neither body nor sources, and any write to a measured post', async () => {
    const post = await svc.create({ tier: 'T3' });
    await expect(svc.updateBody(post.id, { source: 'manual_edit' })).rejects.toThrow(BadRequestException);
    expect(BodySchema.safeParse({}).success).toBe(false);
    expect(BodySchema.safeParse({ sources: [] }).success).toBe(true);
    // An explicit list and a run's append cannot both be asked for: the list would win and the
    // revision would still read `run:<id>`.
    expect(BodySchema.safeParse({ sources: [], sourceRunId: 1 }).success).toBe(false);
    expect(BodySchema.safeParse({ body: 'b', sourceRunId: 1 }).success).toBe(true);

    await svc.updateBody(post.id, { body: 'final', source: 'manual_edit' });
    await svc.beginDrafting(post.id);
    await svc.endDrafting(post.id);
    await svc.approve(post.id);
    await svc.publish(post.id, { linkedinUrl: `https://linkedin.com/posts/measured-${post.id}` });
    await svc.markMeasured(post.id);

    await expect(svc.updateBody(post.id, { body: 'too late', source: 'manual_edit' }))
      .rejects.toThrow(ConflictException);
    await expect(svc.updateBody(post.id, { sources: [A], source: 'manual_edit' }))
      .rejects.toThrow(ConflictException);
  });

  it('dedupAppend keeps the existing note and appends the rest in order', () => {
    const incoming: Source[] = [
      { kind: 'web', ref: '  https://a  ', note: 'the model rewording it' },
      B,
      { kind: 'web', ref: 'https://c', note: 'third' },
      { kind: 'web', ref: 'https://c', note: 'third again' },
    ];

    expect(dedupAppend([A], incoming)).toEqual([
      A, B, { kind: 'web', ref: 'https://c', note: 'third' },
    ]);
    expect(dedupAppend([], [])).toEqual([]);
  });

});
