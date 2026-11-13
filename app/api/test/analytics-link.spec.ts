import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
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
import { dimPost, factPostLifetime, posts as postsTable, sourceFiles } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

const URN = 'urn:li:share:9990000000000000301';
const URN2 = 'urn:li:share:9990000000000000302';
const URNS = [URN, URN2];

describe('analytics link', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;
  let db: ForgeDb;
  let sfId: number;

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
      sha256: `link-spec-${Date.now()}`, kind: 'aggregate',
      originalName: 'link-spec-fixture.xlsx', importedAt: new Date(),
    }).returning({ id: sourceFiles.id });
    sfId = sf!.id;
  });

  afterAll(async () => {
    // Read the linked post ids off the fixture urns before dropping them — the app posts
    // are created inside the `it` blocks, so this is the only handle on them.
    const linked = await db.select({ postId: dimPost.postId })
      .from(dimPost).where(inArray(dimPost.postUrn, URNS));
    const postIds = linked.map((r) => r.postId).filter((id): id is number => id !== null);
    await db.delete(factPostLifetime).where(eq(factPostLifetime.sourceFileId, sfId));
    await db.delete(dimPost).where(inArray(dimPost.postUrn, URNS));
    if (postIds.length > 0) await db.delete(postsTable).where(inArray(postsTable.id, postIds));
    await db.delete(sourceFiles).where(eq(sourceFiles.id, sfId));
  });

  it('links an unlinked urn to an app post and marks a published post measured when lifetime facts exist', async () => {
    const p = await posts.create({ tier: 'T2' });
    await db.update(postsTable).set({ status: 'published', publishedAt: new Date() }).where(eq(postsTable.id, p.id));
    await db.insert(dimPost).values({ postUrn: URN, postId: null, linkedinUrl: 'https://l.example/link1', firstSeenSourceFileId: sfId });
    await db.insert(factPostLifetime).values({ postUrn: URN, metric: 'impressions', asOfDate: '2027-01-01', value: 10, sourceFileId: sfId });
    const res = await analytics.link(URN, p.id);
    expect(res).toMatchObject({ postUrn: URN, postId: p.id });
    const [dim] = await db.select().from(dimPost).where(eq(dimPost.postUrn, URN));
    expect(dim!.postId).toBe(p.id);
    expect((await posts.get(p.id)).status).toBe('measured');
  });

  it('404s on an unknown urn and propagates NotFound for a missing post', async () => {
    await expect(analytics.link('urn:li:share:000000nope', 1)).rejects.toMatchObject({ status: 404 });
    await db.insert(dimPost).values({ postUrn: URN2, postId: null, linkedinUrl: 'https://l.example/link2', firstSeenSourceFileId: sfId });
    await expect(analytics.link(URN2, 99_999_999)).rejects.toMatchObject({ status: 404 });
  });

  it('409s when the app post is already linked to another urn; same-pair relink is idempotent', async () => {
    // reuse URN (linked above): linking URN2 to the same post must 409; re-linking URN succeeds
    const [dim] = await db.select().from(dimPost).where(eq(dimPost.postUrn, URN));
    await expect(analytics.link(URN2, dim!.postId!)).rejects.toMatchObject({ status: 409 });
    await expect(analytics.link(URN, dim!.postId!)).resolves.toMatchObject({ postUrn: URN });
  });

  // Appended after the review wave (cross-vendor finding): the target-side guard cannot see the
  // SOURCE side, so re-pointing an already-linked urn at a free post used to silently strip the
  // original post of its measurements while leaving its `measured` status behind.
  it('409s when the urn is already linked to a different post, leaving the original link intact', async () => {
    const [before] = await db.select().from(dimPost).where(eq(dimPost.postUrn, URN));
    const owner = before!.postId!;
    const free = await posts.create({ tier: 'T3' });
    try {
      await expect(analytics.link(URN, free.id)).rejects.toMatchObject({ status: 409 });
      const [after] = await db.select().from(dimPost).where(eq(dimPost.postUrn, URN));
      expect(after!.postId).toBe(owner);
    } finally {
      await db.delete(postsTable).where(eq(postsTable.id, free.id));
    }
  });
});
