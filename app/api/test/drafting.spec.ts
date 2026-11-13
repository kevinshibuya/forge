import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { createDb } from '../src/db/client';
import { postInputs } from '../src/db/schema';
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
import { PlaybookModule } from '../src/playbook/playbook.module';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { RunnerModule } from '../src/runner/runner.module';
import { RetrievalModule } from '../src/retrieval/retrieval.module';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { DraftingModule } from '../src/drafting/drafting.module';
import { DraftingService } from '../src/drafting/drafting.service';
import { InputsService } from '../src/inputs/inputs.service';
import { CONTRACT_LINE, DraftOutputSchema, lintTells, type StyleDoc } from '@forge/shared';
import type { EngineRequest, EngineResult } from '../src/engines/engine.interface';
import { DraftBodySchema } from '../src/drafting/drafting.controller';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApp } from '../src/app.setup';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';

const GOOD_DRAFT = JSON.stringify({
  body_linkedin: 'the drafted body\nwith a second line',
  hashtags: ['#AIEngineering'],
  image_concept: 'the ladder as a gate',
});

const ALL_MODULES = [
  DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule,
  RetrievalModule, PostsModule, IdeasModule, PlaybookModule, AnalyticsModule, DraftingModule,
];

class ThrowingProvider extends FakeEmbeddingProvider {
  override embed(): Promise<number[][]> { return Promise.reject(new Error('openai down')); }
}

async function build(draftResponse: string, provider = new FakeEmbeddingProvider(), opts: { claude?: FakeEngine } = {}) {
  const claude = opts.claude ?? new FakeEngine({ draft: draftResponse });
  const mod = await Test.createTestingModule({ imports: ALL_MODULES })
    .overrideProvider(EMBEDDING_PROVIDER).useValue(provider)
    .overrideProvider(ENGINES).useValue({ claude, codex: new FakeEngine({}) })
    .compile();
  return {
    mod,
    drafting: mod.get(DraftingService),
    posts: mod.get(PostsService),
    ideas: mod.get(IdeasService),
    runs: mod.get(RunsService),
    settings: mod.get(SettingsService),
    inputs: mod.get(InputsService),
    claude,
  };
}

