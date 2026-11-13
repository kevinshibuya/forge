import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrateDb } from '../src/db/migrate';
import { DbModule } from '../src/db/db.module';
import { SettingsModule } from '../src/settings/settings.module';
import { EmbeddingsModule } from '../src/embeddings/embeddings.module';
import { EMBEDDING_PROVIDER } from '../src/embeddings/provider.interface';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { RunsModule } from '../src/runs/runs.module';
import { RunsService } from '../src/runs/runs.service';
import { PlaybookService } from '../src/playbook/playbook.service';
import { lintTells, type Source } from '@forge/shared';
import { RunnerModule } from '../src/runner/runner.module';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { PostsController } from '../src/posts/posts.controller';
import { DraftingModule } from '../src/drafting/drafting.module';
import { DraftingService } from '../src/drafting/drafting.service';
import { ENGINES } from '../src/engines/engine.interface';
import { FakeEngine } from '../src/engines/fake.engine';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://forge:forge@localhost:5433/forge_test';
const PROPOSED = 'The old body text, now sharper where selected.';

describe('A1 refine-selection', () => {
  let drafting: DraftingService;
  let posts: PostsService;
  let postsCtrl: PostsController;
  let runsSvc: RunsService;
  let claude: FakeEngine;
  let playbook: PlaybookService;
  let seededRuleIds: number[] = [];

  beforeAll(async () => {
    await migrateDb(url);
    process.env.DATABASE_URL = url;
    claude = new FakeEngine({ refine_selection: `\`\`\`json\n${JSON.stringify({ body_linkedin: PROPOSED })}\n\`\`\`` });
    const mod = await Test.createTestingModule({
      imports: [DbModule, SettingsModule, EmbeddingsModule, RunsModule, RunnerModule, PostsModule, DraftingModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER).useValue(new FakeEmbeddingProvider())
      .overrideProvider(ENGINES).useValue({ claude, codex: new FakeEngine({}) })
      .compile();
    drafting = mod.get(DraftingService);
    posts = mod.get(PostsService);
    postsCtrl = mod.get(PostsController);
    runsSvc = mod.get(RunsService);
    playbook = mod.get(PlaybookService);
    // Two rules the filter must separate. Retired in afterAll so the shared DB is left as found.
    const voice = await playbook.addRule({ category: 'voice', rule: 'no exclamation marks anywhere' });
    const structure = await playbook.addRule({ category: 'structure', rule: 'open on the sharpest line' });
    seededRuleIds = [voice.id, structure.id];
  });

  afterAll(async () => {
    for (const id of seededRuleIds) await playbook.retireRule(id).catch(() => undefined);
  });

  async function seededPost() {
    const post = await posts.create({ tier: 'T1' });
    await posts.updateBody(post.id, { body: 'The old body text here.', source: 'manual_edit' });
    await posts.patchMeta(post.id, { hashtags: ['#keep', '#these'] });
    return posts.get(post.id);
  }

  it('launches a refine_selection run whose prompt marks the selection, and never touches the post', async () => {
    const post = await seededPost();
    const { runId } = await drafting.launchRefineSelection(post.id, { selectionStart: 4, selectionEnd: 12, instruction: 'punchier' });
    // wait for the fire-and-forget run to reach a terminal state
    for (let i = 0; i < 50 && (await runsSvc.get(runId)).status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    const run = await runsSvc.get(runId);
    expect(run.kind).toBe('refine_selection');
    expect(run.status).toBe('succeeded');
    expect(run.prompt).toContain('<<<SELECTED>>>old body<<<END SELECTED>>>');
    expect(run.prompt).toContain('punchier');
    expect(run.prompt).toContain('## persona');
    expect(run.prompt).toContain('no exclamation marks anywhere');       // voice rules ride along
    expect(run.prompt).not.toContain('open on the sharpest line');       // every other category does not
    expect(lintTells(run.prompt).filter((t) => t.id === 'em-dash')).toEqual([]);
    const after = await posts.get(post.id);
    expect(after.bodyLinkedin).toBe('The old body text here.'); // proposal NOT applied
    expect(after.hashtags).toEqual(['#keep', '#these']);        // hashtags NEVER touched
    expect(after.status).toBe(post.status);                     // no beginDrafting status mutation

    const proposal = await drafting.getRefineSelectionProposal(post.id, runId);
    expect(proposal.proposedBody).toBe(PROPOSED);
  });

  /** A succeeded refine_selection run on `postId`, with the Sources its output claims. */
  async function seededRefineRun(postId: number, sources: Source[]): Promise<number> {
    const runId = await runsSvc.start({
      engine: 'claude', kind: 'refine_selection', model: 'claude-opus-5', prompt: 'refine', postId,
    });
    await runsSvc.succeed(runId, JSON.stringify({ body_linkedin: PROPOSED, sources }), true);
    return runId;
  }

  it('accepting through the controller with sourceRunId creates a run-attributed revision', async () => {
    const post = await seededPost();
    // sourceRunId now drives a write as well as attribution, so it has to name a real run.
    const runId = await seededRefineRun(post.id, []);
    await postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: runId });
    const detail = await posts.detail(post.id);
    expect(detail.post.bodyLinkedin).toBe(PROPOSED);
    expect(detail.revisions[0]!.source).toBe(`run:${runId}`);
    // without sourceRunId the existing attribution is byte-identical
    await postsCtrl.updateBody(post.id, { body: 'hand-tuned again' });
    expect((await posts.detail(post.id)).revisions[0]!.source).toBe('manual_edit');
  });

  it("accepting appends the run's sources, keeping the note already on a ref it repeats", async () => {
    const post = await seededPost();
    await postsCtrl.updateBody(post.id, { sources: [{ kind: 'web', ref: 'https://a', note: 'kept' }] });
    const runId = await seededRefineRun(post.id, [
      { kind: 'web', ref: 'https://a', note: 'the model\'s wording, discarded' },
      { kind: 'web', ref: 'https://b', note: 'new' },
    ]);

    await postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: runId });

    const detail = await posts.detail(post.id);
    expect(detail.post.sources).toEqual([
      { kind: 'web', ref: 'https://a', note: 'kept' },
      { kind: 'web', ref: 'https://b', note: 'new' },
    ]);
    expect(detail.revisions[0]!.sources).toEqual(detail.post.sources);
    expect(detail.revisions[0]!.source).toBe(`run:${runId}`);
  });

  it('the same accept sent twice leaves the same list', async () => {
    const post = await seededPost();
    const runId = await seededRefineRun(post.id, [{ kind: 'web', ref: 'https://a', note: 'once' }]);

    await postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: runId });
    const first = (await posts.detail(post.id)).post.sources;
    await postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: runId });

    expect((await posts.detail(post.id)).post.sources).toEqual(first);
    expect(first).toEqual([{ kind: 'web', ref: 'https://a', note: 'once' }]);
  });

  it('a sourceRunId that does not exist, or belongs to another post, is a 404', async () => {
    const post = await seededPost();
    await expect(postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: 12345 }))
      .rejects.toThrow(NotFoundException);

    const other = await posts.create({ tier: 'T3' });
    const foreign = await seededRefineRun(other.id, []);
    await expect(postsCtrl.updateBody(post.id, { body: PROPOSED, sourceRunId: foreign }))
      .rejects.toThrow(NotFoundException);
    // the refused save left no revision behind
    expect((await posts.detail(post.id)).post.bodyLinkedin).toBe('The old body text here.');
  });

  it('rejects launches without a body and selections out of range', async () => {
    const bare = await posts.create({ tier: 'T2' });
    await expect(drafting.launchRefineSelection(bare.id, { selectionStart: 0, selectionEnd: 1, instruction: 'x' }))
      .rejects.toThrow(ConflictException);
    const post = await seededPost();
    await expect(drafting.launchRefineSelection(post.id, { selectionStart: 10, selectionEnd: 10, instruction: 'x' }))
      .rejects.toThrow(UnprocessableEntityException);
    await expect(drafting.launchRefineSelection(post.id, { selectionStart: 0, selectionEnd: 10_000, instruction: 'x' }))
      .rejects.toThrow(UnprocessableEntityException);
  });

  it('writes none of the legacy fence columns', async () => {
    const post = await seededPost();
    const launch = await drafting.launchRefineSelection(post.id, { selectionStart: 4, selectionEnd: 12, instruction: 'punchier' });
    await launch.finished;
    const run = await runsSvc.get(launch.runId);
    expect(run.research).toBe(false);
    expect(run.toolCalls).toBeNull();
    expect(run.stagedManifest).toBeNull();
    expect(run.stagedInputs).toBeNull();
    expect(run.stagedDir).toBeNull();
  });

  it('proposal read rejects a foreign or still-running run', async () => {
    const post = await seededPost();
    const other = await seededPost();
    const { runId } = await drafting.launchRefineSelection(other.id, { selectionStart: 0, selectionEnd: 3, instruction: 'x' });
    for (let i = 0; i < 50 && (await runsSvc.get(runId)).status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    await expect(drafting.getRefineSelectionProposal(post.id, runId)).rejects.toThrow(NotFoundException);
  });
});
