import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { IdeaSource } from '@forge/shared';
import { useCreateIdea, useIdeas, usePatchIdea, usePromoteIdea, useTriageIdea } from '../api/hooks';
import type { IdeaDto, Tier } from '../api/client';
import { daysLeft } from '../lib/format';
import {
  Button, EmptyState, ErrorNote, Field, PageHeader, Panel, Pill, Spinner, TierBadge, inputCls,
} from '../ui/primitives';
import { Reveal, Skeleton, SkeletonLines, SkeletonList } from '../ui/skeleton';
import { LintedText } from '../ui/linted-text';
import { FailureStrip } from '../ui/failure-strip';

const SOURCES: IdeaSource[] = ['braindump', 'work', 'news', 'evergreen'];

function IdeaCard({ idea }: { idea: IdeaDto }) {
  const navigate = useNavigate();
  const triage = useTriageIdea();
  const patch = usePatchIdea();
  const promote = usePromoteIdea();
  const [tier, setTier] = useState<Tier>(idea.suggestedTier ?? 'T2');
  const expiry = idea.newsExpiry ? daysLeft(idea.newsExpiry) : null;
  const triageFailed = triage.data && !triage.data.ok ? triage.data : null;

  return (
    <div className="rounded-card border border-hairline bg-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] leading-relaxed text-ink">{idea.rawText}</p>
        {idea.suggestedTier && <TierBadge tier={idea.suggestedTier} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill>{idea.source}</Pill>
        <Pill className="bg-bone">{idea.status}</Pill>
        {expiry !== null && (
          <Pill className={expiry <= 3 ? 'border-salmon bg-paper text-salmon' : ''}>
            expires in {expiry}d
          </Pill>
        )}
      </div>
      {idea.notes && <p className="mt-2 text-[13px] lowercase text-soft"><LintedText text={idea.notes} /></p>}
      {triageFailed && (
        <div className="mt-2">
          {/* From the mutation's data, so it lasts until reload: runs carry no idea key to refetch by. */}
          <FailureStrip run={{
            id: triageFailed.runId, failureKind: triageFailed.failureKind, error: triageFailed.error,
            output: null, declined: triageFailed.declined ?? null,
          }} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="subtle" disabled={triage.isPending} onClick={() => triage.mutate(idea.id)}>
          {triage.isPending ? <Spinner /> : idea.status === 'triaged' ? 're-triage' : 'triage'}
        </Button>
        {/* No `lowercase` here: T1/T2/T3 are data codes, exempt from the lowercase rule (spec §5.3),
            and the `TierBadge` two rows up already renders them uppercase. */}
        <select className="rounded-full border border-hairline bg-bone px-3 py-1.5 text-[13px] text-soft"
          value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {(['T1', 'T2', 'T3'] as const).map((t) => <option key={t}>{t}</option>)}
        </select>
        <Button disabled={promote.isPending}
          onClick={() => promote.mutate({ id: idea.id, tier }, {
            onSuccess: ({ postId }) => navigate(`/posts/${postId}`),
          })}>
          promote
        </Button>
        <Button variant="subtle" disabled={patch.isPending}
          onClick={() => patch.mutate({ id: idea.id, status: 'discarded' })}>
          discard
        </Button>
      </div>
    </div>
  );
}

export default function Backlog() {
  const ideas = useIdeas('new,triaged');
  const create = useCreateIdea();
  const [rawText, setRawText] = useState('');
  const [source, setSource] = useState<IdeaSource>('braindump');

  return (
    <div className="max-w-[880px]">
      <PageHeader label="the backlog" sub="drop ideas fast; triage decides source, tier, and shelf life." />
      <Panel className="mb-6">
        <Field label="new idea">
          <textarea className={`${inputCls} min-h-20`} value={rawText} placeholder="what's on your mind…"
            onChange={(e) => setRawText(e.target.value)} />
        </Field>
        <div className="mt-3 flex items-center gap-2">
          <select className="rounded-full border border-hairline bg-bone px-3 py-1.5 text-[13px] lowercase text-soft"
            value={source} onChange={(e) => setSource(e.target.value as IdeaSource)}>
            {SOURCES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Button disabled={!rawText.trim() || create.isPending}
            onClick={() => create.mutate({ rawText: rawText.trim(), source }, { onSuccess: () => setRawText('') })}>
            add idea
          </Button>
        </div>
      </Panel>
      {ideas.isError && <ErrorNote label="backlog failed to load">{ideas.error.message}</ErrorNote>}
      {!ideas.isError && ideas.data?.length === 0 && (
        <EmptyState>backlog is empty — add the first idea above</EmptyState>
      )}
      <Reveal
        pending={ideas.isPending}
        skeleton={<SkeletonList probe="skeleton-backlog" gap="gap-3" row={<IdeaCardSkeleton />} />}
      >
        <div className="flex flex-col gap-3">
          {ideas.data?.map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
        </div>
      </Reveal>
    </div>
  );
}

/** Mirrors IdeaCard: two text lines, the tag row, the action row. */
function IdeaCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4">
      <SkeletonLines n={2} />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-16 rounded-pill" />)}
      </div>
      <div className="flex gap-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-8 w-20 rounded-pill" />)}
      </div>
    </div>
  );
}
