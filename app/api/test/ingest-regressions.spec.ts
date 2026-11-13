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
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric,
  posts as postsTable, sourceFiles,
} from '../src/db/schema';

/**
 * Regressions found by the PR #6 review. Each of these passed the original acceptance
 * suite: the re-dating bugs hide when every import in a test happens on the same day,
 * and the ordering bug hides when the rows were inserted in the right order to begin with.
 */

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const DIR = 'test/fixtures/synthetic-exports';
const UNLINKED_URL = 'https://www.linkedin.com/posts/user-example_unlinked-post-share-9990000000000000001-XXXX';
const DAY1 = new Date('2026-08-01T09:00:00-03:00');

describe('ingest regressions', () => {
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
    // forge_test keeps posts between runs, so a previous run's post can already own the
    // fixture url. Release it: these specs assert on the unlinked-then-linked transition.
    await db.update(postsTable).set({ linkedinUrl: null })
      .where(eq(postsTable.linkedinUrl, UNLINKED_URL));
  });

  it('a reingest on a later day keeps the original capture date', async () => {
    const buffer = await readFile(`${DIR}/single-post-video.xlsx`);
    const first = await analytics.importXlsx(
      { buffer: Buffer.from(buffer), originalname: 'video.xlsx' }, { capturedAt: DAY1 },
    );
    const postId = await publishNew('https://www.linkedin.com/posts/user-example_relink-share-9990000000000000104-ZZZZ');

    // The healing path, run "today" — the second import supplies no capturedAt, so before
    // the fix it defaulted to now and restated a 2026-08-01 measurement as today's.
    const healed = await analytics.importXlsx(
      { buffer: Buffer.from(buffer), originalname: 'video.xlsx' }, { postId },
    );
    expect(healed.sourceFileId).toBe(first.sourceFileId);
    expect(healed.linkedPostId).toBe(postId);

    const [file] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, first.sourceFileId));
    expect(file!.importedAt.toISOString()).toBe(DAY1.toISOString());

    const days = await db.selectDistinct({ asOfDate: factPostLifetime.asOfDate })
      .from(factPostLifetime).where(eq(factPostLifetime.sourceFileId, first.sourceFileId));
    expect(days.map((d) => d.asOfDate)).toEqual(['2026-08-01']);

    // One day-group, not two, and it still reads as the day it was measured.
    const snaps = await analytics.forPost(postId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.capturedAt.toISOString()).toBe(DAY1.toISOString());
  });

  it('re-uploading the same file links it once the post exists, and marks it measured', async () => {
    const buffer = await readFile(`${DIR}/single-post-unlinked.xlsx`);
    const unlinked = await analytics.importXlsx(
      { buffer: Buffer.from(buffer), originalname: 'unlinked.xlsx' }, { capturedAt: DAY1 },
    );
    expect(unlinked.linkedPostId).toBeNull();
    expect(unlinked.warnings.length).toBeGreaterThan(0);
    // the copy must not name a query parameter the UI has no control for
    expect(unlinked.warnings.join(' ')).not.toMatch(/\?(postId|force)/);

    // Exactly what the warning tells the user to do — publish the post, upload the file again.
    // The sha256 short-circuit used to make this a no-op, so the advertised remedy never worked.
    const postId = await publishNew(UNLINKED_URL);
    const healed = await analytics.importXlsx({ buffer: Buffer.from(buffer), originalname: 'unlinked.xlsx' });

    expect(healed.alreadyImported).toBe(true);
    expect(healed.linkedPostId).toBe(postId);
    expect((await posts.get(postId)).status).toBe('measured');
    expect(await analytics.forPost(postId)).toHaveLength(1);
  });

  it('demographics come back percent-descending even when row ids are alphabetical', async () => {
    // Migration 0010 backfilled audience rows ordered by (dimension, segment), so serial id
    // encodes alphabetical order for every legacy row. Insert that way on purpose.
    const [file] = await db.insert(sourceFiles).values({
      sha256: 'regression-ordering', kind: 'single_post', originalName: 'legacy.xlsx',
      importedAt: DAY1, rawPath: 'uploads/analytics/legacy.xlsx',
    }).returning();
    const postId = await publishNew('https://www.linkedin.com/posts/user-example_ordering-share-9990000000000000777-YYYY');
    const urn = 'urn:li:share:9990000000000000777';
    await db.insert(dimPost).values({
      postUrn: urn, shareUrn: urn, postId, linkedinUrl: 'https://example.invalid/ordering',
      firstSeenSourceFileId: file!.id,
    });
    for (const [segment, value] of [['Alpha', 1], ['Beta', 9], ['Gamma', 4]] as const) {
      await db.insert(factAudienceSegment).values({
        postUrn: urn, dimension: 'location', segment, value, unit: 'percent',
        asOfDate: '2026-08-01', sourceFileId: file!.id,
      });
    }

    const [snap] = await analytics.forPost(postId);
    expect(snap!.demographics!.locations.map((r) => r.value)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('source files stay text-safe: no NUL bytes in the analytics sources', async () => {
    // The composite-key separator used to be a literal NUL, which made xlsx-parser.ts a
    // binary file to git (it showed no diff at all in review) and invisible to plain grep.
    for (const path of ['src/analytics/analytics.service.ts', 'src/analytics/xlsx-parser.ts']) {
      expect((await readFile(path, 'utf8')).includes('\u0000'), path).toBe(false);
    }
  });

  it('an export missing the Premium-button and sends rows still parses', async () => {
    // No fixture lacks these rows, so build one. Requiring them would hard-fail the only
    // ingest path the UI offers, over two metrics that are 0 in every real export we have.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('An\u00e1lise da publica\u00e7\u00e3o');
    ws.addRows([
      ['URL da publica\u00e7\u00e3o', 'https://www.linkedin.com/posts/user-example_no-premium-share-9990000000000000888-AAAA'],
      ['Data da publica\u00e7\u00e3o', '01/08/2026'],
      ['Hora da publica\u00e7\u00e3o', '09:00'],
      ['Impress\u00f5es', '10'],
      ['Rea\u00e7\u00f5es', '2'],
      ['Coment\u00e1rios', '1'],
      ['Compartilhamentos', '0'],
      ['Salvamentos', '0'],
      // deliberately absent: 'Envios no LinkedIn' and the Premium-button row
    ]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { parseExport } = await import('../src/analytics/export-parser.js');
    const parsed = await parseExport(buffer);
    expect(parsed.kind).toBe('single_post');
    if (parsed.kind !== 'single_post') return;
    expect(parsed.lifetime.find((m) => m.metric === 'impressions')?.value).toBe(10);
    expect(parsed.lifetime.some((m) => m.metric === 'sends')).toBe(false);
  });
});
