import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RuleCategory } from '@forge/shared';
import {
  useAddRule, useDecide, useProposals, useRetireRule, useRetroEligibility, useRules, useRunRetro, useRuns, useRunStream,
} from '../api/hooks';
import type { ProposalDto, RuleDto } from '../api/client';
import { fmtDateTime } from '../lib/format';
import { Button, Card, EmptyState, ErrorNote, Field, PageHeader, Panel, Pill, Spinner, WarnBanner, inputCls } from '../ui/primitives';
import { Reveal, Skeleton, SkeletonLines } from '../ui/skeleton';

const CATEGORIES: RuleCategory[] = ['voice', 'structure', 'visual', 'timing', 'cadence', 'platform'];

/** Renders ACTIVE rules only — `grouped` filters retired ones out before this ever sees them, which
 *  is what lets the retire button render unconditionally. Surfacing retired rules means restoring a
 *  recessed variant here as well as loosening that filter. */
/** Two category groups of three rule cards — the loaded shape, without promising a count. */
function RulesSkeleton() {
  return (
    <div data-probe="skeleton-playbook">
      {[0, 1].map((g) => (
        <div key={g} className="mb-6">
          <Skeleton className="mb-2 h-3 w-24" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 rounded-card border border-hairline bg-paper p-4">
                <div className="min-w-0 flex-1"><SkeletonLines n={2} /></div>
                <Skeleton className="h-6 w-14 shrink-0 rounded-pill" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Rule text carries no tell marks, deliberately. A style rule names what it bans by
 * construction, so marking it flags the example rather than a mistake: the rule reading
 * "Never use em dashes (...) in body text" has to contain one. Same exemption the persona and
 * the unslop doc already have. A retro proposal's own tells are still counted on its run,
 * through the retro run's tellFields.
 */
function RuleCard({ rule }: { rule: RuleDto }) {
  const retire = useRetireRule();
  return (
    <Card className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-ink">{rule.rule}</p>
        {rule.rationale && <p className="mt-1 text-[12px] lowercase text-soft">why: {rule.rationale}</p>}
      </div>
      <Pill className="bg-bone shrink-0">{rule.provenance}</Pill>
      <Button variant="subtle" disabled={retire.isPending} onClick={() => retire.mutate(rule.id)}>retire</Button>
    </Card>
  );
}

/**
 * `decision` is THREE-valued: undefined means kevin has not ruled on this proposal yet. Defaulting
 * it to `false` would paint reject solid on every untouched card — every proposal reading as
 * already-rejected — and "apply decisions" would then submit `approved: false` for all of them.
 * Undecided therefore renders BOTH buttons subtle (symmetric: neither is the standing answer) and
 * the apply button stays disabled until every card has been ruled on.
 */
function ProposalCard({ p, decision, onToggle }: { p: ProposalDto; decision: boolean | undefined; onToggle: (v: boolean) => void }) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <Pill className={p.action === 'retire' ? 'bg-bone' : 'bg-paper text-ink'}>{p.action}</Pill>
        <Pill>{p.category}</Pill>
        <div className="ml-auto flex gap-1">
          <Button variant={decision === true ? 'solid' : 'subtle'} onClick={() => onToggle(true)}>approve</Button>
          <Button variant={decision === false ? 'solid' : 'subtle'} onClick={() => onToggle(false)}>reject</Button>
        </div>
      </div>
      {p.targetRule && <p className="text-[13px] text-soft line-through">{p.targetRule.rule}</p>}
      {/* the proposed rule body is a recessed slab: in dark, bone and paper are a hair apart, so it
          needs the hairline to separate from the card it sits on (audit §4 check 2). */}
      {p.rule && <p className="mt-1 rounded-card border border-hairline bg-bone px-3 py-2 text-[14px] text-ink">{p.rule}</p>}
      <p className="mt-2 text-[12px] lowercase text-soft">why: {p.rationale}</p>
    </Card>
  );
}

export default function Playbook() {
  const qc = useQueryClient();
  const rules = useRules();
  const addRule = useAddRule();
  const eligibility = useRetroEligibility();
  const runRetro = useRunRetro();
  const retroRuns = useRuns('retro');
  const [liveRunId, setLiveRunId] = useState<number | null>(null);
  const [viewRunId, setViewRunId] = useState<number | null>(null);
  const stream = useRunStream(liveRunId);
  const proposals = useProposals(viewRunId);
  const decide = useDecide(viewRunId ?? 0);
  const [decisions, setDecisions] = useState<Record<number, boolean>>({});
  const [draft, setDraft] = useState({ category: 'voice' as RuleCategory, rule: '', rationale: '' });

  useEffect(() => {
    if (stream.done && liveRunId !== null) {
      void qc.invalidateQueries({ queryKey: ['runs'] });
      setViewRunId(liveRunId);
      setDecisions({});
      setLiveRunId(null);
    }
  }, [stream.done, liveRunId, qc]);

  const grouped = useMemo(() => {
    const active = (rules.data ?? []).filter((r) => r.status === 'active');
    return CATEGORIES.map((c) => [c, active.filter((r) => r.category === c)] as const).filter(([, rs]) => rs.length > 0);
  }, [rules.data]);

  const succeededRetros = (retroRuns.data ?? []).filter((r) => r.status === 'succeeded');

  const proposalList = proposals.data?.proposals ?? [];
  /** Applying is a batch verdict, so it stays shut until every proposal carries an explicit one. */
  const undecided = proposalList.filter((p) => decisions[p.index] === undefined).length;

  return (
    <div className="max-w-[880px]">
      <PageHeader label="the playbook" sub="every rule traceable to evidence; retros propose, kevin decides." />

      <Panel className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">retro</div>
          {/* One line, so a bare Skeleton rather than a Reveal — there is no region to fade. */}
          {eligibility.isPending && <Skeleton className="h-4 w-48" />}
          {eligibility.data && (
            <span className="text-[13px] lowercase text-soft">
              {eligibility.data.measuredSince} measured since last retro (threshold {eligibility.data.threshold})
              {eligibility.data.lastRetroAt && ` · last: ${fmtDateTime(eligibility.data.lastRetroAt)}`}
            </span>
          )}
          <Button className="ml-auto" disabled={runRetro.isPending || liveRunId !== null}
            onClick={() => runRetro.mutate(undefined, { onSuccess: (r) => setLiveRunId(r.runId) })}>
            run retro now
          </Button>
        </div>
        {/* Both of these render optional chrome (the "measured since" line, the past-retros strip),
            so a failed fetch would otherwise just make them vanish with no explanation. */}
        {eligibility.isError && (
          <div className="mb-2"><ErrorNote label="could not check retro eligibility">{eligibility.error.message}</ErrorNote></div>
        )}
        {retroRuns.isError && (
          <div className="mb-2"><ErrorNote label="past retros failed to load">{retroRuns.error.message}</ErrorNote></div>
        )}
        {eligibility.data?.eligible && <WarnBanner>retro is due — {eligibility.data.measuredSince} new measured posts</WarnBanner>}
        {liveRunId !== null && (
          <div data-surface="dark" className="mt-2 rounded-card bg-hero p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-ink">
              <Spinner /> retro running (run #{liveRunId})…
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
              {stream.lines.join('') || 'waiting for the engine…'}
            </pre>
          </div>
        )}
        {succeededRetros.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] lowercase text-soft">past retros:</span>
            {succeededRetros.map((r) => (
              <Button key={r.id} variant={viewRunId === r.id ? 'solid' : 'subtle'} onClick={() => { setViewRunId(r.id); setDecisions({}); }}>
                #{r.id}
              </Button>
            ))}
          </div>
        )}
        {proposals.isError && <div className="mt-2"><ErrorNote label="error">{(proposals.error as Error).message}</ErrorNote></div>}
        {proposals.data && (
          <div className="mt-4 flex flex-col gap-3">
            {proposalList.length === 0 && <EmptyState>this retro proposed no changes</EmptyState>}
            {proposalList.map((p) => (
              <ProposalCard key={p.index} p={p} decision={decisions[p.index]}
                onToggle={(v) => setDecisions((d) => ({ ...d, [p.index]: v }))} />
            ))}
            {proposalList.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={decide.isPending || undecided > 0}
                  onClick={() => decide.mutate(proposalList.map((p) => ({ index: p.index, approved: decisions[p.index] === true })))}>
                  apply decisions
                </Button>
                {undecided > 0 && <span className="text-[13px] lowercase text-soft">
                  {undecided} still undecided — approve or reject each one</span>}
                {decide.isSuccess && <span className="text-[13px] lowercase text-mint">
                  applied {decide.data.applied}, rejected {decide.data.rejected} ✓</span>}
                {decide.isError && <ErrorNote label="error">{(decide.error as Error).message}</ErrorNote>}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel className="mb-6">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">add a rule manually</div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {/* Matches the grammar of the text input it shares a row with — `inputCls` minus its
                `w-full`, since a competing width utility on the same element is a coin-flip on
                stylesheet order. Its own hover is what marks it interactive (audit §4 check 4). */}
            <select
              className="shrink-0 cursor-pointer rounded-card border border-hairline bg-paper px-3 py-2 text-[14px] lowercase text-ink transition-colors hover:border-ink"
              value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as RuleCategory })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className={`${inputCls} flex-1`} placeholder="the rule…" value={draft.rule}
              onChange={(e) => setDraft({ ...draft, rule: e.target.value })} />
          </div>
          <Field label="rationale (optional)">
            <input className={inputCls} value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} />
          </Field>
          <div>
            <Button disabled={!draft.rule.trim() || addRule.isPending}
              onClick={() => addRule.mutate(
                { category: draft.category, rule: draft.rule.trim(), rationale: draft.rationale || undefined },
                { onSuccess: () => setDraft({ category: 'voice', rule: '', rationale: '' }) },
              )}>
              add rule
            </Button>
          </div>
        </div>
      </Panel>

      {rules.isError && <ErrorNote label="the rules failed to load">{rules.error.message}</ErrorNote>}
      {/* `isError` guards the empty state too: `grouped` is [] on a failed fetch, so without this
          a dead api reads as the confident "no active rules yet" instead of a failure. */}
      {!rules.isPending && !rules.isError && grouped.length === 0 && (
        <EmptyState>no active rules yet — add one above, or run a retro to propose some.</EmptyState>
      )}
      {/* No outer `!isError` guard — see the note in PostAnalytics: a failed refetch must not
          take the already-loaded rules off screen. */}
      <Reveal pending={rules.isPending} skeleton={<RulesSkeleton />}>
        {grouped.map(([category, rs]) => (
          <div key={category} className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">{category} · {rs.length}</h2>
            <div className="flex flex-col gap-2">{rs.map((r) => <RuleCard key={r.id} rule={r} />)}</div>
          </div>
        ))}
      </Reveal>
    </div>
  );
}
