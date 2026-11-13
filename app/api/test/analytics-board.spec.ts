import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { BadRequestException } from '@nestjs/common';
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
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric,
  posts as postsTable, runs as runsTable, sourceFiles,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

const URN_A = 'urn:li:share:9990000000000000201';
const URN_B = 'urn:li:share:9990000000000000202'; // window-only, unlinked
const URN_C1 = 'urn:li:share:9990000000000000203'; // shares post_id with C2 (dedupe guard)
const URN_C2 = 'urn:li:share:9990000000000000204';
const URNS = [URN_A, URN_B, URN_C1, URN_C2];

describe('analytics board aggregation', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;
  let db: ForgeDb;
  let sfId: number;
  let pA: number; let pB: number;
  let runIds: number[] = [];
  /** The cost stored on each seeded run per image: the board sums what the runs recorded. */
  const unit = 0.25;
  // 2027-09: a month no other spec file's fixtures use (overview pins 2027-06, planner 2027-03)
  const now = DateTime.fromISO('2027-09-20T12:00:00', { zone: TZ });
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
      sha256: `board-spec-${now.toMillis()}`, kind: 'aggregate',
      originalName: 'board-spec-fixture.xlsx', importedAt: new Date(),
    }).returning({ id: sourceFiles.id });
    sfId = sf!.id;

    // daily profile rows: day 0 and day 3 (gap at 1–2); day 40 sits outside 28d, inside 90d
    const put = (metric: string, offset: number, value: number) =>
      db.insert(factProfileMetric)
        .values({ metric, date: day(offset), value, sourceFileId: sfId })
        .onConflictDoUpdate({ target: [factProfileMetric.metric, factProfileMetric.date], set: { value } });
    await put('impressions', 0, 100); await put('impressions', 3, 50); await put('impressions', 40, 999);
    await put('engagements', 0, 10); await put('followers_new', 3, 4);
    await put('followers_total', 8, 1000); await put('followers_total', 1, 1200);

    const a = await posts.create({ tier: 'T2' });
    const b = await posts.create({ tier: 'T3' });
    pA = a.id; pB = b.id;
    await db.update(postsTable)
      .set({ status: 'published', publishedAt: at(1) })
      .where(eq(postsTable.id, pA));

    await db.insert(dimPost).values([
      { postUrn: URN_A, postId: pA, linkedinUrl: 'https://l.example/a', publishedAt: at(1), firstSeenSourceFileId: sfId },
      { postUrn: URN_B, postId: null, linkedinUrl: 'https://l.example/b', publishedAt: at(5), firstSeenSourceFileId: sfId },
      { postUrn: URN_C1, postId: pB, linkedinUrl: 'https://l.example/c1', publishedAt: null, firstSeenSourceFileId: sfId },
      { postUrn: URN_C2, postId: pB, linkedinUrl: 'https://l.example/c2', publishedAt: null, firstSeenSourceFileId: sfId },
    ]);
    const life = (postUrn: string, metric: string, offset: number, value: number) =>
      ({ postUrn, metric, asOfDate: day(offset), value, sourceFileId: sfId });
    await db.insert(factPostLifetime).values([
      life(URN_A, 'impressions', 6, 800), life(URN_A, 'impressions', 1, 1000), // latest wins → 1000
      life(URN_A, 'reactions', 1, 50), life(URN_A, 'comments', 1, 10),
      life(URN_A, 'reposts', 1, 5), life(URN_A, 'follows_gained', 1, 7),
      life(URN_C1, 'impressions', 2, 400), life(URN_C2, 'impressions', 2, 900), // dedupe winner: C2
    ]);
    await db.insert(factWindowMetric).values([
      { postUrn: URN_B, metric: 'impressions', windowStart: day(30), windowEnd: day(20), value: 300, sourceFileId: sfId },
      { postUrn: URN_B, metric: 'impressions', windowStart: day(20), windowEnd: day(10), value: 200, sourceFileId: sfId },
    ]);
    await db.insert(factAudienceSegment).values([
      { postUrn: null, dimension: 'seniority', segment: 'senior', value: 40, unit: 'percent', asOfDate: day(9), sourceFileId: sfId },
      { postUrn: null, dimension: 'seniority', segment: 'senior', value: 43, unit: 'percent', asOfDate: day(2), sourceFileId: sfId },
      { postUrn: null, dimension: 'location', segment: 'brazil', value: 21, unit: 'percent', asOfDate: day(2), sourceFileId: sfId },
    ]);

    const run = (kind: 'draft' | 'image_gen', startedAt: Date, images: number, postId: number | null) =>
      ({ engine: 'claude' as const, kind, model: 'board-spec', prompt: 'p', status: 'succeeded' as const,
        imagesGenerated: images, costUsd: String(images * unit), startedAt, postId });
    runIds = (await db.insert(runsTable).values([
      run('draft', at(3), 2, pA),
      run('image_gen', at(1), 3, null),
      // 2020-01-01: earlier than any plausible fixture — pins the range=all lower bound
      run('draft', DateTime.fromISO('2020-01-01T12:00:00', { zone: TZ }).toJSDate(), 1, null),
    ]).returning({ id: runsTable.id })).map((r) => r.id);
  });

  afterAll(async () => {
    await db.delete(factPostLifetime).where(eq(factPostLifetime.sourceFileId, sfId));
    await db.delete(factWindowMetric).where(eq(factWindowMetric.sourceFileId, sfId));
    await db.delete(factAudienceSegment).where(eq(factAudienceSegment.sourceFileId, sfId));
    await db.delete(factProfileMetric).where(eq(factProfileMetric.sourceFileId, sfId));
    await db.delete(dimPost).where(inArray(dimPost.postUrn, URNS));
    await db.delete(runsTable).where(inArray(runsTable.id, runIds));
    await db.delete(postsTable).where(inArray(postsTable.id, [pA, pB]));
    await db.delete(sourceFiles).where(eq(sourceFiles.id, sfId));
  });

  it('echoes the range and computes inclusive boundaries for 7/28/90', async () => {
    const b28 = await analytics.board('28', now);
    expect(b28).toMatchObject({ range: '28', start: day(27), end: day(0) });
    expect((await analytics.board('7', now)).start).toBe(day(6));
    expect((await analytics.board('90', now)).start).toBe(day(89));
  });

  it('rejects a range outside the set', async () => {
    await expect(analytics.board('14' as never, now)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('series carries ONLY days with daily rows (gaps stay absent; followers_total does not count)', async () => {
    const b = await analytics.board('28', now);
    expect(b.series.map((s) => s.date)).toEqual([day(3), day(0)]);
    expect(b.series[1]).toEqual({ date: day(0), impressions: 100, engagements: 10, followersNew: 0 });
  });

  it('totals sum the window; 90d picks up the day-40 row; postsPublished counts in-window publishes', async () => {
    const b = await analytics.board('28', now);
    expect(b.totals).toEqual({ impressions: 150, engagements: 10, followersNew: 4, postsPublished: 1 });
    expect((await analytics.board('90', now)).totals.impressions).toBe(1149);
  });

  it('followersTotal is the latest snapshot ≤ today', async () => {
    expect((await analytics.board('28', now)).followersTotal).toEqual({ value: 1200, asOf: day(1) });
  });

  it('lifetime posts get latest-per-metric values and derived stats', async () => {
    const b = await analytics.board('28', now);
    const a = b.posts.find((p) => p.postUrn === URN_A)!;
    expect(a).toMatchObject({
      postId: pA, grain: 'lifetime', impressions: 1000, engagements: 65, followsGained: 7,
    });
    expect(a.er).toBeCloseTo(6.5, 2);
  });

  it('window-only posts fall back to max window impressions with null derived stats', async () => {
    const b = await analytics.board('28', now);
    const w = b.posts.find((p) => p.postUrn === URN_B)!;
    expect(w).toMatchObject({
      postId: null, title: null, grain: 'window', impressions: 300,
      engagements: null, er: null, followsGained: null,
    });
  });

  it('two dim_post rows sharing a post_id collapse to one row (greater impressions wins)', async () => {
    const b = await analytics.board('28', now);
    const forB = b.posts.filter((p) => p.postId === pB);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({ postUrn: URN_C2, impressions: 900 });
  });

  it('posts are ordered by best-known impressions descending across grains', async () => {
    const b = await analytics.board('28', now);
    const mine = b.posts.filter((p) => URNS.includes(p.postUrn)).map((p) => p.postUrn);
    expect(mine).toEqual([URN_A, URN_C2, URN_B]); // 1000 > 900 > 300
  });

  it('audience is the latest account-level snapshot, values verbatim with units', async () => {
    const b = await analytics.board('28', now);
    expect(b.audience?.asOf).toBe(day(2));
    const sen = b.audience!.dimensions.find((d) => d.dimension === 'seniority')!;
    expect(sen.segments).toContainEqual({ segment: 'senior', value: 43, unit: 'percent' });
    expect(b.audience!.dimensions.some((d) => d.dimension === 'location')).toBe(true);
  });

  it('spend covers in-range runs: totals, byKind, perPublishedPost, and byPost pairs cost with impressions', async () => {
    const b = await analytics.board('28', now);
    expect(b.spend.runs).toBe(2);
    expect(b.spend.total).toBeCloseTo(5 * unit, 6);
    expect(b.spend.byKind).toContainEqual({ kind: 'draft', total: expect.closeTo(2 * unit, 6) });
    expect(b.spend.byKind).toContainEqual({ kind: 'image_gen', total: expect.closeTo(3 * unit, 6) });
    expect(b.spend.perPublishedPost).toBeCloseTo(5 * unit, 6);
    expect(b.spend.byPost).toContainEqual(
      expect.objectContaining({ postId: pA, cost: expect.closeTo(2 * unit, 6), impressions: 1000 }),
    );
  });

  it('range=all reaches back to the earliest run day (spend history is never clipped)', async () => {
    const b = await analytics.board('all', now);
    expect(b.range).toBe('all');
    expect(b.start).toBe('2020-01-01');
    expect(b.end).toBe(day(0));
    expect(b.totals.impressions).toBeGreaterThanOrEqual(1149);
  });

  /**
   * GRAIN decides a dedupe collision, magnitude only breaks ties inside one grain. A window count
   * and a lifetime count are not the same quantity, so a large 10-day number must never evict the
   * post's lifetime row — that would drop `er`, `followsGained` and the row's eligibility for
   * `spend.byPost` on the strength of a number that measures something else.
   *
   * Self-contained: its fixture is created and torn down here so the shared one stays untouched.
   */
  it('a mixed-grain collision on one post_id keeps the LIFETIME row, even when window is larger', async () => {
    const urnLife = 'urn:li:share:9990000000000000205';
    const urnWindow = 'urn:li:share:9990000000000000206';
    const mixed = await posts.create({ tier: 'T3' });
    try {
      await db.insert(dimPost).values([
        { postUrn: urnLife, postId: mixed.id, linkedinUrl: 'https://l.example/mix-life', publishedAt: at(2), firstSeenSourceFileId: sfId },
        { postUrn: urnWindow, postId: mixed.id, linkedinUrl: 'https://l.example/mix-win', publishedAt: at(2), firstSeenSourceFileId: sfId },
      ]);
      await db.insert(factPostLifetime).values([
        { postUrn: urnLife, metric: 'impressions', asOfDate: day(2), value: 120, sourceFileId: sfId },
        { postUrn: urnLife, metric: 'reactions', asOfDate: day(2), value: 12, sourceFileId: sfId },
      ]);
      await db.insert(factWindowMetric).values([
        { postUrn: urnWindow, metric: 'impressions', windowStart: day(20), windowEnd: day(10), value: 5000, sourceFileId: sfId },
      ]);

      const b = await analytics.board('28', now);
      const forMixed = b.posts.filter((p) => p.postId === mixed.id);
      expect(forMixed).toHaveLength(1);
      expect(forMixed[0]).toMatchObject({ postUrn: urnLife, grain: 'lifetime', impressions: 120, engagements: 12 });
    } finally {
      const both = [urnLife, urnWindow];
      await db.delete(factPostLifetime).where(inArray(factPostLifetime.postUrn, both));
      await db.delete(factWindowMetric).where(inArray(factWindowMetric.postUrn, both));
      await db.delete(dimPost).where(inArray(dimPost.postUrn, both));
      await db.delete(postsTable).where(eq(postsTable.id, mixed.id));
    }
  });

  it('an empty era returns empty series, zero totals, null followersTotal, zero spend', async () => {
    const b = await analytics.board('7', now.minus({ years: 25 }));
    expect(b.series).toEqual([]);
    expect(b.totals).toEqual({ impressions: 0, engagements: 0, followersNew: 0, postsPublished: 0 });
    expect(b.followersTotal).toBeNull();
    expect(b.spend.runs).toBe(0);
    expect(b.spend.perPublishedPost).toBeNull();
  });
});
