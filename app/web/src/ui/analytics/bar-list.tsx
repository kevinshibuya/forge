import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useLoadIn } from '../../lib/motion-tokens';

/**
 * Plausible's top-N list row (named graft #2): the value is right-aligned and a tinted
 * horizontal bar-fill sits BEHIND the whole row, scaled to the largest value in that list.
 * Nothing about the fill is a chart — no axis, no legend, no library.
 *
 * Shared by Analytics bands 2–3 and post detail, so the props stay deliberately dumb: the
 * caller formats every string and decides what the fill measures. `fill` is separate from
 * `value` on purpose — "cost vs return" fills by impressions-per-dollar while displaying
 * impressions, and collapsing the two would force that panel to lie about its scale.
 */

/** The two hues the page is allowed: mint = LinkedIn performance, salmon = internal spend. */
export type BarHue = 'mint' | 'salmon';

/** Low enough that `text-ink` stays fully legible over the fill in BOTH themes. */
const FILL: Record<BarHue, string> = {
  mint: 'bg-mint/25',
  salmon: 'bg-salmon/25',
};

export interface BarListRow {
  /** React key and, when `rowProbe` is set, the row's `data-key`. */
  id: string;
  /** Left cell. A node so callers can hang a soft sub-label (est. cost, urn) beside the text. */
  label: ReactNode;
  /** Plain text of `label`, for the row tooltip — nodes have no usable `title`. */
  labelText?: string;
  /** Right-aligned primary readout, already formatted. `—` for absent, never a stand-in 0. */
  value: string;
  /** The magnitude the fill is scaled against. NOT necessarily what `value` shows. */
  fill: number;
  /** Soft marker printed just past the value — e.g. the `window` grain tag. */
  tag?: string;
  /** Positional companions to `columns.extras`. Hidden below `lg` with their headers. */
  extras?: string[];
  /** Trailing affordance (the `attach` pill). Rendered outside the row button, never inside it. */
  trailing?: ReactNode;
  /** When set the row's content becomes a button — used for click-through to post detail. */
  onSelect?: () => void;
}

export interface BarListColumns {
  /** Header over the label cell. */
  label: string;
  /** Header over the value cell. */
  value: string;
  /** Headers over `row.extras`, positionally matched. The whole group hides below `lg`. */
  extras?: string[];
}

/* Fixed right-hand cell widths keep every value on one vertical line: the label cell absorbs
   the slack, so a row carrying an `attach` pill can never shove its neighbours' numbers. */
const EXTRA_CELL = 'hidden w-[4.5rem] shrink-0 text-right tabular-nums lg:block';
const VALUE_CELL = 'w-[5.5rem] shrink-0 text-right tabular-nums';
const TAG_CELL = 'w-[3.75rem] shrink-0 text-left';
const TRAILING_CELL = 'w-[4.5rem] shrink-0 text-right';

export function BarList({
  rows, hue, columns, rowProbe,
}: {
  rows: BarListRow[];
  hue: BarHue;
  /** Omit for a bare list (post detail's compact cost list wants no header). */
  columns?: BarListColumns;
  /** Stamped as `data-probe` on every row — what the browser smoke counts. */
  rowProbe?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.fill));
  const anyTag = rows.some((r) => r.tag !== undefined);
  const anyTrailing = rows.some((r) => r.trailing !== undefined);
  const extraCount = columns?.extras?.length ?? 0;
  const loadIn = useLoadIn();

  return (
    <div>
      {columns && (
        <div className="flex items-center gap-3 px-2.5 pb-2 text-[11px] lowercase text-soft">
          <span className="min-w-0 flex-1 truncate">{columns.label}</span>
          {columns.extras?.map((h) => <span key={h} className={EXTRA_CELL}>{h}</span>)}
          <span className={VALUE_CELL}>{columns.value}</span>
          {anyTag && <span className={TAG_CELL} />}
          {anyTrailing && <span className={TRAILING_CELL} />}
        </div>
      )}

      <ul className="border-t border-hairline-soft">
        {rows.map((r, rowIndex) => {
          // A present row always shows something: `minWidth` keeps a zero-magnitude row from
          // looking absent, the way the Overview bars mark their zeros.
          const width = max > 0 ? `${(r.fill / max) * 100}%` : '0%';
          const cells = (
            <>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {Array.from({ length: extraCount }, (_, i) => (
                <span key={i} className={`${EXTRA_CELL} text-soft`}>{r.extras?.[i] ?? '—'}</span>
              ))}
              <span className={VALUE_CELL}>{r.value}</span>
              {anyTag && <span className={`${TAG_CELL} pl-2 text-[11px] text-soft`}>{r.tag}</span>}
            </>
          );

          return (
            <li
              key={r.id}
              data-probe={rowProbe}
              className="relative flex items-stretch border-b border-hairline-soft text-[13px] text-ink last:border-b-0"
            >
              {/* Rows are keyed by r.id, so a tab switch or a dimension swap interpolates the
                  rows that persist. A row that mounts after the chart is up gets initial:false
                  from useLoadIn and appears at full width — no replay. */}
              <motion.span
                aria-hidden="true"
                className={`absolute inset-y-[3px] left-0 rounded-[3px] ${FILL[hue]}`}
                style={{ minWidth: '3px' }}
                initial={loadIn.initial({ width: '0%' })}
                animate={{ width }}
                transition={loadIn.transition(rowIndex)}
              />
              {r.onSelect
                ? (
                  <button
                    type="button"
                    onClick={r.onSelect}
                    title={r.labelText}
                    className="relative flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 text-left transition-colors hover:text-soft"
                  >
                    {cells}
                  </button>
                )
                : (
                  <div title={r.labelText} className="relative flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5">
                    {cells}
                  </div>
                )}
              {anyTrailing && (
                <div className={`relative flex items-center justify-end py-2.5 pr-2.5 ${TRAILING_CELL}`}>
                  {r.trailing}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
