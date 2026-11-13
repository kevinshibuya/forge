import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { BoardAudience, PostAnalyticsDto, PostMetricDto, PostRunDto } from '../api/client';
import { usePostAnalytics } from '../api/hooks';
import { fmtDateOnly, fmtDateTime, fmtNum, fmtUsd } from '../lib/format';
import { EmptyState, ErrorNote, TierBadge } from '../ui/primitives';
import { Reveal } from '../ui/skeleton';
import { PostDetailSkeleton } from '../ui/analytics/analytics-skeletons';
import { BarList, type BarListRow } from '../ui/analytics/bar-list';
import { MetricChart } from '../ui/analytics/metric-chart';

/**
 * Post detail on the board's grammar (spec §2): a stat strip over the capture series in one
 * paper panel, then the post's own demographics beside what it cost to make. Same hue rule as
 * the board — mint is what LinkedIn returned, salmon is what forge spent — and the two never
 * share a list.
 */

/* ---- stats --------------------------------------------------------------- */

type StatSpec = { metric: string; label: string; sign?: true; seconds?: true };

/** Always rendered: an absent one reads `—`, never 0 — "not exported" is not "zero". */
const CORE_STATS: StatSpec[] = [
  { metric: 'impressions', label: 'impressions' },
  { metric: 'members_reached', label: 'members reached' },
  { metric: 'reactions', label: 'reactions' },
  { metric: 'comments', label: 'comments' },
  { metric: 'reposts', label: 'reposts' },
  { metric: 'saves', label: 'saves' },
  { metric: 'profile_views', label: 'profile views' },
  { metric: 'follows_gained', label: 'followers gained', sign: true },
];

/** Only when present: a text post has no video metrics, and empty video cells are noise. */
const VIDEO_STATS: StatSpec[] = [
  { metric: 'video_views', label: 'video views' },
  { metric: 'video_watch_time_seconds', label: 'watch time', seconds: true },
  { metric: 'video_avg_watch_time_seconds', label: 'avg. watch time', seconds: true },
];

