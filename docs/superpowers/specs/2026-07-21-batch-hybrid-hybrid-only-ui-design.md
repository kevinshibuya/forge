# Batch hybrid generation + hybrid-only image UI

**Date:** 2026-07-21
**Lane:** Pipeline (spec → plan → pre-review → SDD build → eye-test → ff-merge)
**Branch target:** one feature branch off `main`

## Goal

Two changes shipped on one branch:

1. **Batch hybrid** — one click on "generate hybrid" produces **N** candidates (default from
   `settings.imageCandidateBatch`, per-click override 1–10) instead of 1. Combined with the
   already-shipped reference lever, this yields "N varied takes on the winner" per click.
2. **Hybrid-only UI** — remove the "generate html" and "generate raster" buttons from the image
   tab. Hybrid is the only lane used in practice. UI-only removal: the `POST /html`, `POST /raster`
   endpoints and both engines stay intact (fully reversible, zero backend risk).

## Design decisions (locked in brainstorm)

- **Fan-out depth: deep + parallel.** N independent full pipelines (plan → bg → text → composite
  each), launched in parallel. Every candidate differs in composition, typography AND background —
  each pipeline runs its own plan (claude) and text (claude) step. Rejected: shallow (one plan/text
  + N backgrounds — only bg varies, low diversity) and deep+sequential (one managed run looping —
  ~N× wall-clock latency).
- **Batch size source: per-run input.** Reuse the `batch` number input already in `ImagePanel`
  (default 4, clamp 1–10), move it next to "generate hybrid", pass it to `POST /hybrid` exactly as
  raster does. No-batch API calls fall back to `settings.imageCandidateBatch`.
- **Lane endpoints: keep API, remove buttons.** Delete only the html/raster buttons + their hook
  *calls* from `ImagePanel`. Leave routes, services, engines, and the hook definitions in place.
- **Grouping: none.** The gallery renders candidates flat; `candidateGroupId` has no visual effect
  today, so each pipeline keeps its own group id (no shared-group refactor). The N candidates simply
  appear together in the gallery.

## Architecture

The hybrid pipeline (`ImageComposeService.launchHybrid`) is **unchanged**. Batch is a thin fan-out
layer on top of it.

### Backend

**1. Shared request schema.** Introduce `BatchBriefSchema = z.object({ brief: z.string().min(1),
batch: z.number().int().min(1).max(10).optional() })` in `images.controller.ts` and use it for both
the raster and hybrid routes (replaces the current `RasterSchema`; `BriefSchema` stays for `/html`).

**2. `ImageComposeService.launchHybridBatch(postId, brief, batch?)`.**
- Resolve `n = Math.min(Math.max(batch ?? settings.imageCandidateBatch, 1), 10)` — identical clamp
  to `launchRaster`.
- Launch `n` independent `launchHybrid(postId, brief)` pipelines via `Promise.allSettled`. Each
  creates its own `candidateGroupId`, its own `candidateDir`, and its own managed run, so the N
  `bg.png` files never collide.
- `launchHybrid` resolves at its internal run-id race (fast, before the pipeline finishes) and its
  `finished` promise is already live and `.catch`-guarded — so `launchHybridBatch` returns quickly
  with the started run ids while the N pipelines run in the background (same async-202 pattern as
  raster). Keep each `finished` referenced (`void`) so the pipelines are not dropped.
- Collect the `runId`s from fulfilled results. If **zero** pipelines started (all rejected with the
  pre-run `ConflictException`), throw `ConflictException`. Otherwise return `{ runIds }`.
- **Partial success is expected and desirable:** if 1 pipeline fails mid-run, the other candidates
  still land. Each run fails independently per the existing per-run fail-loud semantics.

**3. Controller.** `POST /images/posts/:postId/hybrid` uses `BatchBriefSchema`, calls
`launchHybridBatch`, and returns `{ runIds: number[] }` (was `{ runId }`).

