import { beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { ENGINES } from '../src/engines/engine.interface';
import type { Engine, EngineRequest, EngineResult } from '../src/engines/engine.interface';
import { FakeEngine, structuredFrom } from '../src/engines/fake.engine';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { PlaybookModule } from '../src/playbook/playbook.module';
import { PlaybookService } from '../src/playbook/playbook.service';
import { RetroService } from '../src/playbook/retro.service';
import { insertMeasured } from './helpers/measured';
import { dimPost, factAudienceSegment, factPostLifetime, factProfileMetric, factWindowMetric, sourceFiles, assets, playbookRules, postRevisions, posts as postsTable, runs as runsTable } from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

/** FakeEngine whose retro response is set AFTER module compilation (target ids are dynamic). */
class ScriptedEngine implements Engine {
  readonly name = 'fake' as const;
  response = '{}';
  async run(_req: EngineRequest): Promise<EngineResult> {
    return { output: this.response, structured: structuredFrom(this.response) };
  }
}

describe('RetroService', () => {
  let retro: RetroService;
  let playbook: PlaybookService;
  let posts: PostsService;
  let analytics: AnalyticsService;
  const engine = new ScriptedEngine();
  const db = createDb(url);

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    // eligibility asserts absolute counts — clear everything measured-related, not just rules/runs
    await db.delete(postRevisions); await db.delete(assets);
    await db.delete(factPostLifetime); await db.delete(factWindowMetric); await db.delete(factAudienceSegment);
    await db.delete(factProfileMetric); await db.delete(dimPost); await db.delete(sourceFiles);
    await db.delete(runsTable); await db.delete(postsTable); await db.delete(playbookRules);
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, PostsModule, AnalyticsModule, PlaybookModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude: engine, codex: new FakeEngine({}) })
      .compile();
    retro = mod.get(RetroService);
    playbook = mod.get(PlaybookService);
    posts = mod.get(PostsService);
    analytics = mod.get(AnalyticsService);
  });

  it('eligibility counts measured posts since the last retro', async () => {
    const before = await retro.eligibility();
    expect(before.eligible).toBe(false);
    expect(before.lastRetroAt).toBeNull();

    const post = await posts.create({ tier: 'T2' });
    await posts.updateBody(post.id, { body: 'measured body', source: 'manual_edit' });
    await posts.patchMeta(post.id, { hook: 'h' });
    await posts.beginDrafting(post.id); await posts.endDrafting(post.id);
    await posts.approve(post.id);
    await posts.publish(post.id, { linkedinUrl: 'https://linkedin.com/posts/retro-1' });
    await insertMeasured(db, posts, {
      postId: post.id, impressions: 1000, reactions: 20, comments: 5, reposts: 1, saves: 0, followsGained: 3,
    });

    const after = await retro.eligibility();
    expect(after.measuredSince).toBe(await analytics.countMeasuredSince(null));
    expect(after.threshold).toBe(3);
  });

  it('launch → proposals → decide applies approved changes exactly once', async () => {
    const victim = await playbook.addRule({ category: 'timing', rule: 'old timing rule', provenance: 'seed' });
    engine.response = JSON.stringify({
      proposals: [
        { action: 'add', category: 'voice', target_rule_id: null, rule: 'lead with a number', rationale: '1000 impressions on the numeric hook' },
        { action: 'retire', category: 'timing', target_rule_id: victim.id, rule: null, rationale: 'timing showed no effect' },
        { action: 'add', category: 'structure', target_rule_id: null, rule: 'rejected proposal', rationale: 'weak evidence' },
      ],
    });

    const { runId, finished } = await retro.launchRetro();
    await finished;

    const { proposals } = await retro.proposals(runId);
    expect(proposals).toHaveLength(3);
    expect(proposals[1]!.targetRule!.rule).toBe('old timing rule');

    const result = await retro.decide(runId, [
      { index: 0, approved: true },
      { index: 1, approved: true },
      { index: 2, approved: false },
    ]);
    expect(result).toEqual({ applied: 2, rejected: 1 });

    const active = await playbook.activeRules();
    expect(active.some((r) => r.rule === 'lead with a number' && r.provenance === `retro:${runId}`)).toBe(true);
    expect(active.some((r) => r.id === victim.id)).toBe(false);
    expect(active.some((r) => r.rule === 'rejected proposal')).toBe(false);

    await expect(retro.decide(runId, [{ index: 0, approved: true }])).rejects.toThrow(/already/);
  });

  it('proposals for a run that does not exist is a 404, not a 500', async () => {
    // `RunsService.get` throws NotFoundException itself, so this caller needs no classifier and
    // an absent run stops reading as an api fault.
    await expect(retro.proposals(99_999_999)).rejects.toThrow(NotFoundException);
  });

  it('decide() rejects duplicate decision indices instead of double-applying', async () => {
    engine.response = JSON.stringify({
      proposals: [
        { action: 'add', category: 'voice', target_rule_id: null, rule: 'dedupe-test rule', rationale: 'r' },
      ],
    });

    const { runId, finished } = await retro.launchRetro();
    await finished;

    await expect(
      retro.decide(runId, [
        { index: 0, approved: true },
        { index: 0, approved: true },
      ]),
    ).rejects.toThrow(/duplicate/);

    const active = await playbook.activeRules();
    expect(active.filter((r) => r.rule === 'dedupe-test rule')).toHaveLength(0);
  });

  it('activeRulesAt pins its boundary edges: createdAt inclusive, retiredAt exclusive', async () => {
    // A rule with explicit, distinct created/retired timestamps so the boundary is unambiguous
    // (Task 5 review flagged t == createdAt and t == retiredAt as untested).
    const created = new Date('2026-01-01T00:00:00.000Z');
    const retired = new Date('2026-06-01T00:00:00.000Z');
    const [row] = await createDb(url).insert(playbookRules).values({
      category: 'voice', rule: 'boundary rule', provenance: 'seed',
      status: 'retired', createdAt: created, retiredAt: retired,
    }).returning();
    const id = row!.id;

    const atCreated = await playbook.activeRulesAt(created);
    expect(atCreated.some((r) => r.id === id)).toBe(true);   // createdAt inclusive

    const atRetired = await playbook.activeRulesAt(retired);
    expect(atRetired.some((r) => r.id === id)).toBe(false);  // retiredAt exclusive
  });
});
