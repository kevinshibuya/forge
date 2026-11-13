import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { BoardAudience, BoardDto, BoardPostRow, BoardRange, BoardSpend } from '../api/client';
import { useBoard, useImportXlsx, type ImportResultDto } from '../api/hooks';
import { fmtDateOnly, fmtNum, fmtUsd } from '../lib/format';
import { EmptyState, ErrorNote, Spinner } from '../ui/primitives';
import { Reveal } from '../ui/skeleton';
import { BoardSkeleton } from '../ui/analytics/analytics-skeletons';
import { AttachPicker } from '../ui/analytics/attach-picker';
import { BarList, type BarListRow } from '../ui/analytics/bar-list';
import { MetricChart } from '../ui/analytics/metric-chart';

/** What the import wrote, in the page's voice. Four shapes: already in, linked, account-wide, unlinked. */
function importMessage(r: ImportResultDto): string {
  if (r.alreadyImported) return 'that file was already imported — nothing new to read';
  const facts = r.factCounts.profile + r.factCounts.lifetime + r.factCounts.window + r.factCounts.audience;
  const notes = r.warnings.join(' · ');
  if (r.kind === 'aggregate') {
    const head = `imported ${facts} facts covering the account window`;
    return notes ? `${head} — ${notes}` : head;
  }
  if (r.linkedPostId === null) {
    return `imported ${facts} facts, but not attached to any post — ${notes || 'no app post matches this export url'}`;
  }
  const head = `imported ${facts} facts and attached them to post #${r.linkedPostId}`;
  return notes ? `${head} — ${notes}` : head;
}

/** Compact labels: four pills don't fit Overview's "last 28 days" wording (recorded adaptation). */
const RANGES: { key: BoardRange; label: string }[] = [
  { key: '7', label: '7d' },
  { key: '28', label: '28d' },
  { key: '90', label: '90d' },
  { key: 'all', label: 'all time' },
];

/**
 * Only daily-grain metrics get a time series (spec decision 4) — engagement rate and the
 * follower total are context stats beside the tabs, never tabs themselves.
 */