**4. Reference threading: unchanged.** Each `launchHybrid` resolves `refBg` itself, so all N
candidates in a batch share the post's reference image (attached to every bg call, plan clause in
every plan step).

**5. Concurrency.** No global run concurrency cap exists in `RunnerService` (verified), so N launches
run genuinely in parallel. Peak load is ≤ N (≤10) concurrent managed runs, each internally
sequential (plan → bg → text). Acceptable for a single-user tool.

### Frontend

**6. Client + hook.** Add `ImageBatchLaunchDto { runIds: number[] }` to `client.ts`. Change
`useGenerateHybrid` to post `{ brief, batch }` and return `ImageBatchLaunchDto`.

**7. `ImagePanel`.**
- Remove the "generate html" and "generate raster" buttons and their `genHtml`/`genRaster` hook
  *calls* (the hook definitions stay exported in `hooks.ts`).
- Move the existing `batch` number input next to "generate hybrid".
- On hybrid launch success: `res.runIds.forEach((id) => notifyLaunched(id, postId))`.
- Drop `genHtml`/`genRaster` from the `launching` / `err` aggregations; keep `hybrid`, `review`,
  `select`, `del`, `setReference`, `patchPost`.

**8. Run console: no change.** Each of the N managed runs registers and appears as its own progress
row automatically. `isPostBusy(postId)` stays true while any of the post's runs is live, preserving
the double-click guard until the whole batch finishes.

## Error handling

- **All pipelines fail at launch** (pre-run creation) → `launchHybridBatch` throws
  `ConflictException` → surfaced as the image-action error in the panel.
- **Some pipelines fail** → started `runIds` returned; failed runs show as failed in the console; the
  candidates that succeeded land in the gallery.
- **Invalid/missing reference** → each affected pipeline fails loud independently (existing behavior).

## Testing

**API — `app/api/test/hybrid.spec.ts`** (fake engines; `QueueClaude` repeats its last queued entry,
so single-entry queues serve N pipelines):
- `launchHybridBatch(post.id, brief, 3)` → 3 `lane:hybrid` candidates land; each 1200×1200.
- Clamp (service-level, calling `launchHybridBatch` directly — the HTTP schema separately rejects
  out-of-range with 400): `batch: 20` → `runIds.length === 10`; `batch: 0` → `runIds.length === 1`.
- No `batch` → uses `settings.imageCandidateBatch` (assert `runIds.length` equals the setting).
- Reference set → every bg call receives `images: [bgPathFor(ref)]` (assert across all N codex
  requests).

**API — `app/api/test/images-http.spec.ts`**:
- **Update** the existing `POST /hybrid` test (line ~107): response is now `{ runIds }` — assert
  `runIds` is an array of positive numbers of the expected length. The no-brief → 400 test is
  unchanged (`BatchBriefSchema` still requires `brief`).
- Add: `POST /hybrid` with `{ brief, batch: 3 }` → 202, `runIds.length === 3`, and 3 hybrid
  candidates eventually land (poll).

**Web:** `npm run typecheck -w web` + `npm run lint -w web` (one pre-existing accepted warning:
only-export-components in run-console.tsx). No web unit tests for the panel — behavior confirmed by
the live eye-test.

**Live eye-test (Kevin):** post 4 (has `reference_asset_id=16` set), enter a brief, batch = 4,
click "generate hybrid" → 4 varied candidates land, all reference-anchored, html/raster buttons gone.

## Verification suite

```bash
cd app && npm test                 # 15 shared + api (was 145; +new batch tests)
npm run typecheck                  # api
npm run typecheck -w web
npm run lint -w web
```

Known flakes under full-suite parallel load (green isolated = not a regression): playbook
activeRulesAt / analytics / drafting 409-guard.

## Out of scope

- No shared-group gallery UI (candidates render flat).
- No removal of html/raster endpoints, services, or engines.
- No change to the reference-image flow, review/scoring, or the hybrid pipeline internals.
