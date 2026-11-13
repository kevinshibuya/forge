import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import { migrateDb } from '../src/db/migrate';
import { createDb, type ForgeDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { SettingsService } from '../src/settings/settings.service';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { IdeasModule } from '../src/ideas/ideas.module';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { PlaybookModule } from '../src/playbook/playbook.module';
import { PlanningModule } from '../src/planning/planning.module';
import { PlanningService } from '../src/planning/planning.service';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, ideas as ideasTable, postRevisions, posts as postsTable,
  runs as runsTable, settings as settingsTable,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

/**
 * Regressions from the PR review. Kept out of the upstream acceptance specs on purpose — those are
 * the slice contracts and stay untouched.
 */
describe('review fixes: published ⇒ no schedule, clock-face + year bounds', () => {
  let app: INestApplication;
  let planning: PlanningService;
  let posts: PostsService;
  let settingsSvc: SettingsService;
  let db: ForgeDb;
  // Tuesday 2027-03-09; the selected week is mon 2027-03-08 .. sun 2027-03-14
  const now = DateTime.fromISO('2027-03-09T09:00:00', { zone: TZ });
  let publishedId = 0;   // scheduled wed 14:00, then published mon — via PostsService.publish()
  let backdoorId = 0;    // published row written straight to the db, schedule columns left set
  let httpId = 0;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    db = createDb(url);
    // forge_test is shared across spec files; own the whole content graph for this file.
    await db.delete(postRevisions); await db.delete(assets);
    await db.delete(factPostLifetime); await db.delete(factWindowMetric); await db.delete(factAudienceSegment);
    await db.delete(factProfileMetric); await db.delete(dimPost); await db.delete(sourceFiles);
    await db.delete(runsTable); await db.delete(postsTable); await db.delete(ideasTable);
    await db.delete(settingsTable);

    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule, IdeasModule, AnalyticsModule, PlaybookModule, PlanningModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    planning = mod.get(PlanningService);
    posts = mod.get(PostsService);
    settingsSvc = mod.get(SettingsService);
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });

    // the post under test: booked wed 2027-03-10 at 14:00, then actually published mon 2027-03-08.
    // A NON-null time is the whole point — a null one cannot tell a cleared schedule from a kept one.
    const p = await posts.create({ tier: 'T1' });
    publishedId = p.id;
    await posts.setSchedule(publishedId, { date: '2027-03-10', time: '14:00' });
    // publish() only transitions out of 'approved'; the drafting ladder is not what is under test
    await db.update(postsTable).set({ status: 'approved' }).where(eq(postsTable.id, publishedId));
    await posts.publish(publishedId, {
      linkedinUrl: 'https://linkedin.com/feed/update/review-fix',
      publishedAt: DateTime.fromISO('2027-03-08T11:00:00', { zone: TZ }).toJSDate(),
    });

    // a published row whose schedule columns survived — i.e. any path that bypasses publish()
    const [b] = await db.insert(postsTable).values({
      tier: 'T2',
      status: 'published',
      scheduledDate: '2027-03-11',
      scheduledTime: '09:15',
      publishedAt: DateTime.fromISO('2027-03-08T12:00:00', { zone: TZ }).toJSDate(),
    }).returning();
    backdoorId = b!.id;

    httpId = (await posts.create({ tier: 'T3' })).id;
  });

  afterAll(async () => {
    // leave the shared settings row at the schema default for whichever file runs next
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
  });

  it('publish() clears the schedule columns', async () => {
    const row = await posts.get(publishedId);
    expect(row.publishedAt).not.toBeNull();
    expect(row.scheduledDate).toBeNull();
    expect(row.scheduledTime).toBeNull();
  });

  it('the planner shows no time on a published post, on its published day', async () => {
    const p = await planning.plannerData('2027-03-09', now);
    const mon = p.week.find((l) => l.date === '2027-03-08')!;
    const wed = p.week.find((l) => l.date === '2027-03-10')!;

    const item = mon.posts.find((x) => x.id === publishedId);
    expect(item, 'published post belongs to its published day').toBeDefined();
    expect(item!.scheduledTime).toBeNull();          // NOT '14:00' — that plan was abandoned
    expect(wed.posts.map((x) => x.id)).not.toContain(publishedId);

    // defensive: even a row that kept its columns must not render an abandoned time
    const backdoor = mon.posts.find((x) => x.id === backdoorId)!;
    expect(backdoor.scheduledTime).toBeNull();
  });

  it('rejects a 24:00 clock face with 400, and still accepts 23:59', async () => {
    await request(app.getHttpServer()).patch(`/api/posts/${httpId}/schedule`)
      .send({ date: '2027-04-02', time: '24:00' }).expect(400);

    const ok = await request(app.getHttpServer()).patch(`/api/posts/${httpId}/schedule`)
      .send({ date: '2027-04-02', time: '23:59' }).expect(200);
    expect(ok.body.scheduledTime).toBe('23:59:00');
  });

  it('rejects year-0 dates with 400, not a driver 500', async () => {
    const res = await request(app.getHttpServer()).patch(`/api/posts/${httpId}/schedule`)
      .send({ date: '0000-01-01' }).expect(400);
    expect(res.body.message).not.toBe('Internal server error');
    // and the stored schedule is untouched by the rejected write
    expect((await posts.get(httpId)).scheduledDate).toBe('2027-04-02');
  });
});
