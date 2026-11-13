import { Skeleton } from '../skeleton';

/**
 * Overview's two loading footprints. Each mirrors its loaded region region-for-region so the
 * first real element lands within a few pixels of its stand-in.
 *
 * Section headings render REAL inside these: they are chrome, not data, and they are already
 * on screen before either query resolves (spec decision 8). Only the numbers and bars are
 * skeletonised.
 */

const COL_1 = 'md:pr-10';
const COL_N = 'md:border-l md:border-hairline md:pl-10';

/**
 * The seven weekday columns, at the heights of a plausible week. Arbitrary classes rather than
 * inline styles: `Skeleton` takes a className only, and the parent's `h-[124px]` gives these
 * percentages a definite height to resolve against.
 */
const WEEKDAY_HEIGHTS = ['h-[30%]', 'h-[45%]', 'h-[70%]', 'h-[55%]', 'h-[40%]', 'h-[60%]', 'h-[25%]'];

export function HeroSkeleton() {
  return (
    <div
      data-probe="skeleton-overview-hero"
      className="mt-9 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14"
    >
      <div className="flex min-w-0 flex-col gap-10">
        <div>
          <h2 className="text-[15px] lowercase text-soft">window comparison</h2>
          <Skeleton className="mt-1.5 h-4 w-56" />
        </div>

        {/* Same grid as DivergingBars, so the axis and the three rows land unmoved. */}
        <div className="grid grid-cols-[minmax(5rem,8rem)_1fr_1px_1fr] items-center gap-x-3 gap-y-7">
          <div className="col-start-3 self-stretch bg-hairline" style={{ gridRow: '1 / 4' }} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="contents">
              <Skeleton className="col-start-1 h-4 w-24" />
              <div className="col-start-2 flex justify-end">
                <Skeleton className="h-6 w-[40%]" />
              </div>
              <div className="col-start-4 flex justify-start">
                <Skeleton className="h-6 w-[20%]" />
              </div>
            </div>
          ))}
        </div>

        {/* WeekdayBars' 124px plot plus its mt-2 label row. The `flex gap-3` + `w-9` gutter
            mirrors weekday-bars.tsx: without them the seven columns spread across ~48px more
            width and every bar and label jumps right on the handoff. */}
        <div className="flex gap-3">
          <div className="h-[124px] w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex h-[124px] items-end justify-between">
              {WEEKDAY_HEIGHTS.map((h, i) => (
                <Skeleton key={i} className={`w-[11px] ${h}`} />
              ))}
            </div>
            <div className="mt-2 flex justify-between">
              {WEEKDAY_HEIGHTS.map((_, i) => (
                <Skeleton key={i} className="h-[15px] w-6" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <h2 className="text-[15px] lowercase text-soft">main metrics</h2>
        <div className="grid flex-1 grid-cols-2 overflow-hidden rounded-card bg-paper">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`${i % 2 === 1 ? 'border-l border-hairline-soft' : ''} ${i > 1 ? 'border-t border-hairline-soft' : ''}`}
            >
              <div className="flex h-full min-w-0 flex-col p-6">
                <div className="flex items-center gap-3.5">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="mt-3 h-3 w-24" />
                <div className="mt-auto border-t border-hairline-soft pt-3.5">
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LowerBandSkeleton() {
  return (
    <div data-probe="skeleton-overview-lower" className="grid gap-y-10 md:grid-cols-3">
      <section className={COL_1}>
        <h2 className="mb-6 text-[15px] lowercase text-soft">operations</h2>
        <div className="grid grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className={`py-4 ${i % 2 === 1 ? 'border-l border-hairline-soft pl-5' : 'pr-5'}`}>
              <Skeleton className="h-9 w-12" />
              <Skeleton className="mt-3 h-3 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section className={COL_N}>
        <h2 className="mb-6 text-[15px] lowercase text-soft">upcoming</h2>
        <div className="flex flex-col">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-hairline-soft py-3 last:border-b-0">
              <Skeleton className="h-[18px] w-[86px] shrink-0" />
              <Skeleton className="h-[21px] flex-1" />
              <Skeleton className="h-3 w-[15px] shrink-0" />
            </div>
          ))}
        </div>
        {/* The loaded branch's `open planner` pill carries the same mt-6. */}
        <Skeleton className="mt-6 h-8 w-28 rounded-pill" />
      </section>

      <section className={COL_N}>
        <div className="mb-6 flex items-baseline gap-2">
          <Skeleton className="h-6 w-8" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="flex items-baseline gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="ml-auto h-3 w-8" />
              </div>
              {/* The track is real; only its fill is data. */}
              <div className="mt-2 h-1.5 w-full bg-hairline-soft" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
