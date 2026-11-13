# The canvas editor pins every element absolutely and undoes through an operation log

The first canvas editor let elements reflow when one was dragged out of flow, had no undo, and treated background refine as a separate flow producing its own candidate. Using it made all three unacceptable. The v2 model: every element is absolutely positioned from the moment the editor opens and moves only when dragged, undo/redo runs off an operation log of before/after pairs rather than document snapshots, and background refine happens inside the edit session so that **one save produces one candidate**.

Source: `docs/superpowers/specs/2026-08-08-canvas-editor-v2-design.md` (§Context, §Goals, §Decisions made during brainstorm). It supersedes the editor model of slice B4b in `docs/superpowers/specs/2026-08-08-post-details-fixes-design.md`.

## Consequences

- Pinning must wait for real metrics — `document.fonts.ready`, image decode, then a double rAF. Candidate HTML loads its fonts with `display=swap`, so measuring in the fallback face freezes wrong geometry into every element permanently (`HANDOFF-canvas-editor-v2.archived.md`).
- A save that included a refine gets origin `bg_refined` and the refine run's id; a layout-only save stays `canvas_edited` (`assets.origin` in `app/api/src/db/schema.ts`).
- A refine returns a background only, with no asset row of its own, which means background files from refines that were never saved are not cleaned up. That was accepted as a non-goal.
- Explicitly out: image upload, raw-HTML insertion, multi-select, cross-parent layer reordering, mobile.
