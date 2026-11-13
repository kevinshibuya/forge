import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { RunKindSchema } from '@forge/shared';
import { useRunDetail, useRuns } from '../api/hooks';
import { durationS, fmtDateTime } from '../lib/format';
import { RUN_DOT } from '../lib/run-status';
import { RunDetail } from '../ui/run-detail';
import { EmptyState, ErrorNote, PageHeader, Pill } from '../ui/primitives';
import { Reveal, Skeleton, SkeletonLines, SkeletonList } from '../ui/skeleton';

/** Derived from the shared enum, so the filter can never drift from the kinds the api accepts. */
const KINDS = ['all', ...RunKindSchema.options] as const;

function RunExpansion({ id }: { id: number }) {
  const run = useRunDetail(id);
  return (
    <div className="border-t border-hairline bg-bone px-4 py-3">
      {run.isError
        ? <ErrorNote label={`could not load run #${id}`}>{run.error.message}</ErrorNote>
        : (
          <Reveal
            pending={run.isPending}
            skeleton={<div data-probe="skeleton-run-detail"><SkeletonLines n={4} /></div>}
          >
            {run.data && <RunDetail run={run.data} />}
          </Reveal>
        )}
    </div>
  );
}

export default function RunsLog() {
  // `?run=<id>` (the failure card's "open run") lands with that row expanded and the kind filter
  // at `all`, so the row is in the list whatever kind it is. `useRuns` caps at 50 rows, so a very
  // old run will not be in the list to expand; acceptable, the log is still open.
  const [params] = useSearchParams();
  const requested = Number(params.get('run'));
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [open, setOpen] = useState<number | null>(Number.isInteger(requested) && requested > 0 ? requested : null);
  const runs = useRuns(kind === 'all' ? undefined : kind);

  return (
    <div className="max-w-[980px]">
      <PageHeader label="the runs" sub="every engine execution, prompt to output." />
      <div className="mb-4 flex flex-wrap gap-2 rounded-card border border-hairline bg-paper p-2">
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`rounded-full border px-3.5 py-1 text-[11px] font-medium lowercase transition-colors ${
              kind === k ? 'border-ink bg-ink text-bone' : 'border-hairline bg-bone text-soft hover:bg-paper'}`}>
            {k.replace('_', ' ')}
          </button>
        ))}
      </div>
      {runs.isError && <ErrorNote label="the runs failed to load">{runs.error.message}</ErrorNote>}
      {!runs.isError && runs.data?.length === 0 && (
        <EmptyState>
          {kind === 'all'
            ? 'no runs yet — drafting or generating from a post logs the first one here'
            : `no ${kind.replace('_', ' ')} runs yet — pick another kind above`}
        </EmptyState>
      )}
      <Reveal
        pending={runs.isPending}
        skeleton={<SkeletonList probe="skeleton-runs" row={<RunRowSkeleton />} />}
      >
      <div className="flex flex-col gap-2">
        {runs.data?.map((r) => (
          <div key={r.id} className="overflow-hidden rounded-card border border-hairline bg-paper">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bone"
              onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="text-[11px] tabular-nums text-soft">#{r.id}</span>
              <Pill>{r.kind.replace('_', ' ')}</Pill>
              <span className="text-[12px] lowercase text-soft">{r.model}</span>
              <span className="ml-auto flex items-center gap-1.5 text-[12px] lowercase text-soft">
                <span className={`size-1.5 rounded-full ${RUN_DOT[r.status] ?? 'bg-soft'}`} />
                {r.status}{r.failureKind && ` · ${r.failureKind}`}
              </span>
              <span className="text-[12px] tabular-nums text-soft">{durationS(r.startedAt, r.finishedAt)}</span>
              <span className="text-[12px] tabular-nums text-soft">{fmtDateTime(r.startedAt)}</span>
            </button>
            {open === r.id && <RunExpansion id={r.id} />}
          </div>
        ))}
      </div>
      </Reveal>
    </div>
  );
}

/** Mirrors the collapsed run row: id, kind pill, model, status, duration, timestamp. */
function RunRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-hairline bg-paper px-4 py-3">
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-6 w-16 rounded-pill" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="ml-auto h-4 w-14" />
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}
