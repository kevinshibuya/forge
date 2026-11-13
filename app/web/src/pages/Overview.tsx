import { useCallback, useState, type Ref } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import type { PostStatus } from '@forge/shared';
import type { OverviewDto, OverviewWindow, PendingActionDto, UpcomingItemDto } from '../api/client';
import { useDashboard, useOverviewAnalytics } from '../api/hooks';
import { fmtDateOnly, fmtNum } from '../lib/format';
import { useLoadIn } from '../lib/motion-tokens';
import { EmptyState, ErrorNote } from '../ui/primitives';
import { Reveal } from '../ui/skeleton';
import { HeroSkeleton, LowerBandSkeleton } from '../ui/overview/overview-skeletons';
import { DivergingBars } from '../ui/overview/diverging-bars';
import {
  EngagementsGlyph, FollowersTotalGlyph, HeroStatCard, ImpressionsGlyph, NewFollowersGlyph,
} from '../ui/overview/hero-stat-card';
import { TickMeter, type TickStage } from '../ui/overview/tick-meter';
import { WeekdayBars } from '../ui/overview/weekday-bars';

const WINDOWS: OverviewWindow[] = [7, 28, 90];

/** Pipeline order — the payload's own order is first-seen (posts.list is newest-first). */
const STATUS_ORDER: PostStatus[] = ['queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured'];

/** The four stages the meter can show; the other two never reach an `upcoming` row. */
const TICK_STAGES: readonly PostStatus[] = ['queued', 'drafting', 'draft_ready', 'approved'];
const tickStageOf = (status: PostStatus): TickStage | null =>
  (TICK_STAGES.includes(status) ? (status as TickStage) : null);

/** One decimal, or an em dash when the division was not defined. */
const fixed1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const range = (w: { start: string; end: string }) => {
  const sameYear = w.start.slice(0, 4) === w.end.slice(0, 4);
  return sameYear
    ? `${fmtDateOnly(w.start)} – ${fmtDateOnly(w.end)}`
    : `${fmtDateOnly(w.start)} ${w.start.slice(0, 4)} – ${fmtDateOnly(w.end)} ${w.end.slice(0, 4)}`;
};

export default function Overview() {
  const [activeWindow, setActiveWindow] = useState<OverviewWindow>(28);
  const [pendingOpen, setPendingOpen] = useState(false);
  const overview = useOverviewAnalytics(activeWindow);
  const dashboard = useDashboard();

  /**
   * The pending list opens below the fold of the lower band, so opening it can leave the reader
   * looking at nothing new. A callback ref fires exactly when the list MOUNTS — i.e. only on
   * open; on close React calls it with `null` and we do nothing, which is the whole "no motion
   * on close" rule. `block: 'nearest'` scrolls the minimum needed, so an already-visible list
   * stays put rather than being yanked to the top.
   */
  const revealPending = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <HeroBand
        activeWindow={activeWindow}
        onWindowChange={setActiveWindow}
        data={overview.data}
        pending={overview.isPending}
        error={overview.isError ? (overview.error as Error) : null}
      />

      {dashboard.isError
        ? <ErrorNote label="dashboard failed to load">{(dashboard.error as Error).message}</ErrorNote>
        : (
          // The loaded branch is a fragment of siblings inside the page's `flex flex-col gap-10`,
          // so Reveal takes that spacing: the wrapper is now the sibling, and without it the
          // grid and the pending list would lose their gap.
          <Reveal
            pending={dashboard.isPending}
            skeleton={<LowerBandSkeleton />}
            className="flex flex-col gap-10"
          >
            {dashboard.data && (
            <>
              <div className="grid gap-y-10 md:grid-cols-3">
                <Operations
                  goal={dashboard.data.goal}
                  streakWeeks={dashboard.data.streakWeeks}
                  scheduledCount={dashboard.data.scheduledCount}
                  pendingCount={dashboard.data.pendingActions.length}
                  pendingOpen={pendingOpen}
                  onTogglePending={() => setPendingOpen((v) => !v)}
                />
                <Upcoming rows={dashboard.data.upcoming.slice(0, 5)} />
                <StatusMix rows={dashboard.data.statusMix} />
              </div>
              {pendingOpen && <PendingList ref={revealPending} actions={dashboard.data.pendingActions} />}
            </>
            )}
          </Reveal>
        )}
    </div>
  );
}

/* ---- hero band ---------------------------------------------------------- */

