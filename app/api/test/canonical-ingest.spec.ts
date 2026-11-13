import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { AnalyticsService } from '../src/analytics/analytics.service';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const DIR = 'test/fixtures/synthetic-exports';
const TWIN_URL = 'https://www.linkedin.com/posts/user-example_synthetic-twin-post-share-9990000000000000101-AAAA';
const UNLINKED_URL = 'https://www.linkedin.com/posts/user-example_unlinked-post-share-9990000000000000001-XXXX';

describe('canonical ingest', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;
  const db = createDb(url);

  async function publishNew(linkedinUrl: string): Promise<number> {
    const post = await posts.create({ tier: 'T2' });
    await posts.updateBody(post.id, { body: 'body', source: 'manual_edit' });
    await posts.patchMeta(post.id, { hook: 'h' });
    await posts.beginDrafting(post.id); await posts.endDrafting(post.id);
    await posts.approve(post.id);
    await posts.publish(post.id, { linkedinUrl });
    return post.id;
  }

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule, AnalyticsModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    analytics = mod.get(AnalyticsService);
    posts = mod.get(PostsService);
    for (const t of [factPostLifetime, factWindowMetric, factAudienceSegment, factProfileMetric, dimPost, sourceFiles]) {
      await db.delete(t);
    }
  });

  it('aggregate import lands every sheet at its grain, unlinked', async () => {
    const res = await analytics.importXlsx(
      { buffer: await readFile(`${DIR}/aggregate.xlsx`), originalname: 'aggregate.xlsx' },
    );
    expect(res.kind).toBe('aggregate');
    expect(res.linkedPostId).toBeNull();
    expect(res.factCounts).toEqual({ profile: 271, lifetime: 0, window: 19, audience: 42 });
    expect(await db.$count(dimPost)).toBe(14);
    const [sf] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, res.sourceFileId));
    expect(sf!.windowStart).toBe('2026-05-11');
    expect(sf!.windowEnd).toBe('2026-08-08');
  });

  it('twin A links by exact url, marks measured, compat forPost pivots', async () => {
    const postId = await publishNew(TWIN_URL);
    const res = await analytics.importXlsx(
      { buffer: await readFile(`${DIR}/single-post-twin-a.xlsx`), originalname: 'twin-a.xlsx' },
      { capturedAt: new Date('2026-08-11T12:00:00-03:00') },
    );
    expect(res.linkedPostId).toBe(postId);
    expect((await posts.get(postId)).status).toBe('measured');
    const snaps = await analytics.forPost(postId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(1200);
    expect(snaps[0]!.demographics).not.toBeNull();
  });

  it('twin B same day overwrites at the same PK (last-write-wins), and re-import is a no-op', async () => {
    const buffer = await readFile(`${DIR}/single-post-twin-b.xlsx`);
    const res = await analytics.importXlsx(
      { buffer, originalname: 'twin-b.xlsx' },
      { capturedAt: new Date('2026-08-11T18:00:00-03:00') },
    );
    expect(res.alreadyImported).toBeUndefined();
    const post = await posts.findByUrl(TWIN_URL);
    const snaps = await analytics.forPost(post!.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(1205);

    const again = await analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'twin-b.xlsx' });
    expect(again.alreadyImported).toBe(true);
    expect(await analytics.forPost(post!.id)).toHaveLength(1);
  });

  it('unlinked single-post ingests with a warning, then heals via force once the post exists', async () => {
    const buffer = await readFile(`${DIR}/single-post-unlinked.xlsx`);
    const res = await analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'unlinked.xlsx' });
    expect(res.linkedPostId).toBeNull();
    expect(res.warnings.length).toBeGreaterThan(0);

    const postId = await publishNew(UNLINKED_URL);
    const healed = await analytics.importXlsx(
      { buffer: Buffer.from(buffer), originalname: 'unlinked.xlsx' }, { force: true },
    );
    expect(healed.linkedPostId).toBe(postId);
    expect((await posts.get(postId)).status).toBe('measured');
  });

  it('?postId onto a non-published post links with a warning, never throws or transitions', async () => {
    const draft = await posts.create({ tier: 'T3' });
    const res = await analytics.importXlsx(
      { buffer: await readFile(`${DIR}/single-post-video.xlsx`), originalname: 'video.xlsx' },
      { postId: draft.id },
    );
    expect(res.linkedPostId).toBe(draft.id);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect((await posts.get(draft.id)).status).toBe('queued');
  });

  it('force purges rows the reparse no longer emits', async () => {
    const buffer = await readFile(`${DIR}/single-post-video.xlsx`);
    const first = await analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'video.xlsx' });
    const bogusUrn = (await db.select().from(dimPost))[0]!.postUrn;
    await db.insert(factPostLifetime).values({
      postUrn: bogusUrn, metric: 'bogus_metric', asOfDate: '2026-01-01', value: 1, sourceFileId: first.sourceFileId,
    });
    await analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'video.xlsx' }, { force: true });
    const bogus = await db.select().from(factPostLifetime).where(eq(factPostLifetime.metric, 'bogus_metric'));
    expect(bogus).toHaveLength(0);
  });

  it('countMeasuredSince keeps insert-instant semantics', async () => {
    expect(await analytics.countMeasuredSince(null)).toBeGreaterThanOrEqual(2);
    expect(await analytics.countMeasuredSince(new Date())).toBe(0);
  });
});
