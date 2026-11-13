# Post details page fixes — design

Date: 2026-08-08
Status: shipped. Slice B4b's editor model is superseded by the canvas editor v2 (ADR 0012).
Scope: one spec, three independently landable slices (text, images, history) on a shared data foundation.

All paths relative to `app/` unless noted.

## Goals

1. Selection-based body refinement with preview + accept/reject.
2. Editable hashtags on the write tab.
3. Per-image "breakdown": the starting prompt (including its batch variation direction) and the full step conversation that produced it.
4. Image list: newest-first, faint created date per card, server-side pagination, sort toggle, origin filter.
5. Image refinement: background-only patch via gpt-image-2 image attachment, result as a new card linked to its source; PLUS a canvas editor for the HTML text layer (text edit, drag, resize, font size, color, weight, alignment).
6. History tab run details: duration, steps spawned, tokens, estimated cost from a settings-backed pricing map. This is the base for the future analytics page.

Non-goals: backfilling data for pre-migration runs/images (they show "not recorded"); batch-level grouping of runs; rich-text body editing; canvas editing beyond the listed toolbar.

## Decisions made during brainstorm

| Decision | Choice |
| --- | --- |
| Spec scope | One spec, three slices, separate PRs allowed |
| Selection-refine landing | Preview + accept/reject; only accept mutates the body |
| Refined image landing | New card linked to source; source untouched |
| Missing historical data | Capture going forward; honest "not recorded" placeholders |
| Hashtag editing | Chip editor (remove / edit-in-place / add with normalization) |
| Image list controls | Sort toggle newest/oldest + origin ("type") filter; pagination assumed |
| Refine target | Background-only (attach bg.png), re-composite same HTML; canvas editor covers text-layer fixes |
| Canvas editor power | Full style toolbar: text edit, drag, resize, font size, color, weight, alignment |
| Pricing source | Settings with defaults; cost computed at read time from stored tokens |
| Step persistence | New `run_steps` table + `assets.runId` FK |
| Pagination | Server-side (`limit/offset`, total count) |

## Section 1 — Data foundation (cross-cutting)

One migration, three concerns. Current migration head must be confirmed at plan time (`api/drizzle/`).

### 1a. `run_steps` table

One row per sub-call inside a managed run:

```
run_steps: id, runId (FK → runs.id, ON DELETE CASCADE), seq (int),
  kind (text: 'variate' | 'plan' | 'bg_gen' | 'html' | ...), engine, model,
  prompt (text), output (text), tokensInput (int, null), tokensOutput (int, null),
  imagesGenerated (int, null), startedAt, finishedAt, failureKind (null)
```

Recorded by the `call()` wrapper inside `runner.executeManaged` (`api/src/runner/runner.service.ts:119-149`), which today only emits SSE events. Every sub-call gets a row: prompt, output, usage, timing. This single mechanism feeds both the image conversation breakdown (slice B) and run-details analytics (slice C).

### 1b. `assets` lineage columns

- `runId` (FK → runs.id, ON DELETE SET NULL) — set at `images.create` time by the hybrid pipeline (`api/src/images/image-compose.service.ts`), ending the "match by candidateGroupId/timestamp" archaeology.
- `sourceAssetId` (FK → assets.id, ON DELETE SET NULL) — set by refine/edit flows.
- `origin` enum: `'generated' | 'bg_refined' | 'canvas_edited'`, NOT NULL DEFAULT `'generated'`.

### 1c. Usage capture + pricing

- `EngineResult` (`api/src/engines/engine.interface.ts`) grows optional `usage?: { inputTokens?: number; outputTokens?: number }`.
- **Claude engine** (`api/src/engines/claude.engine.ts`): the stream-json `result` line already contains usage — parse it in `interpret()` instead of discarding it. No CLI invocation change.
- **Codex engine** (`api/src/engines/codex.engine.ts`): best-effort regex for token counts in output; absent counts stay null. The bg-gen caller records `imagesGenerated: 1` (flat per-image pricing unit).
- `runs` gains `tokensInput`, `tokensOutput`, `imagesGenerated` (nullable ints) — totals for the run, covering single-call runs (draft, refine, triage…) that have no steps. For managed runs, totals = sum of steps, written at `runs.succeed`/`fail` time.
- **Pricing map in settings** (`shared/src/settings.ts` defaults + existing settings module): per-model `{ inputPerMTok, outputPerMTok }` in USD, plus `imagePerUnit` for `gpt-image-2`. Cost is ALWAYS computed at read time (API layer) from stored tokens × current settings — never stamped — so price corrections retroactively fix history. Unknown model or null tokens → cost omitted, UI shows "not recorded".

### 1d. New run kinds

