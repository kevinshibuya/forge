import { Panel } from '../primitives';
import { Skeleton } from '../skeleton';

/**
 * The planner's loading footprint: the agenda stream on the left, the navigator and queue rail on
 * the right, on the same `lg:grid-cols-[1fr_268px]` as the loaded page.
 *
 * The `PageHeader` is NOT part of this — it renders unconditionally above, since it is chrome.
 */

/** The mini-month is a 5x7 grid of day cells under its month label. */
const MONTH_CELLS = 35;

function SlotRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-hairline-soft bg-paper px-3 py-3">
      <Skeleton className="h-3 w-12 shrink-0" />
      <Skeleton className="h-5 w-8 shrink-0 rounded-pill" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-16 shrink-0" />
    </div>
  );
}

export function PlannerSkeleton() {
  return (
    <div data-probe="skeleton-planner" className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_268px]">
      <section className="min-w-0">
        <div className="flex flex-col gap-6">
          {[0, 1, 2].map((g) => (
            <div key={g}>
              <Skeleton className="mb-3 h-3 w-32" />
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => <SlotRowSkeleton key={i} />)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <Panel className="p-4">
          <Skeleton className="mb-3 h-3 w-24" />
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: MONTH_CELLS }, (_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-card border border-hairline-soft bg-bone p-2.5">
                <div className="flex gap-2">
                  {[0, 1].map((j) => <Skeleton key={j} className="h-5 w-12 rounded-pill" />)}
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-6 w-20 rounded-pill" />
              </div>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}
