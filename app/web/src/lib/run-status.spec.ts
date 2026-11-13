import { describe, it, expect } from 'vitest';
import { RunStatusSchema } from '@forge/shared';
import { RUN_DOT } from './run-status';

describe('RUN_DOT', () => {
  /**
   * Asserted against the shared schema, not against a copy of the four keys: a status added to
   * `RunStatusSchema` without a dot here has to fail something, and it cannot fail typecheck —
   * `RUN_DOT` is a `Record<string, string>`, so tsc sees no gap. This is the only guard.
   *
   * What the gap costs depends on the call site: `run-detail.tsx:112` and `RunsLog.tsx:60` fall
   * back to `bg-soft`, so the run reads as a warning it isn't; `Workspace.tsx:260` has no
   * fallback and renders no dot at all.
   *
   * The class strings themselves are deliberately not asserted — that would be the legibility
   * proxy ADR 0013 rejects.
   */
  it('covers every run status the API can emit', () => {
    expect(Object.keys(RUN_DOT).sort()).toEqual([...RunStatusSchema.options].sort());
  });
});