/** Watch time arrives as seconds; hours only appear once there are any. */
function fmtSeconds(total: number): string {
  const s = Math.round(total);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

function statValue(spec: StatSpec, metric: PostMetricDto | undefined): string {
  if (!metric) return '—';
  if (spec.seconds) return fmtSeconds(metric.value);
  return spec.sign ? `+${fmtNum(metric.value)}` : fmtNum(metric.value);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] lowercase text-soft">{label}</div>
      <div className="mt-2 text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

/* ---- panel shell --------------------------------------------------------- */

/**
 * The board's lower-band shell, kept local: a paper panel whose header is a tab group over one
 * list with its context parked at the right end. A one-tab group is a plain title in the same
 * grammar, exactly as the reference's single-label panels read.
 */
function ListPanel<T extends string>({ tabs, active, onTab, aside, probe, children }: {
  tabs: { key: T; label: string }[];
  active: T;
  onTab?: (key: T) => void;
  aside?: string;
  probe?: string;
  children: ReactNode;
}) {
  return (
    <section data-probe={probe} className="flex flex-col rounded-card border border-hairline bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-b border-hairline-soft px-5 pt-4">
        <div className="flex flex-wrap items-stretch gap-x-6">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                data-probe={probe ? `${probe}-tab-${t.key}` : undefined}
                aria-pressed={on}
                disabled={tabs.length === 1}
                onClick={() => onTab?.(t.key)}
                className={`-mb-px whitespace-nowrap border-b-2 pb-3 text-[12px] lowercase transition-colors ${
                  on ? 'border-ink text-ink' : 'border-transparent text-soft hover:border-hairline-soft'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {aside && <span className="pb-3 text-[11px] lowercase text-soft">{aside}</span>}
      </div>
      <div className="flex-1 px-5 pb-5 pt-4">{children}</div>
    </section>
  );
}

/* ---- page ---------------------------------------------------------------- */

export default function PostAnalytics() {
  const postId = Number(useParams().postId);
  const detail = usePostAnalytics(postId);

  return (
    <div className="max-w-[1180px]">
      {detail.isError && (
        <ErrorNote label="this post's analytics failed to load">{(detail.error as Error).message}</ErrorNote>
      )}
      {/* No outer `!isError` guard: react-query keeps `data` through a FAILED REFETCH, and
          hiding the region there would throw away content the reader already had. The ErrorNote
          above satisfies ADR 0013's ordering, and `pending` is false in the error state, so the
          skeleton cannot leak through on a first-load failure. */}
      <Reveal pending={detail.isPending} skeleton={<PostDetailSkeleton />}>
        {detail.data && <Detail data={detail.data} />}
      </Reveal>
    </div>
  );
}

function Detail({ data }: { data: PostAnalyticsDto }) {
  const { post, latest, series, audience, runs } = data;
  const byMetric = new Map(latest.map((m) => [m.metric, m]));
  const nothing = latest.length === 0 && series.length === 0 && audience === null && runs.items.length === 0;
  // Every lifetime metric of one capture carries that capture's day, so the newest is the strip's.
  const asOf = latest.reduce<string | null>((held, m) => (held === null || m.asOf > held ? m.asOf : held), null);

  const stats = [...CORE_STATS, ...VIDEO_STATS.filter((s) => byMetric.has(s.metric))];
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <>
      <header className="border-b border-hairline pb-6">
        <h1 className="text-[clamp(1.6rem,3vw,2.4rem)] font-bold lowercase leading-[1.05] tracking-[-0.033em] text-ink">
          {post.title}
        </h1>
        {/* No `lowercase` on this row: the copy is already written lowercase and the tier pill is
            a data code (spec §5.3) — a blanket class here would print it as `t1`. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-soft">
          <span>{post.publishedAt ? fmtDateTime(post.publishedAt) : 'not published yet'}</span>
          <TierBadge tier={post.tier} />
          <Link to={`/posts/${post.id}`} className="text-ink transition-colors hover:text-soft">workspace ↗</Link>
          {post.linkedinUrl && (
            <a
              href={post.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink transition-colors hover:text-soft"
            >
              linkedin ↗
            </a>
          )}
          <Link to="/analytics" className="ml-auto transition-colors hover:text-ink">← the numbers</Link>
        </div>
      </header>

      {nothing
        ? (
          <div className="mt-8" data-probe="post-detail-empty">
            <EmptyState>nothing measured yet — import this post's export on the analytics page</EmptyState>
          </div>
        )
        : (
          <div className="mt-8 space-y-5">
            <section className="rounded-card border border-hairline bg-paper">
              <div
                data-probe="post-stats"
                className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5 px-6 py-5"
              >
                <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
                  {stats.map((s) => (
                    <Stat key={s.metric} label={s.label} value={statValue(s, byMetric.get(s.metric))} />
                  ))}
                </div>
                <span className="ml-auto pt-1 text-[11px] lowercase text-soft">
                  {asOf ? `lifetime, as of ${fmtDateOnly(asOf)}` : 'no capture yet'}
                </span>
              </div>

              {series.length >= 2 && first && last && (
                <div data-probe="post-series" className="border-t border-hairline-soft px-6 pb-6 pt-5">
                  <div className="mb-1 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">
                    impressions over captures
                  </div>
                  {/* Capture days sit weeks apart and the counter kept climbing between them, so
                      the line connects them — the daily-gap rule is about missing days, not these. */}
                  <MetricChart
                    points={series.map((p) => ({ date: p.asOf, value: p.impressions }))}
                    start={first.asOf}
                    end={last.asOf}
                    connectAll
                  />
                </div>
              )}
              {series.length === 1 && (
                <div className="border-t border-hairline-soft px-6 py-4 text-[12px] lowercase text-soft">
                  one capture so far — no trend to draw yet
                </div>
              )}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <AudiencePanel audience={audience} />
              <CostPanel runs={runs} />
            </div>
          </div>
        )}
    </>
  );
}

/* ---- demographics -------------------------------------------------------- */

/** Dimension keys are wire values; the tab reads them as words without touching the data. */
const dimensionLabel = (d: string) => d.replace(/_/g, ' ');

/** Values arrive with the unit they were stored with — a percent stays a percent, never re-derived. */
const segmentValue = (value: number, unit: string) => (unit === 'percent' ? `${value}%` : fmtNum(value));

function AudiencePanel({ audience }: { audience: BoardAudience | null }) {
  const dimensions = audience?.dimensions ?? [];
  const [dim, setDim] = useState<string>('');
  const active = dimensions.find((d) => d.dimension === dim) ?? dimensions[0];

  if (!active || !audience) {
    return (
      <ListPanel tabs={[{ key: 'audience', label: 'who saw it' }]} active="audience" probe="post-audience">
        <EmptyState>no demographics for this post — its export carried none</EmptyState>
      </ListPanel>
    );
  }

  return (
    <ListPanel
      tabs={dimensions.map((d) => ({ key: d.dimension, label: dimensionLabel(d.dimension) }))}
      active={active.dimension}
      onTab={setDim}
      aside={`as of ${fmtDateOnly(audience.asOf)}`}
      probe="post-audience"
    >
      <BarList
        hue="mint"
        rowProbe="post-audience-row"
        columns={{ label: 'segment', value: 'share' }}
        rows={active.segments.map((s) => ({
          id: `${active.dimension}:${s.segment}`,
          label: s.segment,
          labelText: s.segment,
          value: segmentValue(s.value, s.unit),
          fill: s.value,
        }))}
      />
    </ListPanel>
  );
}

/* ---- production cost ----------------------------------------------------- */

/** Spend is the one thing salmon owns on both this page and the board. */
function CostPanel({ runs }: { runs: PostAnalyticsDto['runs'] }) {
  const rows: BarListRow[] = runs.items.map((r) => ({
    id: String(r.runId),
    label: <RunLabel run={r} />,
    labelText: `${r.kind} · ${r.model}`,
    value: r.costUsd === null ? '—' : fmtUsd(r.costUsd),
    fill: r.costUsd ?? 0,
  }));

  return (
    <ListPanel
      tabs={[{ key: 'cost', label: 'what it cost to make' }]}
      active="cost"
      aside={runs.total === null ? 'nothing priceable' : `est. total ${fmtUsd(runs.total)}`}
      probe="post-cost"
    >
      {rows.length === 0
        ? <EmptyState>no runs recorded for this post</EmptyState>
        : (
          <>
            <BarList rows={rows} hue="salmon" rowProbe="post-cost-row" columns={{ label: 'run', value: 'est. cost' }} />
            <p className="mt-3 text-right text-[11px] lowercase text-soft">
              priced from the model registry at call time; on the cli backend this is what the same call costs on the api
            </p>
          </>
        )}
    </ListPanel>
  );
}

/** kind is words; engine and model are data codes, printed as stored (spec §5.3). */
function RunLabel({ run }: { run: PostRunDto }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 lowercase">{run.kind.replace(/_/g, ' ')}</span>
      <span className="min-w-0 truncate text-[11px] text-soft">{run.engine} · {run.model}</span>
    </span>
  );
}
