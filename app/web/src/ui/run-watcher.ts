import { createContext, useContext } from 'react';
import type { RunDto } from '../api/client';

export interface RunWatcherValue {
  /** Hand a freshly-launched run to the watcher: registers a pending launch (busy immediately,
   *  before the next poll can see it) and tightens polling. */
  notifyLaunched: (runId: number, postId: number | null) => void;
  runningRuns: RunDto[];
  /** True while any run for this post is live OR a launch for it is pending discovery —
   *  pages derive busy/disabled state from this (closes the 202→poll double-click window). */
  isPostBusy: (postId: number) => boolean;
}

export const RunWatcherContext = createContext<RunWatcherValue | null>(null);

/** The watcher, from four surfaces that are not the console: the workspace, the image panel, the
 *  canvas editor and selection refine. It lives here rather than beside its provider because a
 *  hook with consumers in other files is not co-located with anything. */
export function useRunWatcher(): RunWatcherValue {
  const ctx = useContext(RunWatcherContext);
  if (!ctx) throw new Error('useRunWatcher must be used within RunWatcherProvider');
  return ctx;
}