`refine_selection`, `image_refine` added to the `run_kind` enum (`api/src/db/schema.ts:13`) and `shared/src/runs.ts` (`engineForKind`, `modelKeyForKind`). The canvas editor re-render involves no LLM → no run row; it is a synchronous endpoint producing an asset.

## Section 2 — Text slice

### 2a. Selection refine

**UX.** Selecting a range in the body textarea shows a small popup anchored top-right of the selection (selection pixel coords via the standard mirror-div measurement technique for textareas) containing a one-line instruction input.

**Flow.**
1. Submit → `POST /posts/:id/refine-selection { selectionStart, selectionEnd, instruction }` → 202 `{ runId }`. Run kind `refine_selection` through the normal runner (SSE, RunWatcher pickup). 409 if no body. Availability mirrors body editing: body exists AND status ≠ `measured` (wider than full-refine's `draft_ready` gate, which is unchanged).
2. Prompt: full current body with the selected span delimited by explicit markers, the user instruction, and the rule: *rewrite the selected span per the instruction; adapt text outside the span only where coherence requires it, minimally.* Output contract (zod, in `shared/src/outputs.ts`): `{ body_linkedin }` — the full revised body.
3. On run completion the popup becomes a **preview**: lightweight diff (word/segment level) of current vs proposed, with an explicit count/flag when changes fall outside the selected range ("also adjusted N spots elsewhere").
4. **Accept** → the existing `POST /posts/:id/body`, extended with optional `source` so the revision row is attributed `run:<id>` instead of `manual_edit`. Existing behavior preserved: revision insert + body + derived hook in one transaction, re-embed, 409 when `measured`. **Reject** → discard; nothing written.
5. This flow NEVER touches hashtags (unlike full refine).

If the user edits the body or navigates away while the run is in flight, the preview still opens against the then-current body; the diff makes any drift visible. Accept always writes the proposed body verbatim.

### 2b. Hashtag chip editor

The read-only `<Pill>` chips (`web/src/pages/Workspace.tsx:167-169`) become an editor: × to remove, click to edit in place, trailing input to add. Normalization: ensure single leading `#`, strip whitespace, dedupe case-insensitively, drop empties. Saves via existing `PATCH /posts/:id { hashtags }` (`PatchMetaSchema` already accepts it; `usePatchPost` already exists).

**Documented, kept as-is:** a *full* refine still regenerates hashtags wholesale (`drafting.service.ts:52-56`) — it is a redraft by design; the editor makes post-hoc adjustment trivial.

## Section 3 — Images slice

### 3a. List: ordering, pagination, filters, dates

- `GET /images/posts/:postId` gains `limit` (default 12), `offset`, `sort=newest|oldest` (default `newest` = `desc createdAt, desc id`), `origin=<enum|all>`; returns `{ items, total }`. Existing callers updated to the new envelope.
- ImagePanel toolbar: sort toggle + origin filter chips (reuse the app's rounded-chip pattern), pager footer (prev/next + "page X of Y"). Filter/sort/page live in the react-query key.
- Card additions: small faint created date at the card bottom (existing `fmtDateTime`, normalized, e.g. "aug 8, 14:32"); origin badge on non-`generated` assets ("refined from #41" / "edited from #41").
- Cache invalidation stays on `RunWatcherProvider` (`['images', postId]` prefix invalidation covers all filter variants).

### 3b. Breakdown (prompt + conversation)

Per-card "breakdown" button → dropdown with two options (page-local dropdown; no global primitive exists — promote later if a third consumer appears):

- **prompt** → modal showing `assets.generationPrompt` — the *augmented* brief (brief + that candidate's variation direction), which is exactly the per-candidate variated prompt the batch fan-out produced.
- **conversation** → modal walking the linked run's `run_steps` in order: variate/plan JSON → actual gpt-image-2 background prompt → HTML step; each with model, duration, tokens, collapsible prompt/output (`elideDataUris` for safety).

Assets with no `runId` or runs with no steps (pre-migration): modal renders an honest "not recorded for this image" (pre-migration generation).

### 3c. Background refine

- Card "refine" button → modal: image preview + instruction textarea.
- `POST /images/assets/:assetId/refine { instruction }` → 202 `{ runId }`, kind `image_refine`, via `executeManaged` (steps recorded). 422 if the asset has no readable sibling `bg.png`.
- Pipeline: attach source `bg.png` using the proven attached form `-i=<path>` (`codex.engine.ts` — the variadic form swallows the prompt) with a patch prompt: *edit the attached image; apply ONLY the requested changes; keep composition, palette, and everything else identical.* Write new `bg.png` into a NEW candidate group dir → substitute into the SOURCE asset's `htmlSource` → render → `images.create` with `lane: 'hybrid'`, `origin: 'bg_refined'`, `sourceAssetId`, `runId`.
- The new asset keeps its own `bg.png`, so it remains reference-eligible.
- **Recorded decision:** the "attached reference kills batch diversity" rule (eye-tests 2026-07-19/22) is scoped to *batch generation*; a deliberate single-candidate refine is exempt. This is an intentional, documented exception — not an accident.

### 3d. Canvas editor

- Card "edit" button (hybrid assets with `htmlSource`) → full-screen editor overlay:
  - Sandboxed iframe rendering `htmlSource` with the real bg substituted (data URI, same substitution as the render pipeline).
  - Injected editor script: click to select an element (highlight outline); drag to reposition — on first drag the element is converted to `position:absolute` at its current computed coordinates (freezing it out of the LLM's arbitrary flex/grid flow; siblings may reflow — accepted and documented); double-click for inline `contentEditable` text editing; toolbar for font size, color, weight, alignment; resize handles on the selection that set explicit inline `width`/`height` (text scaling stays on the font-size control, not the handles).
  - All edits land as inline styles / text mutations on the live DOM.
- **Save** → serialize the DOM back to HTML (with the bg data-URI reverted to the `__HYBRID_BG__` token) → `POST /images/assets/:assetId/edit { htmlSource }` → server substitutes bg + renders synchronously → new asset (`origin: 'canvas_edited'`, `sourceAssetId`, `runId: null`). Copies the source's `bg.png` into the new group dir (keeps reference eligibility and future refine-ability). **Cancel** discards everything.
- The dead `useGenerateHtml` / `useGenerateRaster` hooks (`web/src/api/hooks.ts:179-184`) are deleted as part of this slice.

## Section 4 — History slice

### 4a. Run detail view

- Workspace history tab (`Workspace.tsx:208-248`): run rows become clickable → detail modal (reuse the app's overlay pattern):
  - Total duration (existing `durationS`), engine, model, status + `failureKind`.
  - **Steps**: `run_steps` list — per-step kind, model, duration, tokens; step count is the "agents spawned" number.
  - **Tokens**: input/output totals (run row), per-step where present.
  - **Estimated cost (USD)**: computed at read time = tokens × settings pricing map; gpt-image-2 steps = `imagesGenerated × imagePerUnit`. Null tokens / unknown model → "not recorded".
- Pre-migration runs: duration renders (derivable), tokens/steps/cost show "not recorded".

### 4b. API + RunsLog

- `GET /runs/:id` grows `steps: RunStepDto[]` and `costUsd: number | null`. The list endpoint stays lean (no steps).
- The same detail component replaces RunsLog's prompt/output-only expansion (`web/src/pages/RunsLog.tsx`), keeping the prompt/output panes inside it.
- Fix the drifted kind filter: derive `KINDS` from the shared `run_kind` enum instead of the hand-rolled list currently missing `image_plan`.

### 4c. Settings

Settings surface gains a **pricing** section: per-model token rates + per-image rate, editable, shipped with sensible defaults for the models in `shared/src/settings.ts` (`claude-opus-4-8`, `gpt-image-2`, etc.).

## Error handling

- Selection-refine run failure → popup shows the run error with retry; body untouched.
- Image refine partial failures follow the hybrid pipeline's existing failure semantics (run fails loud; no asset created).
- Canvas-edit render failure → synchronous 4xx/5xx with detail; no asset created.
- Usage parsing is fail-open: unparseable usage → null tokens, never a failed run.
- Pagination params are clamped server-side (limit ≤ 50, offset ≥ 0).

## Testing

Follow existing patterns (shared contract specs; api unit tests — currently 18 + 160 green).

- Shared: zod contracts for `refine_selection` output, new DTOs, pricing settings schema.
- API: usage-parsing fixtures for both engines (claude stream-json result line; codex token text), `executeManaged` step recording, refine-selection prompt assembly + accept path (`source` on body endpoint), pagination/sort/filter queries, refine + canvas-edit lineage (origin, sourceAssetId, runId, bg.png presence), cost computation incl. per-image pricing and null-token "not recorded" path.
- Web: browser smoke (loads, root renders, zero console errors) per QA gate for Workspace + ImagePanel.
- Manual/e2e verification of mutating flows uses a **sacrificial post** — never real content (standing rule).

## Implementation notes for planning

- Confirm current drizzle migration head before authoring the migration.
- Batch launch passes the augmented brief into `launchHybrid`; `runs.prompt` and `assets.generationPrompt` both carry it already — breakdown's "prompt" option needs no new persistence.
- All new async surfaces plug into `RunWatcherProvider` — it is the app's only cache-invalidation path.
- Slices land as three PRs: (A) foundation + text, or foundation separate if cleaner; (B) images; (C) history. Foundation must land first.
