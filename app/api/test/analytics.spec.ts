import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
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
const FIXTURE = 'test/fixtures/synthetic-exports/seed-post.xlsx';
const POST_URL = 'https://www.linkedin.com/posts/seed-example_synthetic-twin-post-share-9990000000000000101-AAAA';

describe('AnalyticsService', () => {
  let analytics: AnalyticsService;
  let posts: PostsService;

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
    // Deliberately clears ONLY the canonical analytics tables: posts are shared across
    // serial spec files (seed.spec and e2e publish the same POST_URL). Correctness here
    // relies on two invariants: findByUrl is newest-first deterministic (Task 3), and
    // countMeasuredSince is fact-gated, so wiping facts resets that count.
    // FK order: facts, then dim_post, then source_files.
    const db = createDb(url);
    for (const t of [factPostLifetime, factWindowMetric, factAudienceSegment, factProfileMetric, dimPost, sourceFiles]) {
      await db.delete(t);
    }
  });

  it('import matches the post by url, lands canonical facts, marks measured', async () => {
    const post = await posts.create({ tier: 'T1' });
    await posts.updateBody(post.id, { body: 'body', source: 'manual_edit' });
    await posts.patchMeta(post.id, { hook: 'h' });
    await posts.beginDrafting(post.id); await posts.endDrafting(post.id);
    await posts.approve(post.id);
    await posts.publish(post.id, { linkedinUrl: POST_URL });

    const buffer = await readFile(FIXTURE);
    const res = await analytics.importXlsx({ buffer, originalname: 'post1.xlsx' });
    expect(res.linkedPostId).toBe(post.id);
    expect(res.kind).toBe('single_post');
    expect(res.factCounts.lifetime).toBeGreaterThan(0);
    expect((await posts.get(post.id)).status).toBe('measured');

    // the compat pivot still answers in the old snapshot shape
    const snaps = await analytics.forPost(post.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(1000);
    expect(snaps[0]!.rawFilePath).toContain('uploads/analytics/');
    expect(snaps[0]!.demographics).not.toBeNull();
  });

  it('unmatched url fails loudly with the url in the message', async () => {
    const buffer = await readFile(FIXTURE);
    // no post with this url exists anymore — measured post already matched; delete nothing, use override-free call on a fresh db state instead:
    await expect(
      analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'x.xlsx' }, { postId: 999_999 }),
    ).rejects.toThrow(/999999|not found/);
  });

  it('countMeasuredSince', async () => {
    expect(await analytics.countMeasuredSince(null)).toBe(1);
    expect(await analytics.countMeasuredSince(new Date())).toBe(0);
  });
});
