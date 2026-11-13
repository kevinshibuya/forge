import { Panel } from './primitives';
import { Skeleton } from './skeleton';

/**
 * The workspace's loading footprint: the sticky action band, the tab row, the editor panel and
 * the concept panel. The `PageHeader` renders unconditionally above this — it is chrome.
 *
 * Known and accepted: the skeleton assumes no "the idea" panel (a separate query, shown only for
 * promoted posts). When that panel does land, the body sits ~80px lower than the skeleton. Out of
 * scope for this plan.
 */
export function WorkspaceSkeleton() {
  return (
    <div data-probe="skeleton-workspace">
      <div className="-mx-10 mb-4 flex flex-wrap items-center gap-2 border-b border-hairline bg-bone px-10 py-3">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-5 w-8 rounded-pill" />
        <Skeleton className="h-5 w-20 rounded-pill" />
        <Skeleton className="ml-auto h-8 w-24 rounded-pill" />
        <Skeleton className="h-8 w-20 rounded-pill" />
      </div>

      <div className="mb-4 flex gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-7 w-16 rounded-pill" />)}
      </div>

      <Panel>
        <Skeleton className="mb-3 h-4 w-16" />
        {/* The editor's own `min-h-[420px]`. */}
        <Skeleton className="h-[420px] w-full" />
      </Panel>

      <Panel className="mt-4">
        <Skeleton className="mb-3 h-4 w-16" />
        <Skeleton className="h-16 w-full" />
      </Panel>
    </div>
  );
}
