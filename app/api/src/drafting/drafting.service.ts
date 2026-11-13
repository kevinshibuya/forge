import {
  ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import {
  DraftOutputSchema, RefineSelectionOutputSchema, engagementRate,
  type PostTier, type RuleCategory,
} from '@forge/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { IdeasService } from '../ideas/ideas.service';
import { PlaybookService } from '../playbook/playbook.service';
import { PostsService, type PostRow } from '../posts/posts.service';
import { assembleConstitution } from '../retrieval/constitution';
import { assembleDraftPrompt, type ExemplarInput } from '../retrieval/prompt-assembly';
import { RetrievalService } from '../retrieval/retrieval.service';
import type { SplitPrompt } from '../engines/engine.interface';
import { RunRefused, RunnerService, extractJson } from '../runner/runner.service';
import { InputsService } from '../inputs/inputs.service';
import { RunsService } from '../runs/runs.service';
import { SettingsService } from '../settings/settings.service';

export interface DraftLaunch {
  runId: number;
  degraded: boolean;
  finished: Promise<void>;
}

export interface RefineSelectionInput {
  selectionStart: number;
  selectionEnd: number;
  instruction: string;
}

/** What one draft prompt is built from. */
interface PromptParts {
  settings: Awaited<ReturnType<SettingsService['get']>>;
  rules: { category: RuleCategory; rule: string }[];
  exemplars: ExemplarInput[];
  ideaText: string;
  tier: PostTier;
  refinement?: { currentBody: string; feedback: string };
  /** Retrieval was unavailable, so the prompt carries the constitution without exemplars. */
  degraded: boolean;
}

export const SELECTION_OPEN = '<<<SELECTED>>>';
export const SELECTION_CLOSE = '<<<END SELECTED>>>';

@Injectable()
export class DraftingService {
  private readonly log = new Logger(DraftingService.name);

  constructor(
    private readonly posts: PostsService,
    private readonly ideas: IdeasService,
    private readonly playbook: PlaybookService,
    private readonly analytics: AnalyticsService,
    private readonly retrieval: RetrievalService,
    private readonly runner: RunnerService,
    private readonly runs: RunsService,
    private readonly settings: SettingsService,
    private readonly inputs: InputsService,
  ) {}

  launchDraft(postId: number): Promise<DraftLaunch> {
    return this.launch(postId);
  }

  async launchRefine(postId: number, feedback: string): Promise<DraftLaunch> {
    const post = await this.posts.get(postId);
    if (!post.bodyLinkedin) throw new ConflictException('refine needs an existing draft body');
    return this.launch(postId, feedback);
  }

  /**
   * No launcher delivers an Input to the model any more: the staged fence is gone, and the inline
   * path arrives with slice 9 (ADR 0023). A draft that silently ignored what the operator attached
   * would be worse than none, so a Post with Inputs is refused before anything is written.
   */
  private async refuseInputs(postId: number): Promise<void> {
    const n = (await this.inputs.list(postId)).length;
    if (n > 0) {
      throw new ConflictException(`post ${postId} has ${n} inputs; a draft that reads inputs returns with slice 9 (input and research delivery)`);
    }
  }

  /**
   * Launch a selection-scoped refine. Deliberately does NOT go through `launch`: `beginDrafting`
   * would 409 outside queued|draft_ready and flip the post to `drafting`, but a selection refine
   * only PROPOSES — the post row (body, hashtags, status) must be byte-identical afterwards.
   */
  async launchRefineSelection(postId: number, input: RefineSelectionInput): Promise<{ runId: number; finished: Promise<void> }> {
    const post = await this.posts.get(postId); // 404 if missing
    const body = post.bodyLinkedin;
    if (!body) throw new ConflictException('refine-selection needs an existing draft body');
    if (post.status === 'measured') throw new ConflictException('post is measured; its body is final');
    await this.refuseInputs(postId);

    const { selectionStart: start, selectionEnd: end, instruction } = input;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length) {
      throw new UnprocessableEntityException(`selection ${start}..${end} is out of range for a ${body.length}-character body`);
    }

    // voice only: a selection refine rewrites a span, so structure, timing and platform rules do not apply.
    const [settings, activeRules] = await Promise.all([this.settings.get(), this.playbook.activeRules()]);
    const voiceRules = activeRules.filter((r) => r.category === 'voice');
    const split = buildRefineSelectionPrompt(
      assembleConstitution({
        kind: 'refine_selection',
        settings,
        rules: voiceRules.map((r) => ({ category: r.category, rule: r.rule })),
      }),
      body, start, end, instruction,
    );

    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((resolve) => { resolveRunId = resolve; });

    // A refusal (no registry row, engine not installed) answers as itself, not as a crash.
    let refused: RunRefused | undefined;
    // No finalize: the proposal is read back from the run row on demand, never applied here.
    const finished = this.runner
      .execute({
        kind: 'refine_selection', tier: post.tier, postId, ...split,
        schema: RefineSelectionOutputSchema,
        tellFields: ['body_linkedin', 'sources[].note'],
        onStart: resolveRunId,
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`refine-selection for post ${postId} crashed unexpectedly: ${String(err)}`);
      });

    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('refine-selection failed before a run was created, see api logs');
    return { runId, finished };
  }

  /** Read the proposed body of a finished selection-refine run. Never writes the post. */
  async getRefineSelectionProposal(postId: number, runId: number): Promise<{ proposedBody: string }> {
    const run = await this.runs.get(runId);
    if (run.postId !== postId || run.kind !== 'refine_selection') {
      throw new NotFoundException(`run ${runId} is not a refine-selection run for post ${postId}`);
    }
    if (run.status === 'running') throw new ConflictException(`run ${runId} is still running`);
    if (run.status !== 'succeeded') throw new ConflictException(`run ${runId} ${run.status} — no proposal to read`);
    try {
      return { proposedBody: RefineSelectionOutputSchema.parse(extractJson(run.output ?? '')).body_linkedin };
    } catch (err) {
      throw new ConflictException(`run ${runId} produced no readable proposal: ${String(err)}`);
    }
  }

  private async launch(postId: number, feedback?: string): Promise<DraftLaunch> {
    await this.refuseInputs(postId);
    const post = await this.posts.beginDrafting(postId); // 409 if not queued|draft_ready (incl. mid-draft)
    try {
      const parts = await this.gatherPromptParts(post, feedback);
      const degraded = parts.degraded;

      let resolveRunId!: (id: number) => void;
      const runIdReady = new Promise<number>((resolve) => { resolveRunId = resolve; });
      let refused: RunRefused | undefined;

      const finished = this.runner
        .execute({
          kind: 'draft', tier: post.tier, postId, schema: DraftOutputSchema,
          ...this.assemblePrompt(parts),
          tellFields: ['body_linkedin', 'hashtags[]', 'image_concept', 'sources[].note'],
          onStart: resolveRunId,
        })
        .then(async (res) => {
          if (res.ok) {
            // A draft that returned no `sources` key leaves the post's list alone; a returned
            // list replaces it, empty included. No list returned, nothing replaced.
            await this.posts.updateBody(postId, {
              body: res.data.body_linkedin,
              ...(res.data.sources !== undefined ? { sources: res.data.sources } : {}),
              source: `run:${res.runId}`,
            });
            await this.posts.patchMeta(postId, { hashtags: res.data.hashtags });
          }
          // failure: the run row carries failureKind/error/rawOutput — the UI's re-run surface
        })
        .catch((err: unknown) => {
          if (err instanceof RunRefused) { refused = err; return; }
          this.log.error(`draft for post ${postId} crashed unexpectedly: ${String(err)}`);
        })
        // returning the promise from onFinally delays `finished` settlement until
        // endDrafting lands — `await launch.finished` must observe the final status
        // (review finding: a `void` fire-and-forget here makes the tests race).
        .finally(async () => {
          await this.posts.endDrafting(postId).catch((err: unknown) =>
            this.log.error(`endDrafting(${postId}) failed: ${String(err)}`));
        });

      // never hang the 202 if execute dies before the run row exists
      const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
      if (runId === -1) throw refused ?? new ConflictException('draft failed before a run was created — see api logs');
      return { runId, degraded, finished };
    } catch (err) {
      // Guarded: an endDrafting that throws here would otherwise replace the real error.
      await this.posts.endDrafting(postId).catch((e: unknown) =>
        this.log.error(`endDrafting(${postId}) failed: ${String(e)}`));
      throw err;
    }
  }

  /** Everything the prompt needs that costs a query, gathered once. */
  private async gatherPromptParts(post: PostRow, feedback?: string): Promise<PromptParts> {
    const settings = await this.settings.get();
    const [idea] = await this.ideas.list({ promotedPostId: post.id });
    const ideaText = idea?.rawText ?? post.bodyLinkedin ?? post.hook;
    if (!ideaText) throw new ConflictException(`post ${post.id} has no source idea, body, or hook to draft from`);

    const rules = await this.playbook.activeRules();

    let exemplars: ExemplarInput[] = [];
    let degraded = false;
    try {
      const hits = await this.retrieval.similar(ideaText, {
        exclude: { sourceType: 'post', sourceId: post.id },
      });
      const latest = await this.analytics.latestByPost();
      exemplars = hits.map((h) => {
        if (h.sourceType !== 'post') return h;
        const snap = latest.get(h.sourceId);
        if (!snap) return h;
        return {
          ...h,
          performanceNote:
            `${snap.impressions} impressions, ${engagementRate(snap)}% ER, ` +
            `${snap.reactions} reactions, ${snap.comments} comments`,
        };
      });
    } catch (err) {
      degraded = true;
      this.log.warn(`retrieval unavailable — drafting constitution-only for post ${post.id}: ${String(err)}`);
    }

    return {
      settings,
      rules: rules.map((r) => ({ category: r.category, rule: r.rule })),
      exemplars,
      ideaText,
      tier: post.tier,
      refinement: feedback && post.bodyLinkedin
        ? { currentBody: post.bodyLinkedin, feedback }
        : undefined,
      degraded,
    };
  }

  private assemblePrompt(parts: PromptParts): SplitPrompt {
    return assembleDraftPrompt({
      constitution: assembleConstitution({
        kind: 'draft',
        settings: parts.settings,
        rules: parts.rules,
      }),
      exemplars: parts.exemplars,
      ideaText: parts.ideaText,
      tier: parts.tier,
      refinement: parts.refinement,
    });
  }
}

