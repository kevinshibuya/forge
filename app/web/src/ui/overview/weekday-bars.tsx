import { motion } from 'motion/react';
import { fmtNum } from '../../lib/format';
import { useLoadIn } from '../../lib/motion-tokens';

export type WeekdayRow = { weekday: number; impressions: number; engagements: number };

/** 1 = monday … 7 = sunday, per the API's ISO weekday buckets. */
const LABELS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Round the axis top up to a readable 1/2/5 x 10^n so the gridline labels are legible. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 5, 10].find((s) => v <= s * mag) ?? 10;
  return step * mag;
}

/**
 * Dribbble spine: grouped mini bars under the diverging block — seven weekday groups, two
 * bars each (impressions mint and thick, engagements salmon and thin, per the reference's
 * thin/thick pairing), three hairline gridlines and small soft ticks. No chart library.
 *
 * A zero renders as no bar at all: at this size a stub would read as a real value, and the
 * axis labels already say what zero means.
 */
export function WeekdayBars({ days }: { days: WeekdayRow[] }) {
  const byWeekday = new Map(days.map((d) => [d.weekday, d]));
  const top = niceMax(Math.max(...days.flatMap((d) => [d.impressions, d.engagements]), 0));
  const height = (v: number) => (v > 0 ? `${Math.max((v / top) * 100, 1.5)}%` : '0%');
  const loadIn = useLoadIn();

  return (
    <div className="flex gap-3">
      <div className="relative h-[124px] w-9 shrink-0">
        {[top, top / 2, 0].map((t, i) => (
          <span
            key={t}
            className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-soft"
            style={{ top: `${i * 50}%` }}
          >
            {fmtNum(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-[124px]">
          {[0, 50, 100].map((t) => (
            <span key={t} className="absolute inset-x-0 border-t border-hairline-soft" style={{ top: `${t}%` }} />
          ))}
          <div className="absolute inset-0 flex justify-between">
            {LABELS.map((label, i) => {
              const row = byWeekday.get(i + 1);
              return (
                // `h-full` is load-bearing: the bars' percentage heights need a definite
                // parent height, and a content-sized group would resolve them to zero.
                //
                // Keyed by weekday, never by render order: a window switch must reconcile these
                // groups in place so the heights transition to the new values instead of
                // remounting already at them. On a window switch all fourteen bars share one
                // duration — the chart re-scales as a single object, which reads calmer than a
                // stagger and keeps the two series comparable mid-flight. Only the MOUNT render
                // staggers, by weekday, so the week grows in left to right; both bars of a
                // group share the weekday's slot and rise together.
                <div key={label} className="flex h-full flex-1 items-end justify-center gap-[3px]">
                  <motion.span
                    className="w-[5px] bg-salmon"
                    initial={loadIn.initial({ height: '0%' })}
                    animate={{ height: height(row?.engagements ?? 0) }}
                    transition={loadIn.transition(i)}
                  />
                  <motion.span
                    className="w-[11px] bg-mint"
                    initial={loadIn.initial({ height: '0%' })}
                    animate={{ height: height(row?.impressions ?? 0) }}
                    transition={loadIn.transition(i)}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex justify-between">
          {LABELS.map((label) => (
            <span key={label} className="flex-1 text-center text-[10px] lowercase text-soft">{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
