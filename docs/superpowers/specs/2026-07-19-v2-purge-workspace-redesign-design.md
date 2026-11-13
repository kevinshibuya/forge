# v2 purge + workspace redesign — design

**Date:** 2026-07-19
**Status:** approved by Kevin (brainstorm session, layout B chosen via visual companion)
**Baseline:** main @ 6180ffe (v1 hybrid restore merged; 132 api + 22 shared tests green)

Two goals, one branch: (1) fully remove the dormant v2 structured-brief machinery
that survived the v1 rollback, (2) redesign the post workspace page around tabs,
a global floating run console, and a simplified image panel.

## Context (what the scout inventory established)

The v1 restore changed the default hybrid generation path but left the entire v2
structured-brief subsystem wired end-to-end: `image_brief` run kind →
`ImageBriefService` → `posts.image_brief` jsonb → JSON editor in `ImagePanel` →
`briefToProse` override of the lanes' prose brief. `LocalizationSchema` and the
`assets.verification` producer are fully dead (nothing writes verification; the
web pill renders only nulls). Separately: the current T1 draft prompt emits only
`image_concept` — the `legacyBrief` fallback (`DraftOutputSchema.image_brief`) is
never populated for new drafts, so post-purge the lanes need a new prose-brief home.

## Part 1 — v2 purge (full, incl. DB)

Delete:

- **API:** `ImageBriefService` (`image-brief.service.ts`), `POST
  /images/posts/:postId/brief` (controller + wiring), `assembleBriefPrompt` in
  `hybrid-prompts.ts`, `PATCH /posts/:id/image-brief` + `ImageBriefBodySchema` in
  `posts.controller.ts`, `PostsService.setImageBrief`.
- **Shared (`images.ts`):** `HybridBriefElementSchema`, `HybridBriefSchema`,
  `BboxSchema`, `LocalizationSchema`, `VerificationCheckSchema`,
  `VerificationSchema`, `briefToProse`. **Keep** `HybridPlanSchema` (v1, live).
  Remove `image_brief` from `RunKindSchema` + its model-slot mapping in `runs.ts`.
- **Web:** structured-brief textarea/parse/save UI and verification pill in
  `ImagePanel.tsx`; `useGenerateBrief`, `usePatchImageBrief` in `hooks.ts`;
  `imageBrief` and `verification` fields in `client.ts` DTOs; the
  `parseImageBrief`/`legacyBrief` wiring in `Workspace.tsx` (its source field
  dies with the schema — ImagePanel's props become `postId`, `post`, and the
  draft's `image_concept` for prefill). Rename `useComposeHybrid` →
  `useGenerateHybrid` (carried follow-up).
- **DB (one migration):** drop `posts.image_brief`; drop `assets.verification`;
  `DELETE FROM runs WHERE kind = 'image_brief'` then recreate the `run_kind`
  enum without `image_brief` (Kevin approved deleting historic brief run rows).
- **Tests:** delete `app/api/test/image-brief.spec.ts`; remove the `hybrid brief
  v2 contracts` block from `app/shared/src/images.spec.ts`; update
  `schema.spec.ts` (columns/enum), `posts.spec.ts` (setImageBrief block).
- **Draft contract:** remove `image_brief` from `DraftOutputSchema` (prompt never
  asks for it). **Keep** `image_concept` (prompt asks for it on T1; it seeds the
  new prose brief and shows as a caption).

Invariant: hybrid, html, and raster lanes keep the exact v1 contract — they
accept one prose brief string. Nothing in the generation path changes.

## Part 2 — prose brief persistence

- New nullable text column `posts.image_prompt` (same migration as Part 1).
- Extend the existing posts PATCH body (`posts.controller.ts` /
  `PostsService.patchMeta`) with `imagePrompt?: string`.
- Image tab UI: one plain textarea. When `image_prompt` is null/empty, prefill
  the textarea client-side from the latest draft's `image_concept` (not
  auto-saved; saving is explicit). Save button persists it. The three generate
  buttons post the textarea's current prose.

## Part 3 — hook derived from body

- Remove the pick-a-hook block from `Workspace.tsx` (`parseHooks` too).
- `DraftOutputSchema.hooks` (exactly-3 array) removed; drafting prompt contract
  in `prompt-assembly.ts` stops asking for `"hooks"`; update
  `contracts.spec.ts` / fixtures that build draft outputs.
