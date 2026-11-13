import type { MonthDaySummaryDto } from '../../api/client';
import { dayIndexMonday, fmtMonthYear } from '../../lib/format';
import { Button } from '../primitives';

const WEEKDAYS = ['m', 't', 'w', 't', 'f', 's', 's'];

/**
 * The stream's navigator. Clicking a day moves the stream (scroll if it is already loaded, refetch
 * if it is not); the month arrows page THIS calendar only, so browsing ahead never yanks the agenda
 * out from under the reader.
 *
 * Marking is ink-only now: a dot under the number means something is booked that day, an underline
 * means something published there. The old salmon/mint day tints painted large flat colour fields
 * into a near-monochrome rail and read as status rather than as density.
 */
export function MiniMonth({ month, selected, today, rangeFrom, rangeTo, onPick, onMonth }: {
  month: MonthDaySummaryDto[];
  /** The day the stream is anchored on, `YYYY-MM-DD`. */
  selected: string;
  today: string;
  /** The loaded stream window, inclusive — days inside it read as already on screen. */
  rangeFrom: string;
  rangeTo: string;
  onPick: (date: string) => void;
  onMonth: (delta: number) => void;
}) {
  const first = month[0]?.date ?? selected;
  const lead = dayIndexMonday(first);

  return (
    <div data-probe="mini-month">
      <div className="mb-2 flex items-center gap-1">
        <button type="button" aria-label="previous month" onClick={() => onMonth(-1)}
          className="rounded-pill px-2 py-0.5 text-[14px] text-soft hover:bg-bone hover:text-ink">‹</button>
        <span className="flex-1 text-center text-[12px] lowercase text-ink">{fmtMonthYear(first)}</span>
        <button type="button" aria-label="next month" onClick={() => onMonth(1)}
          className="rounded-pill px-2 py-0.5 text-[14px] text-soft hover:bg-bone hover:text-ink">›</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w, i) => (
          <div key={`${w}${i}`} className="pb-1 text-center text-[10px] lowercase text-soft">{w}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
        {month.map((day) => {
          const isToday = day.date === today;
          const inRange = day.date >= rangeFrom && day.date <= rangeTo;
          const tone = isToday ? 'bg-ink text-bone font-semibold'
            : inRange ? 'bg-bone text-ink hover:text-ink'
              : 'text-soft hover:bg-bone hover:text-ink';
          const marker = isToday ? 'bg-bone' : 'bg-ink';
          const rule = isToday ? 'border-bone' : 'border-ink';
          return (
            <button
              key={day.date} type="button" onClick={() => onPick(day.date)}
              {...(isToday ? { 'data-today': 'true' } : {})}
              title={`${day.date} · ${day.scheduled} scheduled · ${day.published} published`}
              className={`flex aspect-square flex-col items-center justify-center gap-[2px] rounded-card text-[11px] tabular-nums transition-colors ${tone} ${
                day.date === selected && !isToday ? 'border border-ink' : ''}`}
            >
              <span className={`leading-none ${day.published > 0 ? `border-b ${rule} pb-[1px]` : ''}`}>
                {Number(day.date.slice(8))}
              </span>
              <span className={`size-[3px] rounded-full ${day.scheduled > 0 ? marker : 'opacity-0'}`} />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex justify-center">
        <Button variant="subtle" className="!px-3 !py-0.5 !text-[11px]" onClick={() => onPick(today)}>today</Button>
      </div>
    </div>
  );
}