/**
 * Assemble the selection-refine prompt: the FULL current body with the selected span wrapped in
 * explicit markers (so the model can locate it unambiguously without index arithmetic), the
 * instruction, and the binding output contract. Markers and the full-body JSON contract are
 * load-bearing — the accept flow replaces the whole body with what comes back.
 */
export function buildRefineSelectionPrompt(constitution: string, body: string, start: number, end: number, instruction: string): SplitPrompt {
  const marked = body.slice(0, start) + SELECTION_OPEN + body.slice(start, end) + SELECTION_CLOSE + body.slice(end);
  return {
    system: [{ text: constitution, cache: true }],
    user: [
      'You are editing an existing LinkedIn post. Below is the FULL current body. Exactly one span is',
      `wrapped in ${SELECTION_OPEN} ... ${SELECTION_CLOSE} markers. Those markers are annotations, not`,
      'part of the text.',
      '',
      '--- CURRENT BODY ---',
      marked,
      '--- END CURRENT BODY ---',
      '',
      'INSTRUCTION FOR THE SELECTED SPAN:',
      instruction,
      '',
      'RULES:',
      '- Rewrite ONLY the selected span, following the instruction.',
      '- Leave the text outside the selection as it is; adapt it only where coherence requires, and then minimally.',
      '- Strip the markers from your answer.',
      '- Keep the author\'s voice, formatting, line breaks, and any hashtags exactly as they are.',
      '',
      'Return the FULL revised body as JSON, and nothing else:',
      '{"body_linkedin": "..."}',
    ].join('\n'),
  };
}
