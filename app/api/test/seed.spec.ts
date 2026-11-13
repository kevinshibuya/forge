import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { runSeed } from '../src/seed/seed';
import { PostsService } from '../src/posts/posts.service';
import { PlaybookService } from '../src/playbook/playbook.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { SettingsService } from '../src/settings/settings.service';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, embeddingJobs, embeddings, ideas, playbookRules, postRevisions, posts, runs, settings,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

describe('seed migration', () => {
  let mod: import('@nestjs/testing').TestingModule;
  const db = createDb(url);

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    // full clean slate — seed asserts absolute counts (FK-safe order)
    await db.delete(postRevisions); await db.delete(assets);
    await db.delete(factPostLifetime); await db.delete(factWindowMetric); await db.delete(factAudienceSegment);
    await db.delete(factProfileMetric); await db.delete(dimPost); await db.delete(sourceFiles);
    await db.delete(embeddings); await db.delete(embeddingJobs); await db.delete(runs);
    await db.delete(ideas); await db.delete(posts); await db.delete(playbookRules);
    await db.delete(settings);
    mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .compile();
  });

  it('seeds post #1 with snapshot, asset, 17 rules, and the docs — idempotently', async () => {
    const first = await runSeed(mod);
    expect(first.skipped).toBe(false);

    const posts_ = mod.get(PostsService);
    const all = await posts_.list();
    expect(all).toHaveLength(1);
    const post = all[0]!;
    expect(post.status).toBe('measured');
    expect(post.tier).toBe('T1');
    expect(post.hook).toContain('checkout API slowed to 9 seconds');
    expect(post.publishedAt!.toISOString()).toBe('2026-07-02T14:00:00.000Z'); // 11:00 BRT

    const snaps = await mod.get(AnalyticsService).forPost(post.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.impressions).toBe(1000);
    expect(snaps[0]!.capturedAt.toISOString()).toBe('2026-07-09T15:00:00.000Z');

    const assetRows = await db.select().from(assets).where(eq(assets.postId, post.id));
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]!.lane).toBe('html');
    expect(assetRows[0]!.isSelected).toBe(true);
    expect(assetRows[0]!.htmlSource).toContain('<html');
    expect(assetRows[0]!.pngPath).toBe('post-assets/idle-transaction.png');

    expect(await mod.get(PlaybookService).activeRules()).toHaveLength(17);

    const s = await mod.get(SettingsService).get();
    expect(s.personaDoc).toContain('sentence case everywhere');
    expect(s.goalDoc).toContain('fix problems faster');
    expect(s.designLanguageDoc).toContain('design language');

    const second = await runSeed(mod);
    expect(second.skipped).toBe(true);
    expect(await posts_.list()).toHaveLength(1);
    expect(await mod.get(PlaybookService).activeRules()).toHaveLength(17);
  });

  it('skips a database whose post #1 came from another export, under another URL', async () => {
    // A database seeded before the fixtures changed holds a post #1 whose URL the current seed
    // export does not carry. Matching on URL alone added a second post #1 there.
    await db.update(posts).set({ linkedinUrl: 'https://www.linkedin.com/posts/older-seed-share-9990000000000000999-OLD0' });
    const again = await runSeed(mod);
    expect(again.skipped).toBe(true);
    expect(await mod.get(PostsService).list()).toHaveLength(1);
  });
});
