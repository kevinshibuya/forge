import { Fragment } from 'react';
import { motion } from 'motion/react';
import { fmtNum } from '../../lib/format';
import { useLoadIn } from '../../lib/motion-tokens';

export type DivergingRow = { label: string; prev: number; cur: number };

/**
 * The share of each half a full-scale bar may occupy. The remainder is the gutter the value
 * label sits in — the reference puts the number immediately past the bar's free end, so the
 * longest bar has to stop short of the edge. Both series use the same factor, so the two
 * halves stay directly comparable.
 */
const BAR_SPAN = 88;

/**
 * The value label is a CHILD of its bar, pinned just past the bar's free end (`right-full` /
 * `left-full`). That is what lets the number ride the bar for free when the window changes: one
 * animated property (the bar's width) carries both, so the label can never drift out of step
 * with the bar it annotates. Positioning it independently would mean interpolating a `max()`
 * offset alongside — two transitions to keep in sync, for identical pixels.
 */
const VALUE = 'absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] tabular-nums text-ink';

/**
 * Dribbble spine: one row per metric, two hard-rectangle bars diverging from a single 1px
 * axis that runs the height of the block. Previous window extends LEFT (muted salmon),
 * current extends RIGHT (mint); both series share one scale — the max across all values.
 * The value sits at the free end of its bar.
 *
 * Zero is drawn as a minimum-width stub rather than nothing: absence of a bar and a bar of
 * length zero must not look the same (the reference marks a zero the same way).
 *
 * Hand-rolled grid, no chart library. Column 3 is the axis; content cells never occupy it,
 * so the axis can span every row.
 */
export function DivergingBars({ rows }: { rows: DivergingRow[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.prev, r.cur]));
  const span = (v: number) => `${(v / max) * BAR_SPAN}%`;
  // Both bars of a row share one stagger slot, so a pair grows together and the
  // row reads as a single comparison rather than two arrivals.
  const loadIn = useLoadIn();

  return (
    <div
      data-probe="diverging-bars"
      className="grid grid-cols-[minmax(5rem,8rem)_1fr_1px_1fr] items-center gap-x-3 gap-y-7"
    >
      <div
        className="col-start-3 self-stretch bg-hairline"
        style={{ gridRow: `1 / ${Math.max(rows.length, 1) + 1}` }}
      />
      {rows.map((r, rowIndex) => (
        <Fragment key={r.label}>
          <div className="col-start-1 truncate text-[14px] lowercase text-ink" title={r.label}>{r.label}</div>

          <div className="relative col-start-2 h-6">
            {/* right-0 anchored, so growing the width grows the bar leftward from the axis. */}
            <motion.span
              className="absolute inset-y-0 right-0 bg-salmon/70"
              style={{ minWidth: '5px' }}
              initial={loadIn.initial({ width: '0%' })}
              animate={{ width: span(r.prev) }}
              transition={loadIn.transition(rowIndex)}
            >
              <span className={`${VALUE} right-full pr-2.5`}>{fmtNum(r.prev)}</span>
            </motion.span>
          </div>

          <div className="relative col-start-4 h-6">
            <motion.span
              className="absolute inset-y-0 left-0 bg-mint"
              style={{ minWidth: '5px' }}
              initial={loadIn.initial({ width: '0%' })}
              animate={{ width: span(r.cur) }}
              transition={loadIn.transition(rowIndex)}
            >
              <span className={`${VALUE} left-full pl-2.5`}>{fmtNum(r.cur)}</span>
            </motion.span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
