import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { eq, inArray } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
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
  dimPost, factAudienceSegment, factPostLifetime,
  posts as postsTable, runs as runsTable, sourceFiles,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

// Two urn forms of ONE app post — the detail payload has to read across both.
const URN_X = 'urn:li:share:9990000000000000401';
const URN_Y = 'urn:li:activity:9990000000000000402';
const URNS = [URN_X, URN_Y];

describe('analytics post detail', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;
  let db: ForgeDb;
  let sfId: number;
  let pX: number;
  let runIds: number[] = [];
  // 2027-11: a month no other spec file's fixtures use (overview 2027-06, board 2027-09, planner 2027-03)
  const now = DateTime.fromISO('2027-11-18T12:00:00', { zone: TZ });
  const day = (offset: number) => now.minus({ days: offset }).toISODate()!;
  const at = (offset: number) => now.minus({ days: offset }).toJSDate();

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    db = createDb(url);
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule, AnalyticsModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .compile();
    analytics = mod.get(AnalyticsService);
    posts = mod.get(PostsService);

    const [sf] = await db.insert(sourceFiles).values({
      sha256: `post-detail-spec-${now.toMillis()}`, kind: 'single_post',
      originalName: 'post-detail-spec-fixture.xlsx', importedAt: new Date(),
    }).returning({ id: sourceFiles.id });
    sfId = sf!.id;

    const p = await posts.create({ tier: 'T2' });
    pX = p.id;
    await db.update(postsTable)
      .set({ status: 'published', publishedAt: at(12), hook: 'post detail fixture hook' })
      .where(eq(postsTable.id, pX));

    await db.insert(dimPost).values([
      { postUrn: URN_X, postId: pX, linkedinUrl: 'https://l.example/x', publishedAt: at(12), firstSeenSourceFileId: sfId },
      { postUrn: URN_Y, postId: pX, linkedinUrl: 'https://l.example/y', publishedAt: at(12), firstSeenSourceFileId: sfId },
    ]);

    const life = (postUrn: string, metric: string, offset: number, value: number) =>
      ({ postUrn, metric, asOfDate: day(offset), value, sourceFileId: sfId });
    await db.insert(factPostLifetime).values([
      life(URN_X, 'impressions', 10, 500), life(URN_X, 'impressions', 2, 900), // latest wins → 900
      life(URN_X, 'reactions', 2, 30),
      life(URN_Y, 'saves', 5, 4), // the OTHER urn form still contributes its metric
    ]);

    // Post-level demographics at two capture days — only the newest snapshot is served.
    await db.insert(factAudienceSegment).values([
      { postUrn: URN_X, dimension: 'seniority', segment: 'senior', value: 41, unit: 'percent', asOfDate: day(5), sourceFileId: sfId },
      { postUrn: URN_X, dimension: 'seniority', segment: 'senior', value: 55, unit: 'percent', asOfDate: day(2), sourceFileId: sfId },
      { postUrn: URN_X, dimension: 'location', segment: 'brazil', value: 22, unit: 'percent', asOfDate: day(2), sourceFileId: sfId },
    ]);

    runIds = (await db.insert(runsTable).values([
      // priced at call time: the stored cost is what the reader returns
      { engine: 'claude' as const, kind: 'image_gen' as const, model: 'post-detail-spec', prompt: 'p',
        status: 'succeeded' as const, imagesGenerated: 2, costUsd: '0.5', startedAt: at(3), postId: pX },
      // nothing recorded → costUsd null, still an item
      { engine: 'claude' as const, kind: 'draft' as const, model: 'post-detail-spec', prompt: 'p',
        status: 'succeeded' as const, startedAt: at(6), postId: pX },
    ]).returning({ id: runsTable.id })).map((r) => r.id);
  });

  afterAll(async () => {
    await db.delete(factPostLifetime).where(eq(factPostLifetime.sourceFileId, sfId));
    await db.delete(factAudienceSegment).where(eq(factAudienceSegment.sourceFileId, sfId));
    await db.delete(dimPost).where(inArray(dimPost.postUrn, URNS));
    await db.delete(runsTable).where(inArray(runsTable.id, runIds));
    await db.delete(postsTable).where(eq(postsTable.id, pX));
    await db.delete(sourceFiles).where(eq(sourceFiles.id, sfId));
  });

  it('latest is per-metric latest-wins across the post urns; series is ascending impressions per as_of_date', async () => {
    // fixture: post P linked to URN_X with impressions asOf d10=500, d2=900; reactions d2=30; URN_Y (same post) saves d5=4
    const d = await analytics.postDetail(pX);
    expect(d.latest).toContainEqual({ metric: 'impressions', value: 900, asOf: day(2) });
    expect(d.latest).toContainEqual({ metric: 'saves', value: 4, asOf: day(5) });
    expect(d.series.map((s) => s.asOf)).toEqual([day(10), day(2)]);
    expect(d.series[0]!.impressions).toBe(500);
  });

  it('audience covers this post urns only, latest snapshot, verbatim units', async () => {
    const d = await analytics.postDetail(pX);
    expect(d.audience?.asOf).toBe(day(2));
    expect(d.audience!.dimensions[0]!.segments[0]).toMatchObject({ unit: 'percent' });
  });

  it('runs carry the cost recorded on them and a total; a post with no facts returns empty latest/series and null audience', async () => {
    const d = await analytics.postDetail(pX);
    expect(d.runs.items.map((r) => r.costUsd)).toEqual([0.5, null]);
    expect(d.runs.total).toBe(0.5);
    const bare = await posts.create({ tier: 'T3' });
    const empty = await analytics.postDetail(bare.id);
    expect(empty.latest).toEqual([]);
    expect(empty.series).toEqual([]);
    expect(empty.audience).toBeNull();
    await db.delete(postsTable).where(eq(postsTable.id, bare.id));
  });

  it('404s for an unknown post', async () => {
    await expect(analytics.postDetail(99_999_999)).rejects.toMatchObject({ status: 404 });
  });
});
