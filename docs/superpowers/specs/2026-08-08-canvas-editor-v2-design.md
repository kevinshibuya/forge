# Canvas editor v2 — design

Date: 2026-08-08
Status: approved (brainstorm complete, user-approved)
Scope: one spec, replacing the canvas editor shipped as slice B4b of `2026-08-08-post-details-fixes-design.md`.

All paths relative to `app/` unless noted.

## Context

Slice B4b shipped a working canvas editor: sandboxed iframe, click-select, drag-to-pin, double-click text edit, a font/colour/weight/alignment toolbar, and resize handles. Using it surfaced four gaps, all of which change the editor's model rather than patch its edges:

1. No undo. B4b's contract deliberately scoped undo out ("Escape/cancel is the undo") — that is not good enough for direct manipulation.
2. No way to add anything. The editor can only rearrange what the model already produced.
3. Dragging an element out of flow reflowed its siblings. B4b documented this as accepted; it is not.
4. Background refine and canvas edit are two separate flows over the same candidate, each producing its own child asset.

This spec supersedes those parts of B4b. Everything else about the editor (iframe sandbox, scale-to-fit, save-as-new-candidate, the `__HYBRID_BG__` reversal contract) stands.

## Goals

1. Undo/redo for every edit — move, resize, style, text, add, delete, background — on Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
2. Add new text blocks and boxes/shapes to the canvas; delete any element; control layer order.
3. Nothing ever reflows: every element is absolutely positioned from the moment the editor opens, and moves only when dragged.
4. Background refine happens inside the editor, contributing to the same save rather than producing a separate candidate.

Non-goals: image upload and raw-HTML insertion (considered and dropped); multi-select; cross-parent layer reordering; mobile; cleanup of bg files from refines that were never saved; rich-text formatting within a text block beyond the existing toolbar.

## Decisions made during brainstorm

| Decision | Choice |
| --- | --- |
| Refine result | Returns a background only, no asset row; joins the current edit session; one save = one candidate |
| Add menu | Text block + box/shape (image upload and raw-HTML rejected) |
| Layer control | Requested during brainstorm; front/forward/backward/back writing explicit `z-index` |
| Undo mechanism | Operation log with before/after, NOT document snapshots |
| Undo inside a text edit | Native `contentEditable` undo; the committed change is one entry |
| Delete | Included — "add" without "delete" is a trap |
| Standalone refine modal | Removed; the card's "refine bg" button opens the editor with the refine panel open |
| Origin of a save that included a refine | `bg_refined` (with `runId` = the refine run); layout-only saves stay `canvas_edited` |
| PR strategy | Folded into the open PR2 branch `feat/post-details-images`; no review of B1–B4b |

## Section 1 — Pin-all: absolute from the start

### 1a. What happens on open

Once the iframe document is ready, before any user gesture, the runtime converts the document to an absolutely-positioned layout in two passes:

Pinning waits for the document's real metrics: `document.fonts.ready`, image decode, and a double `requestAnimationFrame` must all resolve first — the candidate html loads web fonts with `display=swap`, and measuring during the fallback face would freeze every box at the wrong geometry (the server renderer already awaits fonts for the same reason). Gestures and selection are inert until pinning completes.

**Pass 1 (measure, no mutation).** Walk `body`'s descendants in document order. For each element decide whether it is a *pin target*, and if so record its `getBoundingClientRect()`, its computed `margin-left`/`margin-top`, and its parent's rect plus border widths. Measuring everything first is required — the first mutation invalidates every later measurement.

**Pass 2 (apply, document order).** For each target, set `position:absolute`, explicit `width` and `height` from the measured rect, `right:auto`, `bottom:auto`, `margin:0`, and `left`/`top` computed from the measured border-box rect against the padding edge of its **nearest ancestor that is itself a pin target** (else `body`) — i.e. its post-pin containing block, NOT the literal DOM parent, which may be a skipped inline wrapper. Margins are zeroed inline rather than subtracted out because computed margins are *used* values: a block centred with `margin: 0 auto` measures a concrete left margin that would resolve to 0 after pinning and throw the element sideways.

Document order matters: a parent is pinned before its children, and because the parent gets an explicit `height`, extracting its children cannot collapse it. Every pin is therefore visually a no-op, and the whole document ends up with each element positioned against its nearest pinned ancestor.

`body` gets `position:relative` so top-level children have a containing block.

### 1b. What counts as a pin target

