import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePlannerStream, useSchedulePost } from '../api/hooks';
import type { PlannerStreamDto } from '../api/client';
import { addDays, addMonths, todayIso } from '../lib/format';
import { CHUNK, windowFrom } from '../lib/planner-window';
import { EmptyState, ErrorNote, PageHeader, Panel, StatusPill, TierBadge, WarnBanner } from '../ui/primitives';
import { FadeIn, useShowedSkeleton } from '../ui/skeleton';
import { PlannerSkeleton } from '../ui/planner/planner-skeleton';
import { AgendaStream } from '../ui/planner/agenda-stream';
import { MiniMonth } from '../ui/planner/mini-month';
import { SchedulePopover, type ScheduleSubmit, type ScheduleTarget } from '../ui/planner/schedule-popover';

/** Exactly one popover is open at a time; `anchor` says which container renders it. */
interface PopoverState { anchor: string; target: ScheduleTarget; align?: 'left' | 'right' }

const isIsoDay = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default function Planner() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  // `?date=` anchors the INITIAL window only (the route smoke lands on /planner?date=<today+2> and
  // asserts that day's group exists). Afterwards the window is component state: re-reading the
  // param on every render would fight the "show earlier" prepends, which deliberately move `from`
  // without moving the anchor the URL names.
  const [range, setRange] = useState(() => {
    const q = params.get('date');
    return windowFrom(isIsoDay(q) ? q : today);
  });
  const [selected, setSelected] = useState(() => {
    const q = params.get('date');
    return isIsoDay(q) ? q : today;
  });
  // The calendar is ALWAYS anchored explicitly. Letting it default to the month of `from` means a
  // "show earlier" prepend drags it a month backwards — the navigator ends up showing july while
  // the stream on screen is mostly august, with today off the grid entirely. The two directions of
  // the contract are symmetric: arrows move the calendar and not the stream, and walking the stream
  // backwards moves the stream and not the calendar. Only a day pick moves both.
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const q = params.get('date');
    return isIsoDay(q) ? q : today;
  });
  const [pop, setPop] = useState<PopoverState | null>(null);
  /** True only between a "show earlier" click and the prepended window landing in the DOM — a bare
      `isFetching` would also light up on every mutation invalidation, which is not "loading earlier". */
  const [earlierPending, setEarlierPending] = useState(false);

  const stream = usePlannerStream({ from: range.from, to: range.to, month: monthAnchor });
  const schedule = useSchedulePost();

  // Keep the last payload on screen while a new window is in flight. Without this the query's
  // `data` drops to undefined on every key change, the whole stream unmounts, and the scroll
  // position a "show earlier" prepend is supposed to preserve is gone before we can restore it.
  const lastData = useRef<PlannerStreamDto | null>(null);
  if (stream.data) lastData.current = stream.data;
  const data = stream.data ?? lastData.current;
  // Latched here, above every early return, so the hook order never changes.
  const showedSkeleton = useShowedSkeleton(!data);

  const streamRef = useRef<HTMLDivElement>(null);
  /** Stream height captured at the click that triggered a prepend, or null when none is pending. */
  const prependFrom = useRef<number | null>(null);
  /** A day to scroll to once the window that contains it has rendered. */
  const pendingScroll = useRef<string | null>(null);

  const firstDay = data?.days[0]?.date ?? null;

  const scrollToDay = (date: string) => {
    const groups = Array.from(streamRef.current?.querySelectorAll<HTMLElement>('[data-day]') ?? []);
    // A past empty day renders nothing, so land on the first group at or after the target.
    const hit = groups.find((el) => el.dataset.day !== undefined && el.dataset.day >= date);
    (hit ?? groups[groups.length - 1])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Both effects are keyed on the FIRST rendered day, i.e. they fire once the new window is
  // actually in the DOM — never on a mid-flight render where the heights would still be the old
  // ones. Layout effect for the prepend so the correction lands before the browser paints.
  useLayoutEffect(() => {
    const before = prependFrom.current;
    if (before === null) return;
    prependFrom.current = null;
    setEarlierPending(false);
    const delta = (streamRef.current?.scrollHeight ?? 0) - before;
    if (delta > 0) window.scrollBy(0, delta);
  }, [firstDay]);

  useLayoutEffect(() => {
    const target = pendingScroll.current;
    if (target === null || firstDay === null) return;
    pendingScroll.current = null;
    scrollToDay(target);
  }, [firstDay]);

  // Both effects above are keyed on `firstDay`, which a FAILED fetch never moves: `stream.data`
  // stays undefined, `data` falls back to the previous window, and the prepend never "lands".
  // Without this the button would sit disabled reading "loading earlier…" forever, and the error
  // itself would be swallowed (nothing else in the app surfaces query errors). Unwind here, and
  // render the note below so the stale window on screen is labelled as stale.
  useEffect(() => {
    if (!stream.isError) return;
    prependFrom.current = null;
    setEarlierPending(false);
  }, [stream.isError]);

  const showEarlier = () => {
    prependFrom.current = streamRef.current?.scrollHeight ?? 0;
    setEarlierPending(true);
    setRange((r) => ({ ...r, from: addDays(r.from, -CHUNK) }));
  };

  const pickDay = (date: string) => {
    setPop(null);
    setSelected(date);
    setMonthAnchor(date);
    setParams({ date }, { replace: true });
    if (date >= range.from && date <= range.to) scrollToDay(date);
    else { pendingScroll.current = date; setRange(windowFrom(date)); }
  };

  const pageMonth = (delta: number) => setMonthAnchor((m) => addMonths(m, delta));

  const open = (state: PopoverState) => { schedule.reset(); setPop(state); };
  const close = () => { schedule.reset(); setPop(null); };
  const commit = ({ postId, date, time }: ScheduleSubmit) =>
    schedule.mutate({ id: postId, date, time }, { onSuccess: () => setPop(null) });
  const unschedule = (postId: number) =>
    schedule.mutate({ id: postId, date: null }, { onSuccess: () => setPop(null) });

  /**
   * One container can host two different targets at the same anchor (a day's slot row and, later,
   * a post row in the same day), and the popover seeds its fields in `useState` initializers —
   * mount-only. Without a per-target key React would reconcile them as one element and keep the
   * previous target's date/time in state, saving the wrong thing.
   */
  const targetKey = (t: ScheduleTarget) =>
    (t.kind === 'post' ? `post:${t.postId}` : `day:${t.date}:${t.presetPostId ?? ''}`);

  const popoverFor = (anchor: string) => (pop?.anchor !== anchor ? null : (
    <SchedulePopover
      key={targetKey(pop.target)}
      target={pop.target} queue={data?.queue ?? []} pending={schedule.isPending}
      {...(pop.align ? { align: pop.align } : {})}
      error={schedule.isError ? (schedule.error as Error).message : null}
      onSubmit={commit} onUnschedule={unschedule} onCancel={close}
    />
  ));

  if (stream.isError && !data) {
    return <ErrorNote label="planner failed to load">{(stream.error as Error).message}</ErrorNote>;
  }

  // No `Reveal` here: the body dereferences `data`, and JSX children are evaluated BEFORE Reveal
  // runs, so the narrowing the early return gives us would be lost. Keeping the guard preserves
  // it, and FadeIn supplies the same handoff. Do NOT extract the body into a child component to
  // regain Reveal — that would move every hook above this line.
  const header = (
    <PageHeader label="the planner" sub="click a day, pick a post. the calendar is the plan — nothing else schedules." />
  );
  if (!data) {
    return <div className="max-w-[1180px]">{header}<PlannerSkeleton /></div>;
  }
  const { days, earlierCount, month, queue, goal, streakWeeks } = data;

  const scheduledCount = days.reduce((n, d) => n + d.posts.length, 0);
  const goalShort = goal !== null && goal.publishedInWeek < goal.target;

  return (
    <div className="max-w-[1180px]">
      {header}

      <FadeIn enabled={showedSkeleton} className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_268px]">
        {/* ── the agenda stream ─────────────────────────────────────── */}
        {/* min-w-0: a grid item defaults to min-width:auto, i.e. as wide as its content, so a long
            post title would widen the 1fr track and scroll the whole page sideways. The titles
            truncate, but only once an ancestor stops growing to fit them. */}
        <section className="min-w-0" ref={streamRef}>
          {stream.isError && (
            <div data-probe="planner-stale" className="mb-4">
              <ErrorNote label="couldn’t load that window">
                {(stream.error as Error).message} — showing the last one that loaded
              </ErrorNote>
            </div>
          )}
          <AgendaStream
            days={days} today={today} earlierCount={earlierCount}
            loadingEarlier={earlierPending}
            onShowEarlier={showEarlier}
            onScheduleHere={(date) => open({ anchor: `day:${date}`, target: { kind: 'day', date } })}
            onEditTime={(item, date) => open({
              anchor: `post:${item.id}`,
              target: { kind: 'post', postId: item.id, label: item.title, date, time: item.scheduledTime },
            })}
            onUnschedule={(item) => unschedule(item.id)}
            renderPopover={popoverFor}
          />

          {scheduledCount === 0 && (
            <div className="mt-6">
              <EmptyState>
                {queue.length === 0
                  ? 'nothing scheduled, nothing queued'
                  : 'nothing booked in these four weeks — pick a day above'}
              </EmptyState>
            </div>
          )}
        </section>

        {/* ── right rail: navigator, then queue, then the nudge ─────── */}
        <aside className="flex flex-col gap-4">
          <Panel className="p-4">
            <MiniMonth
              month={month} selected={selected} today={today}
              rangeFrom={range.from} rangeTo={range.to}
              onPick={pickDay} onMonth={pageMonth}
            />
          </Panel>

          {(goal || streakWeeks !== null) && (
            <Panel className="p-4">
              {goal && (
                <div className="flex items-baseline justify-between text-[12px] lowercase">
                  <span className="text-soft">goal · this week</span>
                  <span className="tabular-nums text-ink">{goal.publishedInWeek}/{goal.target} published</span>
                </div>
              )}
              {streakWeeks !== null && (
                <div className="mt-1 flex items-baseline justify-between text-[12px] lowercase">
                  <span className="text-soft">streak</span>
                  <span className="tabular-nums text-ink">{streakWeeks} {streakWeeks === 1 ? 'week' : 'weeks'}</span>
                </div>
              )}
            </Panel>
          )}

          <div data-probe="queue-rail">
          <Panel className="p-4">
            <div className="mb-2 text-[12px] lowercase text-soft">queue · {queue.length}</div>
            {queue.length === 0
              ? <p className="text-[12px] lowercase text-soft">nothing waiting — promote ideas from the backlog</p>
              : (
                <div className="flex flex-col gap-2">
                  {/* bg-bone, not bg-paper: a paper card inside a paper panel is one flat field
                      with a hairline drawn on it. The queue reads as items sitting IN the rail. */}
                  {queue.map((p) => (
                    <div key={p.id} className="relative rounded-card border border-hairline-soft bg-bone p-2.5">
                      <div className="mb-1 flex items-center gap-1.5">
                        <TierBadge tier={p.tier} />
                        <StatusPill status={p.status} />
                      </div>
                      <Link to={`/posts/${p.id}`} className="block text-[12px] leading-snug text-ink hover:underline">
                        {p.title}
                      </Link>
                      <button type="button"
                        onClick={() => open({
                          anchor: `queue:${p.id}`, align: 'right',
                          target: { kind: 'post', postId: p.id, label: p.title, date: null, time: null },
                        })}
                        className="mt-1.5 rounded-pill border border-hairline px-2.5 py-0.5 text-[11px] lowercase text-soft transition-colors hover:border-ink hover:text-ink">
                        schedule
                      </button>
                      {popoverFor(`queue:${p.id}`)}
                    </div>
                  ))}
                </div>
              )}
          </Panel>
          </div>

          {goalShort && goal && (
            <WarnBanner>
              {goal.target - goal.publishedInWeek} more to publish this week
              {queue.length > 0 ? ` · ${queue.length} waiting in the queue` : ''}
            </WarnBanner>
          )}
        </aside>
      </FadeIn>
    </div>
  );
}