- `posts.hook` column stays. It becomes derived: on every body write
  (`updateBody` — draft finalize (`drafting.service.ts:54`), save revision, and
  restore all flow through it), set `hook` = first non-empty line of the body,
  trimmed. Since hook is now a substring of the body, `updateBody`'s embedding
  upsert switches to body-only text (the `[hook, body]` join would double-count
  the first line).
- `approve()` gate becomes body-only. Remove `hook` from the web PATCH usage
  (seed's `patchMeta({hook})` may stay; it's harmless and seeds real data).
- Display sites (dashboard, planner, posts index, analytics, retro) are
  untouched — they already read `post.hook`.

## Part 4 — workspace tabs (layout B)

- **Sticky header** (always visible): `#id`, tier badge, status pill, scheduled/
  published pills, analytics link + primary actions: draft/re-draft, approve,
  copy-to-clipboard. Action errors render just below the header.
- **Tab: write** — idea panel, degraded-retrieval banner, failed-run error note,
  body editor + save-revision button (gets a proper in-flight/disabled state),
  refine-with-feedback panel, mark-published panel (when approved).
- **Tab: image** — prose brief textarea + save; `image_concept` caption; three
  generate buttons (hybrid, html, raster + batch number input); **selected image
  rendered large** beside/above the candidate grid; candidate cards keep
  select/delete + review score.
- **Tab: history** — revisions list with restore, plus this post's run log
  (kind, status, started, duration). Needs `GET /runs?postId=N` support: add
  `postId` (and `status`) query filters to `runs-log.controller.ts` list
  endpoint (runs.post_id already exists, nullable).
- Default tab: write. Tab state is local (no routing requirement).

## Part 5 — global floating run console

- New component mounted in `AppShell` (`app/web/src/ui/shell.tsx`), so it
  renders on every page.
- **Discovery: server-global.** Poll `GET /runs?status=running` — ~2s interval
  while ≥1 run is live or a run was just launched, relaxed (~10s) when idle.
  Runs appear regardless of which screen launched them; survives refresh.
- **Collapsed:** bottom-right fixed pill — spinner + `<kind> · run #N` (count
  badge when >1). Hidden entirely when idle and nothing recent to report.
- **Expanded (click):** fixed panel (~420px) listing live runs; each shows kind,
  post link, and the live SSE stream (`useRunStream`). Collapse button.
- **Completion:** when a watched run reaches terminal status, invalidate
  `['post', postId]`, `['posts']`, `['runs']`, `['images', postId]`. Pill shows
  a transient success flash or a persistent failure state (failure detail +
  dismiss in the expanded panel).
- **Replaces** `RunProgress` (Workspace) and `Console` (ImagePanel). Launch
  mutations stay in their pages; on 202 they hand the runId to the watcher
  (context) so polling tightens immediately.
- **Busy-state rework:** ImagePanel's `busy` (and Workspace's draft/refine
  disable) derive from the watcher: busy when a run for this post is pending or
  running — i.e. the launch mutation is in flight or the watcher sees a running
  run for this post — preserving the double-click guard.
  The degraded flag from the draft 202 response stays page-local.

## Part 6 — image lightbox

- Clicking a candidate thumbnail or the selected-image preview opens a fixed
  overlay: full-size image, dark scrim, esc / click-outside / close button to
  dismiss, select + delete actions inside. Plain React state — no new deps.

## Error handling

- Existing per-mutation error surfacing stays (ErrorNote near the triggering
  control, now within the owning tab).
- Run failures surface in the floating console (not only on the page that
  launched them); the write tab keeps the failed-draft detail note.
- Migration is destructive by design (drops columns, deletes brief run rows) —
  runs once via the standard migrate script against the local DB.

## Testing

- API: update schema tests (columns gone, enum value gone, `image_prompt`
  present), posts tests (patchMeta imagePrompt, hook derivation on
  updateBody/restore, body-only approve), runs list filter tests
  (`postId`/`status`), drafting finalize sets derived hook.
- Shared: contracts tests for the slimmed `DraftOutputSchema`; images tests keep
  only v1 `HybridPlanSchema` coverage.
- Web: typecheck + oxlint. No unit-test infra for components (unchanged policy).
- End: full suite green + a real-browser smoke of the redesigned workspace
  (tabs render, generate flow launches, floating console appears, lightbox
  opens, zero console errors) — the page rewire makes static checks blind to
  runtime breakage.

## Out of scope

- Batch hybrid candidates, gpt-image-2 reference images, `assemblePlanPrompt`
  changes (all need live A/B evidence per the structure-kills-taste lesson).
- Embeddings backfill for non-post#1 content.
- Routing-level tab URLs, mobile layout.