const METRICS = [
  { key: 'impressions', label: 'impressions' },
  { key: 'engagements', label: 'engagements' },
  { key: 'followersNew', label: 'new followers' },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

export default function Analytics() {
  const [range, setRange] = useState<BoardRange>('28');
  const [metric, setMetric] = useState<MetricKey>('impressions');
  const [notice, setNotice] = useState<string | null>(null);
  const board = useBoard(range);
  const importXlsx = useImportXlsx();

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input before the async work: re-picking the SAME file must fire `change` again.
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    importXlsx.mutate(file, { onSuccess: (r) => setNotice(importMessage(r)) });
  };

  return (
    <div className="max-w-[1180px]">
      {/* Bench PageHeader grammar, inlined so the range/import cluster can share the headline row. */}
      <header className="border-b border-hairline pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <h1 className="text-[clamp(2rem,4vw,3.2rem)] font-bold lowercase leading-[0.95] tracking-[-0.033em] text-ink">
            the numbers
          </h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                data-probe={`range-${r.key}`}
                aria-pressed={r.key === range}
                onClick={() => setRange(r.key)}
                className={`rounded-pill border px-3.5 py-1.5 text-[12px] lowercase transition-colors ${
                  r.key === range ? 'border-ink bg-ink text-bone' : 'border-hairline text-soft hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
            <label
              data-probe="import-pill"
              className={`ml-1 inline-flex items-center gap-2 rounded-pill border border-hairline px-3.5 py-1.5 text-[12px] lowercase text-ink transition-colors ${
                importXlsx.isPending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-paper'
              }`}
            >
              {importXlsx.isPending ? <Spinner /> : <span aria-hidden="true">↑</span>}
              {importXlsx.isPending ? 'importing' : 'import export'}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                disabled={importXlsx.isPending}
                onChange={onPick}
              />
            </label>
          </div>
        </div>
      </header>

      {notice && <p className="mt-4 text-[13px] leading-relaxed lowercase text-soft">{notice}</p>}
      {importXlsx.isError && (
        <div className="mt-4"><ErrorNote label="import failed">{(importXlsx.error as Error).message}</ErrorNote></div>
      )}

      <div className="mt-8">
        {board.isError
          ? <ErrorNote label="the board failed to load">{(board.error as Error).message}</ErrorNote>
          : (
            // `space-y-5` moves from the inner div onto Reveal, so the skeleton's three bands and
            // the real three bands are spaced by the same rule.
            <Reveal pending={board.isPending} skeleton={<BoardSkeleton />} className="space-y-5">
              {board.data && (
                <>
                  <Band1 data={board.data} metric={metric} onMetric={setMetric} />
                  <Band2 posts={board.data.posts} audience={board.data.audience} />
                  <Band3 spend={board.data.spend} />
                </>
              )}
            </Reveal>
          )}
      </div>
    </div>
  );
}

/* ---- band 1 — performance ------------------------------------------------ */

/**
 * Plausible's spine: ONE paper panel carrying the KPI strip and the single time series, the
 * strip divided from the chart by a hairline. The graft is the strip-as-tabs (clicking a stat
 * swaps the series); the Bench adaptation is the selection mark — ink text over a 2px ink
 * underline rather than Plausible's tinted cell.
 */
function Band1({
  data, metric, onMetric,
}: {
  data: BoardDto;
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
}) {
  const { totals, followersTotal, series } = data;
  const hasData = series.length > 0;

  // Window-derived figures go to `—` when the window carried no rows: a zero there would read
  // as a measured zero (Overview's rule). The follower snapshot is sourced independently and
  // stays real either way.
  const tabValue = (key: MetricKey) => {
    if (!hasData) return '—';
    return key === 'followersNew' ? `+${fmtNum(totals.followersNew)}` : fmtNum(totals[key]);
  };
  const er = totals.impressions > 0
    ? `${((totals.engagements / totals.impressions) * 100).toFixed(1)}%`
    : '—';

  const points = series.map((p) => ({ date: p.date, value: p[metric] }));

  return (
    <section className="rounded-card border border-hairline bg-paper">
      <div className="flex flex-wrap items-stretch justify-between gap-x-10 gap-y-6 border-b border-hairline-soft px-6 pt-5">
        <div className="flex items-stretch gap-8">
          {METRICS.map((m) => {
            const active = m.key === metric;
            return (
              <button
                key={m.key}
                type="button"
                data-probe={`kpi-tab-${m.key}`}
                aria-pressed={active}
                onClick={() => onMetric(m.key)}
                className={`-mb-px flex flex-col border-b-2 pb-5 text-left transition-colors ${
                  active ? 'border-ink' : 'border-transparent hover:border-hairline-soft'
                }`}
              >
                <span className={`text-[12px] lowercase ${active ? 'text-ink' : 'text-soft'}`}>{m.label}</span>
                <span
                  className={`mt-2.5 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums ${
                    active ? 'text-ink' : 'text-soft'
                  }`}
                >
                  {tabValue(m.key)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-10 pb-5">
          <ContextStat label="engagement rate" value={er} />
          <ContextStat
            label="followers total"
            value={followersTotal ? fmtNum(followersTotal.value) : '—'}
            sub={followersTotal ? `as of ${fmtDateOnly(followersTotal.asOf)}` : 'no snapshot yet'}
          />
        </div>
      </div>

      <div className="px-6 pb-6 pt-5">
        {hasData
          ? (
            // The wrapper carries the probe attributes: `MetricChart`'s interface is fixed at
            // (points, start, end) so the active metric is named here, where it is known.
            <div data-probe="metric-chart" data-metric={metric}>
              <MetricChart points={points} start={data.start} end={data.end} />
            </div>
          )
          : (
            <div data-probe="band1-empty">
              <EmptyState>no analytics in this window — import an export</EmptyState>
            </div>
          )}
      </div>
    </section>
  );
}

/** A stat that is NOT a tab: no underline, no hover, right-aligned against the strip's end. */
function ContextStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-right">
      <div className="text-[12px] lowercase text-soft">{label}</div>
      <div className="mt-2.5 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {value}
      </div>
      {sub && <div className="mt-2 text-[11px] lowercase text-soft">{sub}</div>}
    </div>
  );
}

/* ---- panel shell --------------------------------------------------------- */

/**
 * Plausible's lower band: a paper panel whose header is a tab group over one list, with any
 * context (`as of …`) parked at the header's right end. Same selection mark as band 1's KPI
 * strip — ink text over a 2px ink underline — so the page has one tab grammar, not two.
 */
function ListPanel<T extends string>({ tabs, active, onTab, aside, probe, children }: {
  tabs: { key: T; label: string }[];
  active: T;
  onTab: (key: T) => void;
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
                onClick={() => onTab(t.key)}
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

/* ---- band 2 — posts & audience ------------------------------------------ */

function Band2({ posts, audience }: { posts: BoardPostRow[]; audience: BoardAudience | null }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[55fr_45fr]">
      <PostsPanel posts={posts} />
      <AudiencePanel audience={audience} />
    </div>
  );
}

const POST_TABS = [
  { key: 'top', label: 'top posts' },
  { key: 'recent', label: 'recent' },
] as const;
type PostTab = (typeof POST_TABS)[number]['key'];

/** An unattached import has no words of its own — show the urn, which is a data code (§5.3). */
const urnLabel = (urn: string) => `urn:…${urn.slice(-8)}`;

function PostsPanel({ posts }: { posts: BoardPostRow[] }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PostTab>('top');
  const [attaching, setAttaching] = useState<string | null>(null);

  // The server already ordered by best-known impressions across grains, so `top` is its order
  // verbatim; only `recent` re-sorts, by published day with the undated rows last.
  const rows = useMemo(() => {
    if (tab === 'top') return posts;
    return [...posts].sort((a, b) => {
      if (a.publishedAt === b.publishedAt) return 0;
      if (a.publishedAt === null) return 1;
      if (b.publishedAt === null) return -1;
      return a.publishedAt < b.publishedAt ? 1 : -1;
    });
  }, [posts, tab]);

  const linkedPostIds = useMemo(
    () => new Set(posts.flatMap((p) => (p.postId === null ? [] : [p.postId]))),
    [posts],
  );

  const barRows: BarListRow[] = rows.map((p) => {
    const label = p.title ?? urnLabel(p.postUrn);
    return {
      id: p.postUrn,
      label,
      labelText: label,
      value: fmtNum(p.impressions),
      fill: p.impressions,
      // A window-grain row is the max of a windowed sheet, not a lifetime count — derived stats
      // would be reading across grains, so they stay `—` and the value carries its provenance.
      tag: p.grain === 'window' ? 'window' : undefined,
      extras: [
        p.er === null ? '—' : `${p.er.toFixed(1)}%`,
        p.followsGained === null ? '—' : `+${fmtNum(p.followsGained)}`,
      ],
      onSelect: p.postId === null ? undefined : () => navigate(`/analytics/${p.postId}`),
      trailing: p.postId !== null ? undefined : (
        <>
          <button
            type="button"
            data-probe="attach-pill"
            onClick={() => setAttaching(p.postUrn)}
            className="rounded-pill border border-hairline px-2.5 py-0.5 text-[11px] lowercase text-soft transition-colors hover:text-ink"
          >
            attach
          </button>
          {attaching === p.postUrn && (
            <AttachPicker postUrn={p.postUrn} linkedPostIds={linkedPostIds} onClose={() => setAttaching(null)} />
          )}
        </>
      ),
    };
  });

  return (
    // `aside`, not the empty state, carries the scope: this panel is deliberately RANGE-INDEPENDENT
    // (best known measurement per post), so at 7d band 1 can be empty while this lists everything.
    // Claiming "in this window" here would describe a window the data does not have.
    <ListPanel tabs={[...POST_TABS]} active={tab} onTab={setTab} aside="best known, all time" probe="posts-panel">
      {barRows.length === 0
        ? <div data-probe="posts-empty"><EmptyState>no measured posts yet — import an export</EmptyState></div>
        : (
          <BarList
            rows={barRows}
            hue="mint"
            rowProbe="post-row"
            columns={{ label: 'post', value: 'impressions', extras: ['er', '+followers'] }}
          />
        )}
    </ListPanel>
  );
}

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
      <section data-probe="audience-panel" className="rounded-card border border-hairline bg-paper p-5">
        <div className="mb-4 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">audience</div>
        <EmptyState>no audience snapshot yet — import an account export</EmptyState>
      </section>
    );
  }

  return (
    <ListPanel
      tabs={dimensions.map((d) => ({ key: d.dimension, label: dimensionLabel(d.dimension) }))}
      active={active.dimension}
      onTab={setDim}
      aside={`as of ${fmtDateOnly(audience.asOf)}`}
      probe="audience-panel"
    >
      <BarList
        hue="mint"
        rowProbe="audience-row"
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

/* ---- band 3 — spend ------------------------------------------------------ */

const COL_HEAD = 'mb-3 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft';

/**
 * Spend is the one band about money, so it is the one band salmon owns. The right column reads
 * the OTHER direction — what LinkedIn returned on that money — so it keeps mint. The two never
 * share a list: each column carries exactly one hue, which is what makes the fills mean
 * anything at a glance.
 */
function Band3({ spend }: { spend: BoardSpend }) {
  const byKind: BarListRow[] = spend.byKind.map((k) => ({
    id: k.kind,
    label: k.kind.replace(/_/g, ' '),
    labelText: k.kind,
    value: fmtUsd(k.total),
    fill: k.total,
  }));

  const byPost: BarListRow[] = spend.byPost.map((p) => ({
    id: String(p.postId),
    label: (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate">{p.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-soft">{fmtUsd(p.cost)}</span>
      </span>
    ),
    labelText: p.title,
    value: fmtNum(p.impressions),
    // Scaled by impressions per dollar, not by impressions: the column asks what the money
    // bought, so the cheapest reach has to be the longest bar.
    fill: p.cost > 0 ? p.impressions / p.cost : 0,
  }));

  return (
    <section data-probe="spend-band" className="rounded-card border border-hairline bg-paper">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-hairline-soft px-5 py-5">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <SpendStat label="est. spend" value={fmtUsd(spend.total)} />
          <SpendStat label="runs" value={fmtNum(spend.runs)} />
          <SpendStat
            label="est. cost per published post"
            value={spend.perPublishedPost === null ? '—' : fmtUsd(spend.perPublishedPost)}
          />
        </div>
        <p className="ml-auto text-right text-[11px] lowercase text-soft">
          priced from the model registry at call time; on the cli backend this is what the same call costs on the api
        </p>
      </div>

      <div className="px-5 py-5">
        {spend.runs === 0
          ? <div data-probe="spend-empty"><EmptyState>no runs in this window</EmptyState></div>
          : (
            <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
              <div>
                <div className={COL_HEAD}>spend by run kind</div>
                <BarList rows={byKind} hue="salmon" rowProbe="spend-kind-row" columns={{ label: 'kind', value: 'est. cost' }} />
              </div>
              <div className="lg:border-l lg:border-hairline-soft lg:pl-8">
                <div className={COL_HEAD}>cost vs return</div>
                {byPost.length === 0
                  ? <EmptyState>no post yet carries both a cost and a measured reach</EmptyState>
                  : <BarList rows={byPost} hue="mint" rowProbe="spend-post-row" columns={{ label: 'post · est. cost', value: 'impressions' }} />}
              </div>
            </div>
          )}
      </div>
    </section>
  );
}

function SpendStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] lowercase text-soft">{label}</div>
      <div className="mt-2 text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{value}</div>
    </div>
  );
}