Pin an element when its computed `display` is block-level (`block`, `flex`, `grid`, `list-item`, `table`) **or** it is a replaced element (`img`, `svg`, `video`, `canvas`).

Skip:
- `html`, `body`, and the editor's own artifacts (`#__forge_ed*`).
- Inline-level elements (`inline`, `inline-block`, `inline-flex`) — `<em>`, `<strong>`, `<a>`, `<span>`, `<br>` inside a headline stay in text flow, so rich text inside a text block survives editing and resizing.
- Elements with zero width or height.

Elements already `position:fixed` are pinned as `absolute` at their current visual position.

The background carriers are identified **once, at pin time** — every pin target covering ≥95% of the canvas (a document may stack more than one full-bleed layer, and all of them are structure) — and tagged with a `data-forge-bg` attribute (stripped at serialize). It IS pinned (it must keep its box) but `selectable()` rejects it by the tag, not by a live area check. This matters twice over: a user-added box resized to near-full-bleed must stay selectable (v1's live ratio check would strand it — unshrinkable, undeletable), and the check must stay stable after a mid-session background swap.

### 1c. What this removes and what it costs

`pin()`'s lazy conversion on first drag and its reflow-correction second pass (which existed only to undo the sibling collapse) both disappear. Drag becomes a pure `left`/`top` write.

The cost, accepted: **a save with zero edits no longer round-trips to byte-identical html.** The stored html source of a child gains explicit geometry on every block element. This is harmless for a fixed 1200×1200 render and makes the child re-editable on identical terms.

## Section 2 — Undo/redo

### 2a. Why an operation log, not snapshots

The editable html carries the background inlined as a data URI — measured at ~1.7MB. Full-document snapshots per operation would cost hundreds of megabytes over a session. The log stores only what changed.

### 2b. Element identity

Every pin target gets a `data-forge-eid` attribute (a monotonic counter) during pass 2, and every element created by "add" gets one on insert. Undo entries reference elements by eid, so an entry stays valid across intervening operations, including re-insertion of a deleted node. `data-forge-eid` is stripped at serialize alongside the other editor artifacts.

### 2c. Entry types

| Type | Payload | Covers |
| --- | --- | --- |
| `style` | eid, map of property → `{ before, after }` | move, resize, font size, colour, weight, alignment, z-index, fill, radius, opacity |
| `text` | eid, `before`/`after` innerHTML | committed inline text edits |
| `insert` | eid, parent eid, index, outerHTML | add text / add box |
| `remove` | eid, parent eid, index, outerHTML | delete |
| `background` | `before`/`after` bgRunId (keys into a runtime-held `Map<runId | null, dataUri>`; `null` = source) | a refine landing, or an undone one |

`background` entries deliberately store keys, not the ~1.7MB URI strings — N refines retain N+1 URIs in the map, not 2N copies in the log.

### 2d. Granularity and behaviour

One entry per completed gesture: a drag from pointerdown to pointerup is a single entry, not one per pointermove; likewise a resize. Each discrete toolbar action (one stepper click, one colour commit) is its own entry.

Undo applies `before`; redo applies `after`. Any new operation clears the redo stack. The stack is capped at 100 entries, oldest dropped.

Undo/redo re-selects the element the entry refers to (and scrolls nothing — the canvas is fully visible), so the effect is always visible.

**Inside an active text edit, Cmd/Ctrl+Z is left to the browser**, so backing out a word behaves as it does anywhere else. The editor's own stack sees the text change as one entry at commit time. Accepted quirk: the browser's contentEditable undo stack is document-scoped and is not cleared on commit, so Cmd+Z inside a *new* text edit may (browser-dependent) reach back into a previous element's committed text. The operation log's `before`/`after` snapshots are captured at edit start/commit, so the editor's own undo remains correct regardless; the quirk is bounded to what the browser does while a text edit is active.

### 2e. Where the keystroke is caught

Focus can be in the parent document (toolbar) or inside the iframe. Both listen: the parent forwards an `undo`/`redo` command to the runtime, and the runtime handles its own keydown directly. The parent listener MUST NOT forward when focus sits in one of its own text inputs (notably the refine panel's instruction textarea) — there Cmd+Z means "undo my typing", and stealing it for the canvas would be hostile. The toolbar also carries explicit undo/redo buttons with disabled states driven by the runtime's reported stack depths.

## Section 3 — Add, delete, layer

### 3a. Add

- **add text** — inserts a text block at the canvas centre, 600×120, absolutely positioned, immediately in edit mode with its contents selected so typing replaces the placeholder. Its defaults are deterministic: `font-family` copied from `body`'s computed style, 48px, weight 700, and colour copied from the computed colour of the document's largest existing text element (falling back to `#ffffff` when there is none) — so a new block is legible against the same background the others sit on.
- **add box** — inserts a 400×240 rectangle at the canvas centre, fill `#000000` at 40% opacity, radius 0.

Both are ordinary elements the instant they exist: selectable, draggable, resizable, styleable, deletable, undoable.

### 3b. Box styling

When the selection is a box, the toolbar exposes fill colour, corner radius (px) and opacity (0–100%). The text controls are irrelevant to a box and are disabled for it; the box controls are hidden for text. The runtime reports which control group applies as part of the selection message.

### 3c. Delete

Backspace or Delete removes the selected element (never while a text edit is active — there the keys are text input). Recorded as a `remove` entry, so Cmd+Z brings it back at its original index.

### 3d. Layer order

Four actions: to front / forward / backward / to back. Each writes an explicit `z-index` on the selection relative to its siblings — bring-to-front is `max(sibling z) + 1`, and forward/backward swap with the nearest sibling above/below.

**Known limit, accepted:** `z-index` only orders elements within a shared stacking context, so an element nested inside one container cannot be raised above a sibling of that container. Reparenting to escape this is out of scope.

## Section 4 — Refine inside the editor

### 4a. Server contract

Three changes, all in `api/src/images/`:

**`POST /images/assets/:assetId/bg-patch` → 202 `{ runId }`** (`ImageRefineService.launchBgPatch(assetId, instruction)`). Runs exactly the pipeline B3 built — source validation, one codex `image_gen` sub-call with the source `bg.png` attached and `assembleBgRefinePrompt(instruction)` — into a fresh group dir, and stops there. It verifies the new `bg.png` with `readPngSize` and creates **no asset row**. The managed run row is still created, so the spend is recorded and the breakdown/history surfaces see it.

**`GET /images/runs/:runId/patched-bg` → `{ bgDataUri }`.** 404 while the run is still going or the file is absent; 422 when the run failed, carrying the failure reason.

Because no asset row exists to record where the file went, the scratch directory is **derived from the run**, not stored: `candidateDir(run.postId, 'patch-' + runId)`. The endpoint loads the run row for its `postId`, rebuilds the path, and reads `bg.png` from it. This keeps the lookup stateless and makes the orphaned-file case self-describing on disk. One structural consequence: since the dir is named after the runId, it is created *inside* the managed run's callback (which receives `runId`) rather than before launch as `launchBgRefine` does — do not restructure the launch race to get the id earlier.

**`POST /images/assets/:assetId/edit` gains an optional `bgRunId`.** When present, the child is composited over that run's `bg.png` instead of the source's, that file is the one copied into the child's dir, and the child is written with `runId = bgRunId`, `origin: 'bg_refined'`, and `generationPrompt` = the patch run's prompt (the refine instruction — B3's established meaning of a `bg_refined` child's prompt). Absent, behaviour is exactly today's: source background, `runId: null`, `origin: 'canvas_edited'`.

A present `bgRunId` is **validated with named-reason 422s** in `requireRefinableSource`'s style, not left to blow up downstream (a missing run would otherwise surface as a plain-`Error` 500 via `RunsService.get`, and a run belonging to a different post would silently composite another post's background): the run must exist, have `kind === 'image_refine'`, have `postId === source.postId`, and its patch `bg.png` must pass `readPngSize`.

`launchBgRefine` (B3's asset-creating entry point) and its controller route are removed — the patch flow replaces it, and leaving two refine paths would mean two ways for a candidate to be born.

### 4b. Editor flow

The editor gains a refine panel: an instruction textarea and a launch button. On launch it POSTs `bg-patch`, calls `notifyLaunched(runId, postId)` so the run console shows progress like any other run, and polls the run. The editor stays fully usable while the run is in flight — this is a minute of waiting and there is no reason to freeze the canvas.

On success it fetches the patched background and hands it to the **runtime**, which owns the swap end-to-end: a `background` command carries `{ toUri, runId }`, the runtime replaces every occurrence of the currently-applied URI with the new one — across inline `style` attributes and `<style>` element text — and pushes the `background` undo entry onto its own stack. The parent never tracks the current background itself; after any refine or undo, the runtime is the single source of truth for which URI is applied and which `bgRunId` it belongs to.

On failure the panel shows the run's failure reason and the canvas is untouched.

Escape while focus is in the panel's instruction textarea (or any parent input) blurs the field only — it never closes the editor from there; a second Escape closes. Losing a half-typed instruction to a reflexive Escape is the trap this avoids.

Refining repeatedly is allowed; each patch is a separate run and a separate undo entry, and the last one that survives undo is the one that gets saved.

### 4c. Save

The save payload becomes `{ html, bgRunId? }` where `bgRunId` is the run behind the currently-applied background, or absent if the background is still the source's (including after undoing every refine).

Because the runtime owns the background state, **the serialize reply carries it back**: the `html` event becomes `{ html, bgDataUri, bgRunId }`, reporting the URI actually applied in the document at serialize time and the run it came from (`bgRunId: null` for the source background). The parent performs the `__HYBRID_BG__` reversal with the URI the runtime reports — never with its own memory of what it loaded or last swapped in. This is the invariant that must not drift: refine → undo → save must reverse the *source* URI and post no `bgRunId`, and the parent cannot know that on its own.

### 4d. Entry point

The standalone refine modal and its hook are deleted. The card's "refine bg" button remains, and opens the canvas editor with the refine panel already open — the one-click path to a pure refine survives, it just lands somewhere you can also see the result.

### 4e. Accepted consequences

- **A refine that is never saved still costs money.** The run row records the spend; the bg file is orphaned on disk. No cleanup is built.
- **A save that included a refine is `bg_refined`, not `canvas_edited`**, even when layout changed too. Without this the "refined" origin filter would go permanently empty once the standalone flow is gone. The distinction the chips draw is coarse by design.

## Section 5 — Error handling

| Failure | Behaviour |
| --- | --- |
| `editable-html` fails on open | Error banner, editor stays open, save disabled (today's behaviour, unchanged) |
| Refine run fails | Panel shows the run's failure reason; canvas untouched; editor usable |
| `patched-bg` 404 after success | Treated as a refine failure with a "background could not be read back" message |
| Save 422 (token missing) | Error banner, editor stays open (today's behaviour, unchanged) |
| Save 422 (bad `bgRunId`: missing run, wrong kind, wrong post, unreadable patch file) | Error banner with the named reason, editor stays open |
| Save 500 (render failed) | Error banner with the server's detail, editor stays open |
| Undo with an empty stack | No-op; the button is disabled |

## Section 6 — Testing

**API (vitest, real `forge_test` DB, fake engines):**
- `bg-patch` runs the pipeline, creates a run row and a readable `bg.png`, and creates **no** asset row.
- `patched-bg` returns a data URI after success, 404 before, 422 on a failed run.
- `edit` with `bgRunId` composites the patched background, copies that file into the child dir, and lands `origin: 'bg_refined'` with `runId` set.
- `edit` with a bad `bgRunId` 422s with a named reason for each case: nonexistent run, run of another kind, run of another post, unreadable patch `bg.png`.
- `edit` without `bgRunId` is unchanged from B4a (regression guard).
- `api/test/image-refine.spec.ts` is **rewritten**, not edited around: its subject (`launchBgRefine`) ceases to exist, so the file is replaced with the equivalent assertions against `launchBgPatch` — same attach-the-source-bg, same 422 validation, same new-group-dir isolation, minus the asset assertions and plus "no asset row was created". This is the one place in this work where an existing acceptance test changes, and it changes because the contract it pins was deliberately replaced. It is not licence to weaken it: every assertion that still has a subject must survive.

**Web:** typecheck, lint, and a browser smoke as always. The editor's behaviours are verified at runtime against the sacrificial post, which is where B4b's two real bugs were caught and where these must be too:
- pin-all leaves the rendered document visually identical on open (screenshot before/after pinning matches within tolerance)
- dragging an element moves nothing else
- undo/redo restores position, size, colour, text, an added element, a deleted element, and a background
- add text / add box / delete / layer order round-trip through a save
- a refine inside the editor swaps the background with edits intact, and one save produces one candidate
- refine → **undo** → save reverses the *source* URI, posts no `bgRunId`, and lands `canvas_edited` (the state-ownership case that motivated the runtime owning the background)

## Out of scope

Image upload; raw-HTML insertion; multi-select; grouping; reparenting elements; undo history persisted across editor sessions; cleanup of orphaned refine backgrounds; any change to the image list, breakdown, or run-history surfaces.
