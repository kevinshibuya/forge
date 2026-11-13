import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PostStatus } from '@forge/shared';
import type { PlannerDayLaneDto, PlannerPostItemDto } from '../../api/client';
import { fmtDateOnly, fmtWeekdayShort } from '../../lib/format';
import { TickMeter, type TickStage } from '../overview/tick-meter';

/**
 * Buffer's agenda anatomy: one vertical chronological column, a bold lowercase day header per
 * date, and every row hung off a fixed-width TIME GUTTER on the left — the time labels the row,
 * it does not live inside the card. Slot rows share that gutter alignment and are deliberately
 * slimmer than a post card, so scheduling reads as "the next empty line of the day".
 */
const GUTTER = 'w-[76px] shrink-0';

/** `published`/`measured` are past the schedulable pipeline, so they carry no meter (4 ticks, no fifth). */
const TICK_STAGES = new Set<string>(['queued', 'drafting', 'draft_ready', 'approved']);
const tickStage = (status: PostStatus): TickStage | null =>
  (TICK_STAGES.has(status) ? (status as TickStage) : null);

function PostRow({ item, isPast, onEditTime, onUnschedule, children }: {
  item: PlannerPostItemDto;
  isPast: boolean;
  onEditTime: () => void;
  onUnschedule: () => void;
  /** The schedule popover, when this row owns it. */
  children?: ReactNode;
}) {
  const stage = tickStage(item.status);
  // PUBLISHING is what locks a row, not the calendar. A post whose date slipped past without
  // publishing is a MISSED schedule — the planner is the only surface that can move it (it is
  // filtered out of the queue rail and out of `dashboard.upcoming`), so a past day must keep its
  // edit-time and unschedule affordances. `isPast` still gates the slot row and the muted styling.
  const locked = item.publishedAt !== null;
  const timeLabel = item.scheduledTime ?? 'no time';

  return (
    <div data-post-id={item.id} className="relative flex gap-3 py-1">
      <div className={`${GUTTER} flex justify-end pt-1.5`}>
        {locked ? (
          <span className="rounded-pill px-2 py-0.5 text-[11px] tabular-nums lowercase text-soft">
            {item.scheduledTime ?? '—'}
          </span>
        ) : (
          <button
            type="button" onClick={onEditTime} aria-label={`edit time · ${item.title}`}
            className={`rounded-pill border px-2 py-0.5 text-[11px] tabular-nums lowercase transition-colors hover:border-ink hover:text-ink ${
              item.scheduledTime ? 'border-hairline text-ink' : 'border-dashed border-hairline-soft text-soft'}`}
          >
            {timeLabel}
          </button>
        )}
      </div>

      <div className={`flex min-w-0 flex-1 items-center gap-3 rounded-card border px-3 py-2 ${
        isPast ? 'border-hairline-soft' : 'border-hairline bg-paper'}`}>
        <Link to={`/posts/${item.id}`}
          className={`min-w-0 flex-1 truncate text-[13px] hover:underline ${isPast ? 'text-soft' : 'text-ink'}`}>
          {item.title}
        </Link>
        {stage && <TickMeter stage={stage} />}
        <span className="shrink-0 text-[11px] lowercase text-soft">{item.status.replace('_', ' ')}</span>
        {!locked && (
          <button type="button" onClick={onUnschedule}
            className="shrink-0 text-[11px] lowercase text-soft underline underline-offset-2 hover:text-ink">
            unschedule
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * One calendar day. `data-day` is the DOM contract the route smoke asserts placement against —
 * a post rendered under the wrong date is the exact timezone bug that probe guards.
 * Past days collapse to header + cards (nothing left to schedule there); past empty days are
 * dropped entirely by the stream so scrolling back does not wade through blank headers.
 */
function DayGroup({ day, isToday, isPast, onScheduleHere, onEditTime, onUnschedule, renderPopover }: {
  day: PlannerDayLaneDto;
  isToday: boolean;
  isPast: boolean;
  onScheduleHere: () => void;
  onEditTime: (item: PlannerPostItemDto) => void;
  onUnschedule: (item: PlannerPostItemDto) => void;
  renderPopover: (anchor: string) => ReactNode;
}) {
  return (
    <section data-day={day.date} className="scroll-mt-6">
      <div className={`flex items-center gap-2 pb-2 pt-6 ${
        isToday ? 'border-t-2 border-ink' : 'border-t border-hairline-soft'}`}>
        <h2 className={`text-[13px] lowercase tracking-[-0.01em] ${
          isToday ? 'font-bold text-ink' : isPast ? 'text-soft' : 'font-semibold text-ink'}`}>
          {fmtWeekdayShort(day.date)} {fmtDateOnly(day.date)}
        </h2>
        {/* text-hero, not text-ink: --salmon is theme-independent, so an inverting foreground
            would wash out in dark. --hero is near-black in BOTH themes (repo idiom, §2). */}
        {isToday && (
          <span className="rounded-pill bg-salmon px-2 py-0.5 text-[10px] font-semibold lowercase text-hero">
            today
          </span>
        )}
      </div>

      {day.posts.map((p) => (
        <PostRow
          key={p.id} item={p} isPast={isPast}
          onEditTime={() => onEditTime(p)} onUnschedule={() => onUnschedule(p)}
        >
          {renderPopover(`post:${p.id}`)}
        </PostRow>
      ))}

      {!isPast && (
        <div className="relative flex gap-3 py-1">
          <div className={GUTTER} />
          <button type="button" data-probe="slot-row" onClick={onScheduleHere}
            className="flex-1 rounded-card border border-dashed border-hairline-soft px-3 py-1.5 text-left text-[12px] lowercase text-soft transition-colors hover:border-ink hover:text-ink">
            + schedule a post here
          </button>
          {renderPopover(`day:${day.date}`)}
        </div>
      )}
    </section>
  );
}

export function AgendaStream({
  days, today, earlierCount, loadingEarlier, onShowEarlier,
  onScheduleHere, onEditTime, onUnschedule, renderPopover,
}: {
  days: PlannerDayLaneDto[];
  today: string;
  earlierCount: number;
  loadingEarlier: boolean;
  onShowEarlier: () => void;
  onScheduleHere: (date: string) => void;
  onEditTime: (item: PlannerPostItemDto, date: string) => void;
  onUnschedule: (item: PlannerPostItemDto) => void;
  renderPopover: (anchor: string) => ReactNode;
}) {
  // A past day with nothing on it is noise, not history: it renders nothing at all.
  const visible = days.filter((d) => d.date >= today || d.posts.length > 0);

  return (
    <div>
      {earlierCount > 0 && (
        <button type="button" data-probe="show-earlier" onClick={onShowEarlier} disabled={loadingEarlier}
          className="w-full py-3 text-left text-[12px] lowercase text-soft underline underline-offset-4 transition-colors hover:text-ink disabled:no-underline disabled:opacity-50">
          {loadingEarlier
            ? 'loading earlier…'
            : `show earlier · ${earlierCount} ${earlierCount === 1 ? 'post' : 'posts'}`}
        </button>
      )}

      {visible.map((day) => (
        <DayGroup
          key={day.date} day={day}
          isToday={day.date === today} isPast={day.date < today}
          onScheduleHere={() => onScheduleHere(day.date)}
          onEditTime={(item) => onEditTime(item, day.date)}
          onUnschedule={onUnschedule}
          renderPopover={renderPopover}
        />
      ))}
    </div>
  );
}
