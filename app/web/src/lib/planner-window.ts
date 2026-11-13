import { addDays } from './format';

/**
 * The planner's window arithmetic, extracted from `pages/Planner.tsx` so the shell can build the
 * page's default query key without importing the page.
 *
 * `plannerWindow(anchor)` and Planner's own first render MUST produce byte-identical keys — that
 * identity is the whole point of the nav prefetch. If they drift, the warm-up populates a cache
 * entry the page never reads and every navigation stays cold.
 *
 * `todayIso` deliberately stays in `./format`: it is the app-wide zone-correct "today", and a
 * second copy here would be a second source of truth.
 */

/** One stream chunk: today plus four weeks. "show earlier" walks backwards a chunk at a time. */
export const CHUNK = 28;

export const windowFrom = (from: string) => ({ from, to: addDays(from, CHUNK - 1) });

/**
 * Exactly what Planner passes to `usePlannerStream` on its first render, where `anchor` is the
 * resolved date (the `?date` param, or today). `month` is always sent — Planner anchors the
 * calendar explicitly on every render, so the hook's `'default'` key fallback is never live.
 */
export function plannerWindow(anchor: string): { from: string; to: string; month: string } {
  return { ...windowFrom(anchor), month: anchor };
}
