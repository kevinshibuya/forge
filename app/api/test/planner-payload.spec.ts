import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { BadRequestException } from '@nestjs/common';
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
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, ideas as ideasTable, postRevisions, posts as postsTable, runs as runsTable, settings as settingsTable,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';

describe('planner payload + dashboard (free-form model)', () => {
  let planning: PlanningService;
  let posts: PostsService;
  let settingsSvc: SettingsService;
  let db: ForgeDb;
  // Tuesday 2027-03-09; the selected week is mon 2027-03-08 .. sun 2027-03-14
  const now = DateTime.fromISO('2027-03-09T09:00:00', { zone: TZ });

  const publish = (id: number, iso: string) =>
    db.update(postsTable).set({ publishedAt: DateTime.fromISO(iso, { zone: TZ }).toJSDate(), status: 'published' })
      .where(eq(postsTable.id, id));

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    db = createDb(url);
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
    planning = mod.get(PlanningService);
    posts = mod.get(PostsService);
    settingsSvc = mod.get(SettingsService);
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: 2 } });

    // A: scheduled tue 2027-03-09 10:30, unpublished, hook set
    const a = await posts.create({ tier: 'T1' });
    await posts.patchMeta(a.id, { hook: 'the hybrid arc' });
    await posts.setSchedule(a.id, { date: '2027-03-09', time: '10:30' });
    // B: scheduled wed 2027-03-10, but PUBLISHED mon 2027-03-08 → appears only on 03-08
    const b = await posts.create({ tier: 'T2' });
    await posts.setSchedule(b.id, { date: '2027-03-10', time: null });
    await publish(b.id, '2027-03-08T11:00:00');
    // E: published tue 2027-03-09 (second publish this week)
    const e = await posts.create({ tier: 'T3' });
    await publish(e.id, '2027-03-09T08:00:00');
    // prior week: two published (03-02, 03-04) → streak continues
    const f = await posts.create({ tier: 'T1' }); await publish(f.id, '2027-03-02T10:00:00');
    const g = await posts.create({ tier: 'T2' }); await publish(g.id, '2027-03-04T10:00:00');
    // queue: C older, D newer, both unscheduled+unpublished
    const c = await posts.create({ tier: 'T3' });
    await new Promise((r) => setTimeout(r, 20));
    const d = await posts.create({ tier: 'T1' });
    Object.assign(globalThis, { __ids: { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id } });
  });

  afterAll(async () => {
    // the shared forge_test db persists across spec files (fileParallelism: false ≠ state isolation):
    // leave settings as the schema default so later specs asserting weeklyGoal null stay order-independent
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
  });

  it('places posts under the placement rule, in week AND month', async () => {
    const ids = (globalThis as unknown as { __ids: Record<'a' | 'b' | 'c' | 'd' | 'e', number> }).__ids;
    const p = await planning.plannerData('2027-03-09', now);
    expect(p.weekStart).toBe('2027-03-08');
    expect(p.week).toHaveLength(7);

    const mon = p.week.find((l) => l.date === '2027-03-08')!;
    const tue = p.week.find((l) => l.date === '2027-03-09')!;
    const wed = p.week.find((l) => l.date === '2027-03-10')!;
    expect(mon.posts.map((x) => x.id)).toContain(ids.b);   // published day wins
    expect(wed.posts.map((x) => x.id)).not.toContain(ids.b); // not its scheduled day
    expect(tue.posts.map((x) => x.id)).toEqual(expect.arrayContaining([ids.a, ids.e]));
    const aItem = tue.posts.find((x) => x.id === ids.a)!;
    expect(aItem.title).toBe('the hybrid arc');
    expect(aItem.scheduledTime).toBe('10:30');             // HH:mm, not HH:mm:ss

    expect(p.month).toHaveLength(31);                      // march
    const m8 = p.month.find((m) => m.date === '2027-03-08')!;
    const m9 = p.month.find((m) => m.date === '2027-03-09')!;
    const m10 = p.month.find((m) => m.date === '2027-03-10')!;
    expect(m8.published).toBe(1);
    expect(m9.scheduled).toBe(1);
    expect(m9.published).toBe(1);
    expect(m10.scheduled).toBe(0);                         // B counts nowhere but its published day
  });

  it('queue is oldest-first; untitled posts derive a label', async () => {
    const ids = (globalThis as unknown as { __ids: Record<'a' | 'b' | 'c' | 'd' | 'e', number> }).__ids;
    const p = await planning.plannerData('2027-03-09', now);
    const qIds = p.queue.map((x) => x.id);
    expect(qIds.indexOf(ids.c)).toBeLessThan(qIds.indexOf(ids.d));
    expect(p.queue.find((x) => x.id === ids.c)!.title).toBe(`post #${ids.c}`);
  });

  it('goal scopes to the selected week; streak counts the met in-progress week', async () => {
    const p = await planning.plannerData('2027-03-09', now);
    expect(p.goal).toEqual({ target: 2, publishedInWeek: 2 });   // B + E
    expect(p.streakWeeks).toBe(2);                                // this week (met) + prior week

    const prior = await planning.plannerData('2027-03-02', now);
    expect(prior.goal).toEqual({ target: 2, publishedInWeek: 2 }); // F + G, selected week
    expect(prior.streakWeeks).toBe(2);                             // streak is anchored to today, not selection

    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: 3 } });
    const raised = await planning.plannerData('2027-03-09', now);
    expect(raised.goal).toEqual({ target: 3, publishedInWeek: 2 });
    expect(raised.streakWeeks).toBe(0);                            // retroactive restating

    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: null } });
    const off = await planning.plannerData('2027-03-09', now);
    expect(off.goal).toBeNull();
    expect(off.streakWeeks).toBeNull();
    await settingsSvc.update({ scheduling: { timezone: TZ, weeklyGoal: 2 } });
  });

  it('rejects an invalid date', async () => {
    await expect(planning.plannerData('not-a-date', now)).rejects.toThrow(BadRequestException);
  });

  it('dashboard: upcoming ordered date-then-time-nulls-last, undrafted redefined', async () => {
    const ids = (globalThis as unknown as { __ids: Record<'a' | 'b' | 'c' | 'd' | 'e', number> }).__ids;
    // C scheduled thu (no time), D scheduled thu 08:00 → D before C; A (tue) first
    await posts.setSchedule(ids.c, { date: '2027-03-11', time: null });
    await posts.setSchedule(ids.d, { date: '2027-03-11', time: '08:00' });
    const dash = await planning.dashboard(now);
    expect(dash.upcoming.map((u) => u.id)).toEqual([ids.a, ids.d, ids.c]);
    expect(dash.goal).toEqual({ target: 2, publishedInWeek: 2 });
    expect(dash.streakWeeks).toBe(2);
    const undrafted = dash.pendingActions.filter((x) => x.kind === 'undrafted');
    expect(undrafted.length).toBeGreaterThanOrEqual(1);
    expect(undrafted.every((x) => x.href === '/planner')).toBe(true);
    expect(undrafted.some((x) => x.label.includes('2027-03-11'))).toBe(true);
    // cleanup: unschedule so later slices see a clean queue
    await posts.setSchedule(ids.c, null);
    await posts.setSchedule(ids.d, null);
  });

  it('dashboard exposes statusMix with zero-count statuses omitted, summing to all posts', async () => {
    const dash = await planning.dashboard(now);
    expect(dash.statusMix.length).toBeGreaterThan(0);
    expect(dash.statusMix.every((s) => s.count > 0)).toBe(true);
    const all = await posts.list();
    expect(dash.statusMix.reduce((n, s) => n + s.count, 0)).toBe(all.length);
  });

  it('scheduledCount matches the upcoming predicate, uncapped by the top-5 slice', async () => {
    const dash = await planning.dashboard(now);
    const all = await posts.list();
    const today = now.toISODate()!;
    const expected = all.filter((p) => p.publishedAt === null && p.scheduledDate !== null && p.scheduledDate >= today).length;
    expect(dash.scheduledCount).toBe(expected);
    expect(dash.upcoming.length).toBeLessThanOrEqual(5);
  });

  it('planner?from/to returns one entry per day inclusive, empty days included, placed by the existing rule', async () => {
    const p = await posts.create({ tier: 'T2' });
    await db.update(postsTable).set({ scheduledDate: '2027-03-12', scheduledTime: '09:30:00' }).where(eq(postsTable.id, p.id));
    const s = await planning.plannerStream({ from: '2027-03-09', to: '2027-03-15' }, now);
    expect(s.days.map((d) => d.date)).toEqual([
      '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15',
    ]);
    const lane = s.days.find((d) => d.date === '2027-03-12')!;
    expect(lane.posts.some((x) => x.id === p.id && x.scheduledTime === '09:30')).toBe(true);
    await db.delete(postsTable).where(eq(postsTable.id, p.id));
  });

  it('earlierCount counts missed schedules AND published history strictly before `from`', async () => {
    const missed = await posts.create({ tier: 'T2' });
    await db.update(postsTable).set({ scheduledDate: '2027-03-01' }).where(eq(postsTable.id, missed.id));
    const done = await posts.create({ tier: 'T2' });
    await publish(done.id, '2027-02-20T12:00:00');
    const s = await planning.plannerStream({ from: '2027-03-09', to: '2027-03-15' }, now);
    const all = await posts.list();
    const missedN = all.filter((x) => x.publishedAt === null && x.scheduledDate !== null && x.scheduledDate < '2027-03-09').length;
    const publishedN = all.filter((x) => x.publishedAt !== null && DateTime.fromJSDate(x.publishedAt).setZone(TZ).toISODate()! < '2027-03-09').length;
    expect(missedN).toBeGreaterThanOrEqual(1);
    expect(publishedN).toBeGreaterThanOrEqual(1);
    expect(s.earlierCount).toBe(missedN + publishedN);
    await db.delete(postsTable).where(eq(postsTable.id, missed.id));
    await db.delete(postsTable).where(eq(postsTable.id, done.id));
  });

  it('a published post appears on its published day inside the range', async () => {
    const p = await posts.create({ tier: 'T2' });
    await publish(p.id, '2027-03-10T15:00:00');
    const s = await planning.plannerStream({ from: '2027-03-09', to: '2027-03-15' }, now);
    expect(s.days.find((d) => d.date === '2027-03-10')!.posts.some((x) => x.id === p.id)).toBe(true);
    await db.delete(postsTable).where(eq(postsTable.id, p.id));
  });

  it('validates the pair: lone param, inversion, bad ISO, and >366-day spans all 400', async () => {
    await expect(planning.plannerStream({ from: '2027-03-09', to: 'nope' }, now)).rejects.toBeInstanceOf(BadRequestException);
    await expect(planning.plannerStream({ from: '2027-03-15', to: '2027-03-09' }, now)).rejects.toBeInstanceOf(BadRequestException);
    await expect(planning.plannerStream({ from: '2026-01-01', to: '2027-03-09' }, now)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('month array follows the anchor and defaults to the month of `from`', async () => {
    const def = await planning.plannerStream({ from: '2027-03-09', to: '2027-04-05' }, now);
    expect(def.month[0]!.date.slice(0, 7)).toBe('2027-03');
    const apr = await planning.plannerStream({ from: '2027-03-09', to: '2027-04-05', month: '2027-04-15' }, now);
    expect(apr.month[0]!.date.slice(0, 7)).toBe('2027-04');
    expect(apr.month).toHaveLength(30);
  });
});
