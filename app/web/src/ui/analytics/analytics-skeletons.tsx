import { Skeleton } from '../skeleton';

/**
 * Loading footprints for the two analytics pages. Both are single-payload pages, so each shows
 * ONE structured skeleton for the whole body rather than gating section by section.
 *
 * `BarList`'s cell widths are private to `bar-list.tsx`, so the row stand-ins hard-code the
 * matching values (`w-[5.5rem]` value cell; see `bar-list.tsx` VALUE_CELL).
 */

/** `SVG_H` in metric-chart.tsx. Change both together. */
const SVG_HEIGHT = 'h-[268px]';

/**
 * The chart's whole footprint: the 18px readout row + its `mb-1` + the SVG. Board reproduces the
 * readout row separately and uses SVG_HEIGHT; post detail has no readout row above its chart, so
 * it reserves the total in one block. Either way the drawn chart lands on its stand-in.
 */
const CHART_BLOCK = 'h-[290px]';

/** Mirrors `ListPanel`: tab header on a hairline, then a header row over five list rows. */
export function ListPanelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <section className="flex flex-col rounded-card border border-hairline bg-paper">
      <div className="flex flex-wrap items-center gap-x-6 border-b border-hairline-soft px-5 pt-4">
        {[0, 1].map((i) => <Skeleton key={i} className="mb-3 h-3 w-16" />)}
      </div>
      <div className="flex-1 px-5 pb-5 pt-4">
        <div className="flex items-center gap-3 px-2.5 pb-2">
          <Skeleton className="h-2 w-16" />
          <Skeleton className="ml-auto h-2 w-10" />
        </div>
        <ul className="border-t border-hairline-soft">
          {Array.from({ length: rows }, (_, i) => (
            <li
              key={i}
              className="flex items-stretch gap-3 border-b border-hairline-soft px-2.5 py-2.5 last:border-b-0"
            >
              <Skeleton className="h-[19.5px] flex-1" />
              <Skeleton className="h-[19.5px] w-[5.5rem] shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * One KPI tab or context stat: a small label over a big number, optionally over a sub line.
 *
 * Heights are the REAL line boxes, not the plan's assumed ones: preflight sets
 * `html { line-height: 1.5 }`, so 12px type occupies 18px and 11px occupies 16.5px. A `h-3`
 * stand-in for a 12px label is 6px short, and the misses compound down the strip.
 *
 * `sub` matters because `ContextStat` always renders one (`followersTotal` falls back to
 * "no snapshot yet"), and the strip is `items-stretch` — so the tallest cell sets the strip
 * height and therefore where the chart below it starts.
 */
function StatSkeleton({ sub = false }: { sub?: boolean }) {
  return (
    <div className="flex flex-col pb-5">
      <Skeleton className="h-[18px] w-20" />
      <Skeleton className="mt-2.5 h-7 w-16" />
      {sub && <Skeleton className="mt-2 h-[16.5px] w-24" />}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div data-probe="skeleton-analytics-board" className="space-y-5">
      <section className="rounded-card border border-hairline bg-paper">
        <div className="flex flex-wrap items-stretch justify-between gap-x-10 gap-y-6 border-b border-hairline-soft px-6 pt-5">
          <div className="flex items-stretch gap-8">
            {[0, 1, 2].map((i) => <StatSkeleton key={i} />)}
          </div>
          {/* The right-hand pair carries sub lines in the real strip: engagement rate has none,
              followers total always does. The taller one sets the strip height. */}
          <div className="flex items-start gap-10">
            <StatSkeleton />
            <StatSkeleton sub />
          </div>
        </div>
        <div className="px-6 pb-6 pt-5">
          {/* The chart's own readout row is reserved space even when empty — carry it, or the
              chart lands 22px higher than its stand-in. */}
          <div className="mb-1 h-[18px]" />
          <Skeleton className={`w-full ${SVG_HEIGHT}`} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[55fr_45fr]">
        <ListPanelSkeleton />
        <ListPanelSkeleton />
      </div>

      <ListPanelSkeleton />
    </div>
  );
}

export function PostDetailSkeleton() {
  return (
    <div data-probe="skeleton-post-analytics">
      <header className="border-b border-hairline pb-6">
        <Skeleton className="h-9 w-[60%]" />
        <div className="mt-3 flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-8 rounded-pill" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      </header>

      <div className="mt-8 space-y-5">
        <section className="rounded-card border border-hairline bg-paper">
          <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5 px-6 py-5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-6 w-12" />
              </div>
            ))}
          </div>
          <div className="border-t border-hairline-soft px-6 pb-6 pt-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className={`mt-3 w-full ${CHART_BLOCK}`} />
          </div>
        </section>

        {/* The loaded page puts these two in `grid gap-5 lg:grid-cols-2` — stacking them here
            would leave the skeleton a full panel taller and full-width at lg. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ListPanelSkeleton />
          <ListPanelSkeleton />
        </div>
      </div>
    </div>
  );
}