function HeroBand({
  activeWindow, onWindowChange, data, pending, error,
}: {
  activeWindow: OverviewWindow;
  onWindowChange: (w: OverviewWindow) => void;
  data: OverviewDto | undefined;
  /** The query's own `isPending`. `!data` is not the same thing once placeholderData is on. */
  pending: boolean;
  error: Error | null;
}) {
  return (
    <section data-surface="dark" className="rounded-card bg-bone p-8 lg:p-10">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <h1 className="text-[clamp(2rem,4vw,3.2rem)] font-bold lowercase leading-[0.95] tracking-[-0.033em] text-ink">
          overview
        </h1>
        <div className="flex shrink-0 flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              data-probe={`window-${w}`}
              aria-pressed={w === activeWindow}
              onClick={() => onWindowChange(w)}
              className={`rounded-pill border px-3.5 py-1.5 text-[12px] lowercase transition-colors ${
                w === activeWindow ? 'border-ink bg-ink text-hero' : 'border-hairline text-soft hover:text-ink'
              }`}
            >
              last {w} days
            </button>
          ))}
        </div>
      </div>

      {error
        ? <div className="mt-8"><ErrorNote label="analytics failed to load">{error.message}</ErrorNote></div>
        : (
          <Reveal pending={pending} skeleton={<HeroSkeleton />}>
            {data && (
              <div className="mt-9 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
                <HeroCharts data={data} />
                <MainMetrics data={data} />
              </div>
            )}
          </Reveal>
        )}
    </section>
  );
}

function HeroCharts({ data }: { data: OverviewDto }) {
  const { current, previous } = data;
  const hasData = current.daysWithData > 0;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <div>
        <h2 className="text-[15px] lowercase text-soft">window comparison</h2>
        {hasData && (
          // The two series need naming or the diverging bars are unreadable; colouring the two
          // words is the legend (adaptation — the reference carries no legend element).
          <p className="mt-1.5 text-[12px] lowercase text-soft">
            <span className="text-salmon">previous</span> {range(previous)}
            {' · '}
            <span className="text-mint">current</span> {range(current)}
          </p>
        )}
      </div>

      {hasData
        ? (
          <>
            <DivergingBars
              rows={[
                { label: 'impressions', prev: previous.impressions, cur: current.impressions },
                { label: 'engagements', prev: previous.engagements, cur: current.engagements },
                { label: 'new followers', prev: previous.followersNew, cur: current.followersNew },
              ]}
            />
            <WeekdayBars days={data.weekday} />
          </>
        )
        : (
          <div data-probe="hero-empty">
            <EmptyState>no analytics in this window — import an export on the analytics page</EmptyState>
          </div>
        )}
    </div>
  );
}

