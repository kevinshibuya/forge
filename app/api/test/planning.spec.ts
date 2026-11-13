import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
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
import { IdeasService } from '../src/ideas/ideas.service';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { PlaybookModule } from '../src/playbook/playbook.module';
import { PlanningModule } from '../src/planning/planning.module';
import { PlanningService } from '../src/planning/planning.service';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, ideas as ideasTable, postRevisions, posts as postsTable, runs as runsTable,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

/**
 * Companion to `planner-payload.spec.ts`: that one pins the placement rule and the goal/streak
 * arithmetic on a mid-March week. This one pins the edges the anchor week/month can have —
 * an ISO week that spills out of the selected month, the "no goal configured" payload, and the
 * dashboard's own filters (past dates, the cap, which posts count as undrafted).
 *
 * Anchor: Fri 2027-01-01 — its ISO week is 2026-12-28 .. 2027-01-03, so the week straddles both
 * the month and the year boundary while the month itself is January (31 days).
 */
describe('PlanningService (free-form scheduling)', () => {
  let planning: PlanningService;
  let posts: PostsService;
  let ideas: IdeasService;
  let settingsSvc: SettingsService;
  let db: ForgeDb;
  const now = DateTime.fromISO('2027-01-01T09:00:00', { zone: TZ });

  // p1 scheduled in the PREVIOUS month (still inside the selected ISO week)
  // p2 scheduled Sat 2027-01-02 14:00, drafted → draft_ready
  // p3 unscheduled, unpublished → the queue
  // p5 published Fri 2027-01-01 08:00 (never scheduled)
  // q[] six queued posts scheduled 2027-01-20..25 → dashboard cap + undrafted
  const ids = { p1: 0, p2: 0, p3: 0, p5: 0, q: [] as number[] };

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    db = createDb(url);
    // absolute counts below only hold against tables this file owns; the forge_test db is shared
    // across spec FILES (fileParallelism: false serializes them, it does not isolate them).
    await db.delete(postRevisions); await db.delete(assets);
    await db.delete(factPostLifetime); await db.delete(factWindowMetric); await db.delete(factAudienceSegment);
    await db.delete(factProfileMetric); await db.delete(dimPost); await db.delete(sourceFiles);
    await db.delete(runsTable); await db.delete(postsTable); await db.delete(ideasTable);

    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule, IdeasModule, AnalyticsModule, PlaybookModule, PlanningModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: new FakeEngine({}), codex: new FakeEngine({}) })
      .compile();
    planning = mod.get(PlanningService);
    posts = mod.get(PostsService);
    ideas = mod.get(IdeasService);
    settingsSvc = mod.get(SettingsService);
    // never inherit whatever the previous spec file left in the settings row
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });

    const p1 = await posts.create({ tier: 'T1' });
    await posts.setSchedule(p1.id, { date: '2026-12-30', time: null });

    const p2 = await posts.create({ tier: 'T2' });
    await posts.setSchedule(p2.id, { date: '2027-01-02', time: '14:00' });
    await posts.updateBody(p2.id, { body: 'a drafted body whose first line is the hook\n\nand a second paragraph', source: 'manual_edit' });
    await posts.beginDrafting(p2.id);
    await posts.endDrafting(p2.id); // → draft_ready, since it has a body

    const p3 = await posts.create({ tier: 'T3' });

    const p5 = await posts.create({ tier: 'T1' });
    await db.update(postsTable)
      .set({ status: 'published', publishedAt: DateTime.fromISO('2027-01-01T08:00:00', { zone: TZ }).toJSDate() })
      .where(eq(postsTable.id, p5.id));

    for (const day of ['2027-01-20', '2027-01-21', '2027-01-22', '2027-01-23', '2027-01-24', '2027-01-25']) {
      const q = await posts.create({ tier: 'T3' });
      await posts.setSchedule(q.id, { date: day, time: null });
      ids.q.push(q.id);
    }
    Object.assign(ids, { p1: p1.id, p2: p2.id, p3: p3.id, p5: p5.id });
  });

  afterAll(async () => {
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
  });

  it('with no date, anchors on today; the ISO week may spill out of the selected month', async () => {
    const p = await planning.plannerData(undefined, now);
    expect(p.weekStart).toBe('2026-12-28');
    expect(p.week.map((l) => l.date)).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);

    const dec30 = p.week.find((l) => l.date === '2026-12-30')!;
    expect(dec30.posts.map((x) => x.id)).toEqual([ids.p1]);
    expect(dec30.posts[0]!.scheduledTime).toBeNull();
    expect(dec30.posts[0]!.publishedAt).toBeNull();

    const jan2 = p.week.find((l) => l.date === '2027-01-02')!;
    expect(jan2.posts.map((x) => x.id)).toEqual([ids.p2]);
    expect(jan2.posts[0]!.scheduledTime).toBe('14:00');
    expect(jan2.posts[0]!.title).toBe('a drafted body whose first line is the hook'); // hook, not the body
    expect(jan2.posts[0]!.status).toBe('draft_ready');

    const jan1 = p.week.find((l) => l.date === '2027-01-01')!;
    expect(jan1.posts.map((x) => x.id)).toEqual([ids.p5]);
    expect(jan1.posts[0]!.publishedAt).not.toBeNull();

    // the month is January alone — the December part of the week is not summarised anywhere
    expect(p.month).toHaveLength(31);
    expect(p.month[0]!.date).toBe('2027-01-01');
    expect(p.month.at(-1)!.date).toBe('2027-01-31');
    expect(p.month.some((m) => m.date.startsWith('2026-'))).toBe(false);
    expect(p.month.find((m) => m.date === '2027-01-01')).toEqual({ date: '2027-01-01', scheduled: 0, published: 1 });
    expect(p.month.find((m) => m.date === '2027-01-02')).toEqual({ date: '2027-01-02', scheduled: 1, published: 0 });
    expect(p.month.find((m) => m.date === '2027-01-03')).toEqual({ date: '2027-01-03', scheduled: 0, published: 0 });
  });

  it('an explicit date selects that week/month without moving anything else', async () => {
    const p = await planning.plannerData('2027-01-21', now); // Thursday
    expect(p.weekStart).toBe('2027-01-18');
    expect(p.month).toHaveLength(31); // same month as the default anchor
    const jan21 = p.week.find((l) => l.date === '2027-01-21')!;
    expect(jan21.posts.map((x) => x.id)).toEqual([ids.q[1]]);
    expect(p.week.find((l) => l.date === '2027-01-19')!.posts).toEqual([]);
  });

  it('the queue holds only unpublished, unscheduled posts', async () => {
    const p = await planning.plannerData(undefined, now);
    expect(p.queue.map((x) => x.id)).toEqual([ids.p3]); // p1/p2/q[] are scheduled, p5 is published
    expect(p.queue[0]!.title).toBe(`post #${ids.p3}`);
    expect(p.queue[0]!.tier).toBe('T3');
  });

  it('with no weekly goal configured, goal and streak are null on both surfaces', async () => {
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
    const p = await planning.plannerData(undefined, now);
    expect(p.goal).toBeNull();
    expect(p.streakWeeks).toBeNull();
    const dash = await planning.dashboard(now);
    expect(dash.goal).toBeNull();
    expect(dash.streakWeeks).toBeNull();
  });

  it('a goal reports 0 for a week with no publishes, while the streak stays anchored on today', async () => {
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: 1 } });
    const empty = await planning.plannerData('2027-01-21', now); // nothing published that week
    expect(empty.goal).toEqual({ target: 1, publishedInWeek: 0 });
    expect(empty.streakWeeks).toBe(1); // today's week has p5 → met; the week before it has none
    const current = await planning.plannerData(undefined, now);
    expect(current.goal).toEqual({ target: 1, publishedInWeek: 1 });
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
  });

  it('dashboard upcoming: future-or-today only, earliest first, capped at 5', async () => {
    const dash = await planning.dashboard(now);
    // p1 (2026-12-30) is in the past and p5 is published — neither is upcoming
    expect(dash.upcoming.map((u) => u.id)).toEqual([ids.p2, ...ids.q.slice(0, 4)]);
    expect(dash.upcoming[0]).toMatchObject({
      id: ids.p2, scheduledDate: '2027-01-02', scheduledTime: '14:00', status: 'draft_ready',
    });
    expect(dash.upcoming[1]!.scheduledTime).toBeNull();
  });

  it('dashboard pending actions: undrafted is per future post, and idea actions still fire', async () => {
    await ideas.create({ rawText: 'untriaged idea for the dashboard', source: 'braindump' });
    const dash = await planning.dashboard(now);

    const undrafted = dash.pendingActions.filter((a) => a.kind === 'undrafted');
    expect(undrafted).toHaveLength(6); // the six queued q[] posts
    expect(undrafted.every((a) => a.href === '/planner')).toBe(true);
    expect(undrafted.some((a) => a.label === `「post #${ids.q[0]}」 scheduled 2027-01-20, not drafted`)).toBe(true);
    // p2 is scheduled in the future but already draft_ready; p1 is undrafted but its day has passed
    expect(undrafted.some((a) => a.label.includes('2027-01-02'))).toBe(false);
    expect(undrafted.some((a) => a.label.includes('2026-12-30'))).toBe(false);

    expect(dash.pendingActions.some((a) => a.kind === 'untriaged')).toBe(true);
  });
});
