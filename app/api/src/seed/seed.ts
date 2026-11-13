import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadEnv } from '../env';
import { DB, type ForgeDb } from '../db/client';
import { assets, posts as postsTable } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import { parseExport } from '../analytics/export-parser';
import type { ParsedSinglePost } from '../analytics/export-types';
import { PlaybookService } from '../playbook/playbook.service';
import { PostsService } from '../posts/posts.service';
import { SettingsService } from '../settings/settings.service';
import { GOAL_DOC, PERSONA_DOC, POST1, SEED_RULES, SEED_SNAPSHOT_CAPTURED_AT, STYLE_DOCS } from './seed-content';

// cwd-coupled by design (same known trait as migrate.ts): run ONLY from app/api —
// `npm run db:seed` and vitest both do. designLanguageDoc reads the repo-tracked
// research/kevinshibuya-design-language.md (verified present, contains the phrase
// "design language" that seed.spec asserts on).
const FIXTURE_PATH = join(process.cwd(), 'test/fixtures/synthetic-exports/seed-post.xlsx');
const REPO_ROOT = join(process.cwd(), '..', '..');

export async function runSeed(
  ctx: Pick<INestApplicationContext, 'get'>,
  log: (msg: string) => void = console.log,
): Promise<{ skipped: boolean }> {
  const posts = ctx.get(PostsService);
  const playbook = ctx.get(PlaybookService);
  const analytics = ctx.get(AnalyticsService);
  const settings = ctx.get(SettingsService);
  const db = ctx.get<ForgeDb>(DB);

  const fixture = await readFile(FIXTURE_PATH);
  // the fixture is post #1's own single-post export; the classifier proves the shape
  const parsed = (await parseExport(fixture)) as ParsedSinglePost;

  // The seed fills an empty database. Matching on post #1's URL is not enough: a database seeded
  // from an earlier export holds a post #1 under a different URL, and a URL check would add a second.
  if ((await db.$count(postsTable)) > 0) {
    log('seed: the database already holds posts, skipping');
    return { skipped: true };
  }

  // 1. documents into settings
  let designLanguageDoc = '';
  try {
    designLanguageDoc = await readFile(join(REPO_ROOT, 'research/kevinshibuya-design-language.md'), 'utf8');
  } catch {
    log('seed: WARNING — research/kevinshibuya-design-language.md not readable; designLanguageDoc left empty');
  }
  await settings.update({ personaDoc: PERSONA_DOC, goalDoc: GOAL_DOC, designLanguageDoc, styleDocs: STYLE_DOCS });
  log('seed: persona/goal/design-language docs and style docs stored');

  // 2. playbook rules (skip any already present by exact text)
  const existing = new Set((await playbook.listRules()).map((r) => r.rule));
  for (const rule of SEED_RULES) {
    if (!existing.has(rule.rule)) await playbook.addRule({ ...rule, provenance: 'seed' });
  }
  log(`seed: ${SEED_RULES.length} playbook rules ensured`);

  // 3. post #1 through the real state machine
  const publishedAt = new Date(parsed.publishedAt);
  const post = await posts.create({ tier: 'T1' });
  await posts.updateBody(post.id, { body: POST1.body, source: 'manual_edit' }); // embeds via the normal write-path
  await posts.patchMeta(post.id, { hook: POST1.hook, hashtags: POST1.hashtags, topicTags: POST1.topicTags });
  await posts.beginDrafting(post.id);
  await posts.endDrafting(post.id);
  await posts.approve(post.id);
  await posts.publish(post.id, { linkedinUrl: parsed.postUrl, publishedAt });

  // 4. analytics snapshot from the real export (marks the post measured)
  await analytics.importXlsx(
    { buffer: fixture, originalname: 'seed-post.xlsx' },
    { capturedAt: SEED_SNAPSHOT_CAPTURED_AT },
  );

  // 5. the post's image as an asset row (built by scripts/make-seed-asset.mjs) (direct insert — assets has no owning module until Plan 3)
  const htmlSource = await readFile(join(REPO_ROOT, 'post-assets/idle-transaction.html'), 'utf8');
  await db.insert(assets).values({
    postId: post.id,
    lane: 'html',
    htmlSource,
    pngPath: 'post-assets/idle-transaction.png',
    width: 1200,
    height: 1200,
    isSelected: true,
  });

  log(`seed: post #1 seeded as measured (post id ${post.id})`);
  log('seed: note — without OPENAI_API_KEY the post embedding sits in the retry queue until the key is set');
  return { skipped: false };
}

// compiled entry point is dist/seed/seed.js (see the package.json db:seed script comment below
// for why this runs through the swc build instead of tsx directly).
const invokedDirectly = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (invokedDirectly) {
  void (async () => {
    loadEnv(); // so the seeded post #1 embeds immediately when OPENAI_API_KEY is in .env
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
    try {
      await runSeed(app);
    } catch (err: unknown) {
      console.error('seed failed:', err);
      process.exitCode = 1;
    } finally {
      await app.close();
      // DbModule never registers a shutdown hook to close the underlying postgres pool
      // (no module owns that lifecycle today), so open sockets would otherwise keep the
      // event loop alive indefinitely on both the success and failure paths.
      process.exit(process.exitCode ?? 0);
    }
  })();
}