function MainMetrics({ data }: { data: OverviewDto }) {
  const { current, followersTotal } = data;
  const hasData = current.daysWithData > 0;
  // `daysWithData` gates ONLY the window-derived figures; posts published and the follower
  // snapshot are sourced independently and stay real. Never an invented number.
  const windowValue = (n: number) => (hasData ? fmtNum(n) : '—');

  const cards = [
    {
      icon: <ImpressionsGlyph />,
      value: windowValue(current.impressions),
      label: 'impressions',
      sub: `posts published: ${fmtNum(current.postsPublished)}`,
    },
    {
      icon: <EngagementsGlyph />,
      value: windowValue(current.engagements),
      label: 'engagements',
      sub: current.impressions > 0
        ? `rate: ${fixed1((current.engagements / current.impressions) * 100)}%`
        : 'rate: —',
    },
    {
      icon: <NewFollowersGlyph />,
      value: windowValue(current.followersNew),
      label: 'new followers',
      sub: hasData ? `per day: ${fixed1(current.followersNew / current.daysWithData)}` : 'per day: —',
    },
    {
      icon: <FollowersTotalGlyph />,
      value: followersTotal ? fmtNum(followersTotal.value) : '—',
      label: 'followers total',
      sub: followersTotal ? `as of ${fmtDateOnly(followersTotal.asOf)}` : 'no follower snapshot yet',
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="text-[15px] lowercase text-soft">main metrics</h2>
      <div className="grid flex-1 grid-cols-2 overflow-hidden rounded-card bg-paper">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className={`${i % 2 === 1 ? 'border-l border-hairline-soft' : ''} ${i > 1 ? 'border-t border-hairline-soft' : ''}`}
          >
            <HeroStatCard icon={card.icon} value={card.value} label={card.label} sub={card.sub} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- light lower band --------------------------------------------------- */

const COL_1 = 'md:pr-10';
const COL_N = 'md:border-l md:border-hairline md:pl-10';

function Operations({
  goal, streakWeeks, scheduledCount, pendingCount, pendingOpen, onTogglePending,
}: {
  goal: { target: number; publishedInWeek: number } | null;
  streakWeeks: number | null;
  scheduledCount: number;
  pendingCount: number;
  pendingOpen: boolean;
  onTogglePending: () => void;
}) {
  // Goal and streak exist only once a weekly goal is set — a zero there would read as failure,
  // so the quartet degrades to the remaining tiles rather than inventing a target.
  const tiles: { label: string; value: string; note?: string; onClick?: () => void }[] = [];
  if (goal) tiles.push({ label: 'published this week', value: `${goal.publishedInWeek}/${goal.target}` });
  if (goal && streakWeeks !== null) tiles.push({ label: 'streak', value: fmtNum(streakWeeks), note: 'weeks on goal' });
  tiles.push({ label: 'scheduled', value: fmtNum(scheduledCount) });
  tiles.push({
    label: 'pending',
    value: fmtNum(pendingCount),
    note: pendingOpen ? 'hide the list' : 'actions waiting',
    onClick: onTogglePending,
  });

  return (
    <section className={COL_1}>
      <h2 className="mb-6 text-[15px] lowercase text-soft">operations</h2>
      <div className="grid grid-cols-2">
        {tiles.map((tile, i) => {
          const body = (
            <>
              <div className="text-[38px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
                {tile.value}
              </div>
              <div className="mt-2.5 text-[12px] lowercase text-soft">{tile.label}</div>
              {tile.note && <div className="mt-0.5 text-[12px] lowercase text-soft">{tile.note}</div>}
            </>
          );
          const cell = `py-4 ${i % 2 === 1 ? 'border-l border-hairline-soft pl-5' : 'pr-5'} ${
            i > 1 ? 'border-t border-hairline-soft' : ''
          }`;
          return tile.onClick
            ? (
              <button
                key={tile.label}
                type="button"
                onClick={tile.onClick}
                aria-expanded={pendingOpen}
                className={`${cell} text-left transition-opacity hover:opacity-70`}
              >
                {body}
              </button>
            )
            : <div key={tile.label} className={cell}>{body}</div>;
        })}
      </div>
    </section>
  );
}

function Upcoming({ rows }: { rows: UpcomingItemDto[] }) {
  return (
    <section className={COL_N}>
      <h2 className="mb-6 text-[15px] lowercase text-soft">upcoming</h2>
      {rows.length === 0
        ? <EmptyState>nothing scheduled — book a day in the planner</EmptyState>
        : (
          <ul className="flex flex-col">
            {rows.map((p) => {
              const stage = tickStageOf(p.status);
              return (
                <li key={p.id} className="flex items-center gap-3 border-b border-hairline-soft py-3 last:border-b-0">
                  <span className="w-[86px] shrink-0 text-[12px] lowercase tabular-nums text-soft">
                    {fmtDateOnly(p.scheduledDate)}
                    {p.scheduledTime && ` · ${p.scheduledTime.slice(0, 5)}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink" title={p.title}>{p.title}</span>
                  {stage && <TickMeter stage={stage} />}
                </li>
              );
            })}
          </ul>
        )}
      <Link
        to="/planner"
        className="mt-6 inline-flex rounded-pill border border-hairline px-4 py-1.5 text-[13px] font-semibold lowercase text-ink transition-colors hover:bg-paper"
      >
        open planner
      </Link>
    </section>
  );
}

function StatusMix({ rows }: { rows: { status: PostStatus; count: number }[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const ordered = [...rows].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const loadIn = useLoadIn();

  return (
    <section className={COL_N}>
      <h2 className="mb-6 text-[15px] lowercase text-ink">
        <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em]">{fmtNum(total)}</span> posts total
      </h2>
      {total === 0
        ? <EmptyState>no posts yet</EmptyState>
        : (
          <div className="flex flex-col gap-4">
            {ordered.map((r, i) => {
              const pct = (r.count / total) * 100;
              return (
                <div key={r.status}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] lowercase text-ink">{r.status.replace('_', ' ')}</span>
                    <span className="shrink-0 text-[13px] tabular-nums text-soft">{Math.round(pct)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full bg-hairline-soft">
                    {/* A div, not a span: `h-full` on an inline box would collapse. */}
                    <motion.div
                      className="h-full bg-mint"
                      style={{ minWidth: '3px' }}
                      initial={loadIn.initial({ width: '0%' })}
                      animate={{ width: `${pct}%` }}
                      transition={loadIn.transition(i)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </section>
  );
}

function PendingList({ actions, ref }: { actions: PendingActionDto[]; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="border-t border-hairline pt-6">
      {actions.length === 0
        ? <EmptyState>nothing pending — the operation is clean</EmptyState>
        : (
          <ul className="flex flex-col">
            {actions.map((a, i) => (
              <li key={`${a.kind}-${i}`} className="border-b border-hairline-soft last:border-b-0">
                <Link
                  to={a.href}
                  className="flex items-center justify-between gap-3 py-3 text-[14px] lowercase text-ink transition-colors hover:text-soft"
                >
                  <span className="min-w-0 truncate">{a.label}</span>
                  <span className="shrink-0 text-[13px] text-soft">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
