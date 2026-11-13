import { vi } from 'vitest';
import { api } from '../api/client';

/**
 * A fetch that never settles — the injected state that holds a page in its pending branch for as
 * long as the assertion needs. A healthy server never presents this, which is exactly why it is
 * the right way to pin the skeleton-vs-spinner branch (ADR 0013).
 */
export const NEVER = new Promise<never>(() => {});

/**
 * Every `api.get` hangs, except the paths named in `resolved`, which resolve to the given value.
 *
 * Keys are the full path INCLUDING any query string, matched exactly — `api.get`'s first argument
 * (`client.ts`: `get: (path) => fetch(\`/api${path}\`)`). A page inside a `RunWatcherProvider`
 * needs `'/runs?status=running'` resolved, or the watcher's poll hangs with everything else.
 */
export function spyPendingExcept(resolved: Record<string, unknown> = {}): void {
  vi.spyOn(api, 'get').mockImplementation((path: string) =>
    (path in resolved ? Promise.resolve(resolved[path]) : NEVER) as Promise<never>);
}
