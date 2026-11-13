import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DateTime } from 'luxon';
import type { INestApplication } from '@nestjs/common';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { AppModule } from '../src/app.module';
import { SettingsService } from '../src/settings/settings.service';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';
import { ImageComposeService } from '../src/images/image-compose.service';
import { ImagesService } from '../src/images/images.service';
import { RENDERER } from '../src/images/render.service';
import { FakeRenderer } from '../src/images/render.fake';
import {
  dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, embeddingJobs, embeddings, ideas, playbookRules, postRevisions, posts, runs,
} from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const TZ = 'America/Sao_Paulo';
const FIXTURE = 'test/fixtures/synthetic-exports/seed-post.xlsx';
const POST_URL = 'https://www.linkedin.com/posts/seed-example_synthetic-twin-post-share-9990000000000000101-AAAA';

const TRIAGE = '{"source":"work","suggested_tier":"T2","news_expiry_days":null,"notes":"strong insight angle"}';
const DRAFT = JSON.stringify({
  body_linkedin: 'e2e drafted body',
  hashtags: ['#AIEngineering'],
});
const RETRO = JSON.stringify({
  proposals: [{
    action: 'add', category: 'voice', target_rule_id: null,
    rule: 'e2e: lead with the strongest number', rationale: '1000 impressions on a numeric hook',
  }],
});
const IMAGE_HTML = '```html\n<!doctype html><html><body>x</body></html>\n```';

async function until(fn: () => Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('e2e happy path', () => {
  let app: INestApplication;
  let http!: () => ReturnType<typeof request>;
  let mod!: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const db = createDb(url);
    await db.delete(postRevisions); await db.delete(assets);
    await db.delete(factPostLifetime); await db.delete(factWindowMetric); await db.delete(factAudienceSegment);
    await db.delete(factProfileMetric); await db.delete(dimPost); await db.delete(sourceFiles);
    await db.delete(embeddings); await db.delete(embeddingJobs); await db.delete(runs);
    await db.delete(ideas); await db.delete(posts); await db.delete(playbookRules);

    mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({
        claude: new FakeEngine({ triage: TRIAGE, draft: DRAFT, retro: RETRO, image_html: IMAGE_HTML }),
        codex: new FakeEngine({}),
      })
      .overrideProvider(RENDERER).useValue(new FakeRenderer())
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());
    // the settings row survives every table delete above and is shared across spec files —
    // pin the scheduling block instead of inheriting whatever ran before this file
    await mod.get(SettingsService).update({ scheduling: { timezone: TZ, weeklyGoal: null } });
  });

  it('idea → triage → plan → draft → approve → publish → ingest → retro → rule', async () => {
    // intake + triage
    const idea = (await http().post('/api/ideas')
      .send({ rawText: 'what the agent ladder taught me', source: 'braindump' }).expect(201)).body;
    const triaged = (await http().post(`/api/ideas/${idea.id}/triage`).expect(201)).body;
    expect(triaged.ok).toBe(true);
    expect(triaged.idea.suggestedTier).toBe('T2');

    // plan: promote with no date at all, then book a day+time through the schedule endpoint
    const promoted = (await http().post(`/api/ideas/${idea.id}/promote`).send({ tier: 'T2' }).expect(201)).body;
    const postId: number = promoted.postId;
    expect((await http().get(`/api/posts/${postId}`)).body.post.scheduledDate).toBeNull();

    const day = DateTime.now().setZone(TZ).plus({ days: 3 }).toISODate()!;
    await http().patch(`/api/posts/${postId}/schedule`).send({ date: day, time: '10:30' }).expect(200);

    const planner = (await http().get(`/api/planner?date=${day}`).expect(200)).body;
    const lane = planner.week.find((l: { date: string }) => l.date === day);
    expect(lane.posts.map((p: { id: number }) => p.id)).toContain(postId);
    expect(lane.posts.find((p: { id: number }) => p.id === postId).scheduledTime).toBe('10:30');
    expect(planner.month.find((m: { date: string }) => m.date === day)?.scheduled).toBeGreaterThanOrEqual(1);

    // ...and it shows up on the dashboard as the next thing to publish
    const beforeDrafting = (await http().get('/api/dashboard').expect(200)).body;
    expect(beforeDrafting.upcoming.map((u: { id: number }) => u.id)).toContain(postId);
    expect(beforeDrafting.pendingActions.some((a: { kind: string; label: string }) =>
      a.kind === 'undrafted' && a.label.includes(day))).toBe(true);

    // draft (async 202) → wait for draft_ready
    const launch = (await http().post(`/api/posts/${postId}/draft`).expect(202)).body;
    expect(launch.runId).toBeGreaterThan(0);
    await until(async () =>
      (await http().get(`/api/posts/${postId}`)).body.post.status === 'draft_ready', 'draft_ready');

    // html-lane image candidate: launch → finished → 1 candidate → select
    const gen = mod.get(ImageComposeService);
    const imagesSvc = mod.get(ImagesService);
    const imgLaunch = await gen.launchHtml(postId, 'a 1200x1200 schematic');
    await imgLaunch.finished;
    const cands = await imagesSvc.listForPost(postId);
    expect(cands).toHaveLength(1);
    await imagesSvc.select(postId, cands[0]!.id);
    expect((await imagesSvc.listForPost(postId))[0]!.isSelected).toBe(true);

    // manual edit — hook derives from the body's first line, no pick step
    await http().post(`/api/posts/${postId}/body`).send({ body: 'e2e drafted body — hand-tightened' }).expect(201);
    expect((await http().get(`/api/posts/${postId}`)).body.post.hook).toBe('e2e drafted body — hand-tightened');

    // approve → publish with the fixture's url
    await http().post(`/api/posts/${postId}/approve`).expect(201);
    await http().post(`/api/posts/${postId}/publish`).send({ linkedinUrl: POST_URL }).expect(201);

    // ingest the real xlsx → measured
    await http().post('/api/analytics/import').attach('file', await readFile(FIXTURE), 'post1.xlsx').expect(201);
    expect((await http().get(`/api/posts/${postId}`)).body.post.status).toBe('measured');
    const board = (await http().get('/api/analytics/board?range=all').expect(200)).body;
    expect(board.posts.some((p: { postId: number | null }) => p.postId === postId)).toBe(true);

    // retro → proposals → approve → rule live with provenance
    const retro = (await http().post('/api/retro/run').expect(202)).body;
    await until(async () =>
      (await http().get(`/api/runs/${retro.runId}`)).body.status === 'succeeded', 'retro run');
    const { proposals } = (await http().get(`/api/retro/proposals/${retro.runId}`).expect(200)).body;
    expect(proposals).toHaveLength(1);
    await http().post(`/api/retro/proposals/${retro.runId}/decide`)
      .send({ decisions: [{ index: 0, approved: true }] }).expect(201);

    const rules = (await http().get('/api/playbook/rules?status=active').expect(200)).body;
    const added = rules.find((r: { rule: string }) => r.rule === 'e2e: lead with the strongest number');
    expect(added.provenance).toBe(`retro:${retro.runId}`);

    // dashboard reflects reality without erroring: the post has been published, so it is no longer
    // upcoming, and with no weekly goal configured there is no goal/streak to report
    const dash = (await http().get('/api/dashboard').expect(200)).body;
    expect(dash.upcoming.map((u: { id: number }) => u.id)).not.toContain(postId);
    expect(dash.goal).toBeNull();
    expect(dash.streakWeeks).toBeNull();
  });
});