describe('DraftingService', () => {
  /** Whatever the shared row held before this file ran. Migration 0012 seeds the `unslop` doc
   *  into forge_test, so restoring a hard-coded [] would DELETE it, and 0012 is journalled as
   *  applied and will never put it back. */
  let priorStyleDocs: StyleDoc[] = [];

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    const { settings } = await build(GOOD_DRAFT);
    priorStyleDocs = (await settings.get()).styleDocs;
    await settings.update({
      styleDocs: [{ id: 'test-doc', name: 'test doc', body: 'no exclamation marks.', enabled: true, excludedKinds: [] }],
    });
  });

  afterAll(async () => {
    const { settings } = await build(GOOD_DRAFT);
    await settings.update({ styleDocs: priorStyleDocs });
  });

  it('draft happy path: 202-shape launch, then body + hashtags + draft_ready + revision', async () => {
    const { drafting, posts, ideas, runs } = await build(GOOD_DRAFT);
    const idea = await ideas.create({ rawText: 'what survived the fable window', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T1' });

    const launch = await drafting.launchDraft(postId);
    expect(launch.degraded).toBe(false);
    expect(launch.runId).toBeGreaterThan(0);
    expect((await posts.get(postId)).status).toBe('drafting');

    await launch.finished;
    const { post, revisions, latestDraft } = await posts.detail(postId);
    expect(post.status).toBe('draft_ready');
    expect(post.bodyLinkedin).toBe('the drafted body\nwith a second line');
    expect(post.hook).toBe('the drafted body');
    expect(post.hashtags).toEqual(['#AIEngineering']);
    expect(revisions[0]!.source).toBe(`run:${launch.runId}`);
    expect(latestDraft!.id).toBe(launch.runId);
    const run = await runs.get(launch.runId);
    expect(run.status).toBe('succeeded');
    expect(run.postId).toBe(postId);
    expect(run.prompt).toContain('what survived the fable window');
    expect(run.prompt).toContain('## persona');
    expect(run.prompt).toContain('## style: test doc');
    expect(run.prompt).toContain(CONTRACT_LINE);
    // The stored output is the bare payload, never the engine's { result } wrapper, so every
    // existing reader of run.output keeps parsing a payload.
    expect(DraftOutputSchema.safeParse(JSON.parse(run.output!)).success).toBe(true);
    expect(JSON.parse(run.output!).result).toBeUndefined();
  });

  it("a succeeded draft's sources land on the post and on its revision", async () => {
    const cited = [
      { kind: 'file', ref: 'harness/agents/worker.md', note: 'the worker is pinned to opus' },
      { kind: 'web', ref: 'https://nodejs.org', note: 'the current lts' },
    ];
    const { drafting, posts, ideas } = await build(JSON.stringify({
      body_linkedin: 'a researched body', hashtags: ['#build'], sources: cited,
    }));
    const idea = await ideas.create({ rawText: 'what the run cited', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T1' });

    await (await drafting.launchDraft(postId)).finished;

    const { post: after, revisions } = await posts.detail(postId);
    expect(after.sources).toEqual(cited);
    expect(revisions[0]!.sources).toEqual(cited);
  });

  it('a draft that returned no sources key leaves the list the post already had', async () => {
    const kept = [{ kind: 'web' as const, ref: 'https://kept', note: 'set by hand' }];
    // GOOD_DRAFT carries no `sources` key.
    const { drafting, posts, ideas } = await build(GOOD_DRAFT);
    const idea = await ideas.create({ rawText: 'a plain draft, no research', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T1' });
    await posts.updateBody(postId, { sources: kept, source: 'manual_edit' });

    await (await drafting.launchDraft(postId)).finished;

    const { post: after, revisions } = await posts.detail(postId);
    expect(after.bodyLinkedin).toBe('the drafted body\nwith a second line'); // the draft did land
    expect(after.sources).toEqual(kept);
    expect(revisions[0]!.sources).toEqual(kept);
  });

  it('a draft that returns an empty sources list clears the list the post had', async () => {
    // The destructive half of the rule: a returned list replaces, an absent one leaves alone.
    const wiped = [{ kind: 'web' as const, ref: 'https://wiped', note: 'set by hand' }];
    const { drafting, posts, ideas } = await build(JSON.stringify({
      body_linkedin: 'a body citing nothing', hashtags: [], sources: [],
    }));
    const idea = await ideas.create({ rawText: 'a draft that cites nothing', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T1' });
    await posts.updateBody(postId, { sources: wiped, source: 'manual_edit' });

    await (await drafting.launchDraft(postId)).finished;

    const { post: after, revisions } = await posts.detail(postId);
    expect(after.sources).toEqual([]);
    expect(revisions[0]!.sources).toEqual([]);
  });

  it('a decline is a failed run that honoured the contract: envelope kept, no revision, post released', async () => {
    const decline = { outcome: 'declined', reason: 'placeholder idea', question: 'is post 5 a smoke test?' };
    const { drafting, posts, ideas, runs } = await build(JSON.stringify({ result: decline }));
    const idea = await ideas.create({ rawText: 'placeholder, safe to delete', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T3' });
    const launch = await drafting.launchDraft(postId);
    await launch.finished;

    const run = await runs.get(launch.runId);
    expect(run.status).toBe('failed');
    expect(run.failureKind).toBe('declined');
    expect(run.error).toBe('placeholder idea');
    expect(run.declined).toEqual(decline);
    expect(run.parsedOk).toBe(true);
    expect(run.tells).toEqual([]);
    const { post, revisions } = await posts.detail(postId);
    expect(post.status).toBe('queued');
    expect(revisions).toHaveLength(0);
  });

  it('persists the tells found in the drafted body', async () => {
    const body = 'the drafted body \u2014 with a dash';
    const { drafting, ideas, runs } = await build(JSON.stringify({ body_linkedin: body, hashtags: ['#clean'] }));
    const idea = await ideas.create({ rawText: 'a body with one dash', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
    const launch = await drafting.launchDraft(postId);
    await launch.finished;

    const run = await runs.get(launch.runId);
    expect(run.status).toBe('succeeded');
    expect(run.tells).toEqual([
      { id: 'em-dash', label: 'em dash', start: body.indexOf('\u2014'), end: body.indexOf('\u2014') + 1, field: 'body_linkedin' },
    ]);
  });

  it('the draft prompt carries no em dash of its own', async () => {
    // ThrowingProvider forces degraded mode, so no exemplar text can smuggle a dash in.
    const { drafting, ideas, runs } = await build(GOOD_DRAFT, new ThrowingProvider());
    const idea = await ideas.create({ rawText: 'a dash free idea', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
    const launch = await drafting.launchDraft(postId);
    await launch.finished;
    const run = await runs.get(launch.runId);
    expect(lintTells(run.prompt).filter((t) => t.id === 'em-dash')).toEqual([]);
  });

  it('second launch while drafting is a 409', async () => {
    // The first run is held open until the second launch has been refused. Without the gate this
    // races: the fake engine can finish, and `endDrafting` flip the status back, before the second
    // launch reaches `beginDrafting`, and then there is nothing left to refuse.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    class HeldEngine extends FakeEngine {
      override async run(req: EngineRequest): Promise<EngineResult> {
        await held;
        return super.run(req);
      }
    }

    const claude = new HeldEngine({ draft: GOOD_DRAFT });
    const { drafting, ideas } = await build(GOOD_DRAFT, new FakeEmbeddingProvider(), { claude });
    const idea = await ideas.create({ rawText: 'double draft', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T2' });

    const launch = await drafting.launchDraft(postId);
    await expect(drafting.launchDraft(postId)).rejects.toThrow();
    release();
    await launch.finished;
  });

  it('invalid engine output: run failed, post falls back to queued, nothing thrown', async () => {
    const { drafting, posts, ideas, runs } = await build('not json');
    const idea = await ideas.create({ rawText: 'bad output case', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T3' });
    const launch = await drafting.launchDraft(postId);
    await launch.finished;
    expect((await posts.get(postId)).status).toBe('queued');
    expect((await runs.get(launch.runId)).status).toBe('failed');
  });

  it('embedding outage degrades to constitution-only, draft still succeeds', async () => {
    const { drafting, posts, ideas } = await build(GOOD_DRAFT, new ThrowingProvider());
    const idea = await ideas.create({ rawText: 'degraded mode idea', source: 'evergreen' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
    const launch = await drafting.launchDraft(postId);
    expect(launch.degraded).toBe(true);
    await launch.finished;
    expect((await posts.get(postId)).status).toBe('draft_ready');
  });

  it('treats a draft posted with no body at all as a draft', () => {
    expect(DraftBodySchema.parse(undefined)).toEqual({});
    expect(DraftBodySchema.parse({})).toEqual({});
    expect(DraftBodySchema.parse({ research: false })).toEqual({ research: false });
    expect(DraftBodySchema.safeParse({ research: true }).success).toBe(false);
  });

  describe('a post with inputs', () => {
    afterAll(async () => {
      // forge_test is shared and post_inputs has a foreign key to posts: a row left here would
      // block every later spec that wipes the posts table.
      await createDb(url).delete(postInputs);
    });

    it('a post with inputs is refused at launch, on draft, refine and selection refine', async () => {
      const { drafting, posts, ideas, inputs, runs } = await build(GOOD_DRAFT);
      const idea = await ideas.create({ rawText: 'what the pasted brief says', source: 'work' });
      const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
      await posts.updateBody(postId, { body: 'a body to refine', source: 'manual_edit' });
      await inputs.attach(postId, { text: 'a pasted brief\nwith a second line' });

      const refusal = `post ${postId} has 1 inputs; a draft that reads inputs returns with slice 9 (input and research delivery)`;
      await expect(drafting.launchDraft(postId)).rejects.toThrow(refusal);
      await expect(drafting.launchRefine(postId, 'tighter')).rejects.toThrow(refusal);
      await expect(drafting.launchRefineSelection(postId, { selectionStart: 0, selectionEnd: 1, instruction: 'x' }))
        .rejects.toThrow(refusal);
      expect(await runs.list({ postId })).toEqual([]);
      // The refusal came before beginDrafting, so the post was never flipped to drafting.
      expect((await posts.get(postId)).status).not.toBe('drafting');
    });
  });

  it('a stale tab sending research: true gets a 400 and no run', async () => {
    const { mod, ideas, runs } = await build(GOOD_DRAFT);
    const app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    try {
      const idea = await ideas.create({ rawText: 'a stale tab asks for research', source: 'work' });
      const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
      const res = await request(app.getHttpServer()).post(`/api/posts/${postId}/draft`).send({ research: true });
      expect(res.status).toBe(400);
      expect(await runs.list({ postId })).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('refine embeds current body + feedback in the prompt', async () => {
    const { drafting, posts, ideas, runs } = await build(GOOD_DRAFT);
    const idea = await ideas.create({ rawText: 'refine me', source: 'work' });
    const { postId } = await ideas.promote(idea.id, { tier: 'T2' });
    const first = await drafting.launchDraft(postId);
    await first.finished;

    const refine = await drafting.launchRefine(postId, 'make the middle tighter');
    await refine.finished;
    const run = await runs.get(refine.runId);
    expect(run.prompt).toContain('## current draft');
    expect(run.prompt).toContain('make the middle tighter');
    expect((await posts.get(postId)).status).toBe('draft_ready');
    await expect(drafting.launchRefine(999_999, 'x')).rejects.toThrow();
  });
});
