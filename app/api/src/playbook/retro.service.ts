import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { RetroOutputSchema, engagementRate, type DemoRow, type Demographics } from '@forge/shared';
import { DB, ForgeDb } from '../db/client';
import { playbookRules } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import { PostsService } from '../posts/posts.service';
import { RunRefused, RunnerService, extractJson } from '../runner/runner.service';
import { RunsService } from '../runs/runs.service';
import { SettingsService } from '../settings/settings.service';
import { PlaybookService } from './playbook.service';
import { assembleConstitution } from '../retrieval/constitution';
import { assembleRetroPrompt, type RetroPostInput } from './retro-prompt';

const POST_CAP = 12;

function demoLine(label: string, rows: DemoRow[] | undefined, take: number): string {
  if (!rows || rows.length === 0) return '';
  return `${label}: ${rows.slice(0, take).map((r) => `${r.value} ${r.percent}%`).join(', ')}`;
}

function summarizeDemographics(demographics: unknown): string {
  if (!demographics) return '(no demographics)';
  const d = demographics as Partial<Demographics>;
  return [demoLine('seniority', d.seniority, 4), demoLine('locations', d.locations, 5), demoLine('job titles', d.jobTitles, 3)]
    .filter(Boolean).join(' · ') || '(no demographics)';
}

@Injectable()
export class RetroService {
  private readonly log = new Logger(RetroService.name);

  constructor(
    @Inject(DB) private readonly db: ForgeDb,
    private readonly posts: PostsService,
    private readonly analytics: AnalyticsService,
    private readonly playbook: PlaybookService,
    private readonly runner: RunnerService,
    private readonly runs: RunsService,
    private readonly settings: SettingsService,
  ) {}

  private async lastRetroAt(): Promise<Date | null> {
    const retros = await this.runs.list({ kind: 'retro', limit: 50 });
    return retros.find((r) => r.status === 'succeeded')?.finishedAt ?? null;
  }

  async eligibility() {
    const [settings, lastRetroAt] = [await this.settings.get(), await this.lastRetroAt()];
    const measuredSince = await this.analytics.countMeasuredSince(lastRetroAt);
    return {
      measuredSince,
      threshold: settings.retroEveryMeasured,
      eligible: measuredSince >= settings.retroEveryMeasured,
      lastRetroAt,
    };
  }

  async launchRetro(): Promise<{ runId: number; finished: Promise<void> }> {
    const settings = await this.settings.get();
    const measured = await this.posts.list({ status: ['measured'] });
    const latest = await this.analytics.latestByPost();
    const withSnaps = measured
      .filter((p) => latest.has(p.id))
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    if (withSnaps.length === 0) throw new ConflictException('no measured posts with snapshots — nothing to retro');
    if (withSnaps.length > POST_CAP) {
      this.log.warn(`retro capped at ${POST_CAP} posts; dropping ${withSnaps.length - POST_CAP} older measured posts`);
    }

    const postInputs: RetroPostInput[] = [];
    for (const post of withSnaps.slice(0, POST_CAP)) {
      const snap = latest.get(post.id)!;
      const draftRun = await this.runs.latestForPost(post.id, 'draft');
      const at = draftRun?.startedAt ?? post.publishedAt ?? post.createdAt;
      const activeThen = await this.playbook.activeRulesAt(at);
      postInputs.push({
        postId: post.id,
        tier: post.tier,
        hook: post.hook,
        body: post.bodyLinkedin ?? '(no body recorded)',
        metrics: {
          impressions: snap.impressions,
          er: engagementRate(snap),
          reactions: snap.reactions,
          comments: snap.comments,
          shares: snap.shares,
          saves: snap.saves,
          followsGained: snap.followsGained,
        },
        demographicsSummary: summarizeDemographics(snap.demographics),
        activeRuleIds: activeThen.map((r) => r.id),
      });
    }

    const split = assembleRetroPrompt({
      // rules: [] on purpose. The retro's own block carries [#id ...] so proposals can target ids;
      // a second, id-less copy in the constitution would duplicate the list or lose the ids.
      constitution: assembleConstitution({ kind: 'retro', settings, rules: [] }),
      goal: settings.goalDoc || '(no goal document seeded yet)',
      rules: await this.playbook.activeRules(),
      posts: postInputs,
    });

    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((resolve) => { resolveRunId = resolve; });
    let refused: RunRefused | undefined;
    const finished = this.runner
      .execute({
        kind: 'retro', ...split, schema: RetroOutputSchema,
        tellFields: ['proposals[].rule', 'proposals[].rationale'], onStart: resolveRunId,
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`retro run crashed: ${String(err)}`);
      });
    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('retro failed before a run was created — see api logs');
    return { runId, finished };
  }

  async proposals(runId: number) {
    const run = await this.runs.get(runId);
    if (run.kind !== 'retro') throw new ConflictException(`run ${runId} is not a retro run`);
    if (run.status !== 'succeeded' || !run.parsedOk || !run.output) {
      throw new ConflictException(`retro run ${runId} has no valid proposals (status ${run.status})`);
    }
    const parsed = RetroOutputSchema.parse(extractJson(run.output));
    const withTargets = await Promise.all(parsed.proposals.map(async (p, index) => ({
      ...p,
      index,
      targetRule: p.target_rule_id == null
        ? null
        : await this.playbook.getRule(p.target_rule_id).catch(() => null),
    })));
    return { runId, proposals: withTargets };
  }

  async decide(runId: number, decisions: { index: number; approved: boolean }[]) {
    if (new Set(decisions.map((d) => d.index)).size !== decisions.length) {
      throw new BadRequestException('duplicate decision indices');
    }
    const { proposals } = await this.proposals(runId);
    const provenance = `retro:${runId}`;
    const existing = await this.db.select({ id: playbookRules.id }).from(playbookRules)
      .where(eq(playbookRules.provenance, provenance)).limit(1);
    if (existing.length > 0) throw new ConflictException(`retro ${runId} was already applied`);

    let applied = 0;
    let rejected = 0;
    await this.db.transaction(async (tx) => {
      for (const decision of decisions) {
        const p = proposals[decision.index];
        if (!p) throw new ConflictException(`no proposal at index ${decision.index}`);
        if (!decision.approved) { rejected += 1; continue; }
        if (p.action === 'add' || p.action === 'edit') {
          await tx.insert(playbookRules).values({
            category: p.category, rule: p.rule!, rationale: p.rationale, provenance,
          });
        }
        if (p.action === 'edit' || p.action === 'retire') {
          await tx.update(playbookRules)
            .set({ status: 'retired', retiredAt: new Date() })
            .where(eq(playbookRules.id, p.target_rule_id!));
        }
        applied += 1;
      }
    });
    return { applied, rejected };
  }
}
