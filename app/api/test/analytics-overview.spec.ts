import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
import { factProfileMetric, posts as postsTable, sourceFiles } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

describe('analytics overview aggregation', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;
  let db: ForgeDb;
  let sfId: number;
  // fixed clock, dates chosen in 2027-06 so no other spec file's fixtures collide
  const now = DateTime.fromISO('2027-06-20T12:00:00', { zone: TZ });
  const day = (offset: number) => now.minus({ days: offset }).toISODate()!;

  const put = (metric: string, offset: number, value: number) =>
    db.insert(factProfileMetric)
      .values({ metric, date: day(offset), value, sourceFileId: sfId })
      .onConflictDoUpdate({ target: [factProfileMetric.metric, factProfileMetric.date], set: { value } });

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
      sha256: `overview-spec-${now.toMillis()}`, kind: 'aggregate',
      originalName: 'overview-spec-fixture.xlsx', importedAt: new Date(),
    }).returning({ id: sourceFiles.id });
    sfId = sf!.id;
    // current 7d window = offsets 0..6; previous = 7..13; offset 14 is outside both
    await put('impressions', 0, 100); await put('impressions', 6, 50);
    await put('impressions', 7, 30);  await put('impressions', 13, 20);
    await put('impressions', 14, 999);
    await put('engagements', 0, 9);
    await put('followers_new', 6, 4); await put('followers_new', 8, 2);
    await put('followers_total', 9, 1000); await put('followers_total', 2, 1010);
    await put('followers_total', -1, 2000); // tomorrow — must never win
  });

  afterAll(async () => {
    await db.delete(factProfileMetric).where(eq(factProfileMetric.sourceFileId, sfId));
    await db.delete(sourceFiles).where(eq(sourceFiles.id, sfId));
  });

  it('sums the current window inclusively (today and today-(N-1) both count)', async () => {
    const o = await analytics.overview(7, now);
    expect(o.current).toMatchObject({
      start: day(6), end: day(0), impressions: 150, engagements: 9, followersNew: 4,
    });
  });

  it('previous window is the N days immediately before — no overlap, no gap', async () => {
    const o = await analytics.overview(7, now);
    expect(o.previous).toMatchObject({
      start: day(13), end: day(7), impressions: 50, engagements: 0, followersNew: 2,
    });
  });

  it('daysWithData counts distinct dates with any DAILY metric; followers_total does not count', async () => {
    const o = await analytics.overview(7, now);
    expect(o.current.daysWithData).toBe(2); // offsets 0 and 6 only — the offset-2 followers_total row is excluded
  });

  it('weekday has all 7 ISO buckets and buckets the current window only', async () => {
    const o = await analytics.overview(7, now);
    expect(o.weekday.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const todays = o.weekday.find((w) => w.weekday === now.weekday)!;
    expect(todays.impressions).toBe(100); // NOT 130 — the same-weekday previous-window row stays out
  });

  it('followersTotal is the latest snapshot ≤ today (future snapshots never win)', async () => {
    const o = await analytics.overview(7, now);
    expect(o.followersTotal).toEqual({ value: 1010, asOf: day(2) });
  });

  it('postsPublished counts posts published inside the window, zone-aware', async () => {
    const post = await posts.create({ tier: 'T2' });
    await db.update(postsTable)
      .set({ status: 'published', publishedAt: now.minus({ days: 1 }).toJSDate() })
      .where(eq(postsTable.id, post.id));
    const o = await analytics.overview(7, now);
    expect(o.current.postsPublished).toBeGreaterThanOrEqual(1);
    const far = await analytics.overview(7, now.minus({ years: 2 }));
    expect(far.current.postsPublished).toBe(0);
    await db.delete(postsTable).where(eq(postsTable.id, post.id));
  });

  it('an empty window returns zeros with daysWithData 0 and a null followersTotal', async () => {
    // Pinned 30 years back, well before any spec's fixture era: the DB is shared across
    // spec files, so a window near the fixtures would pick up another file's rows.
    const o = await analytics.overview(7, now.minus({ years: 30 }));
    expect(o.current).toMatchObject({ impressions: 0, engagements: 0, followersNew: 0, daysWithData: 0 });
    expect(o.followersTotal).toBeNull();
  });

  it('rejects a window outside {7, 28, 90}', async () => {
    await expect(analytics.overview(14, now)).rejects.toBeInstanceOf(BadRequestException);
  });
});
