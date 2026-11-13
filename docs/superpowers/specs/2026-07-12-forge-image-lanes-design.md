# forge Plan 3 — image lanes (design)

**Date:** 2026-07-12 · **Status:** shipped; its hybrid lane is superseded by `2026-07-12-forge-hybrid-orchestration-design.md` · **Extends:** `2026-07-11-forge-content-system-design.md` (this is system-spec phase 6, "Images")

## Purpose

Implement the three image-candidate lanes and the Workspace image panel, replacing the Task 16 placeholder. Turns the `image_brief` a T1 draft already produces into rendered 1200×1200 candidates Kevin can review, pick, and attach to a post — three lanes side by side (HTML, raster, hybrid). Consolidation into one smarter workflow stays deferred until usage data shows which lanes earn their keep (a retro concern, not a launch concern).

## Already provisioned (consumed, not built)

- **`assets` table** — full shape exists from Plan 1, so **Plan 3 needs no DB migration** for the image feature. Columns: `postId`, `lane` (`html|raster|hybrid`), `htmlSource`, `generationPrompt`, `pngPath`, `width`, `height`, `candidateGroupId`, `isSelected`, `reviewScore`, `reviewNotes`, `createdAt`.
- **`CodexEngine`** — `codex exec --sandbox workspace-write`, `OPENAI_API_KEY` stripped from the child (billing invariant → ChatGPT/Codex subscription, never the metered API), `failureKind:'quota'` taxonomy already built. Untouched by this plan.
- **`designLanguageDoc`** in settings (seeded) — injected into `image_html` prompts.
- **`image_brief: z.string().optional()`** in `DraftOutputSchema` (`app/shared/src/outputs.ts`) — T1 drafts produce it; the lanes' starting brief.
- **Async run pattern** from `DraftingService`: `202 + runId + SSE + finished`; `RunnerService.execute({ kind, schema, onStart })`; `useRunStream` on the web side.
- **`visual`** playbook-rule category (DB enum + `RuleCategorySchema`) — the rubric for `image_review`.

## Decisions locked (brainstorm 2026-07-12)

| Question | Decision |
|---|---|
| Lane scope | **All three** (HTML, raster, hybrid) |
| Hybrid orchestration | **"Compose over this" action on a chosen raster candidate** — reuses the raster lane wholesale; the compose step is one `image_html` run given that raster as background. No standalone hybrid generator. |
| image_review | **Manual "score these" button; one comparative run over the current grid**; read-only file access (the sole tools-disabled exception). Selection never requires it. |
| Iteration | **Editable brief** (prefilled from the draft, blank when none) + regenerate; raster **batch control 1–10** (default 4, per the pre-existing `imageCandidateBatch` setting); view/copy HTML, **no inline HTML editor**. |
| Hardening scope | **Images + only the item Plan 3 creates**: a config-driven assets root so test file-writes go to a temp dir (render tests would otherwise add to the `app/api/uploads/` pollution). Rest of the carry-list deferred to a separate hardening plan. |

## Architecture

A new **`images` NestJS module** finally *owns the `assets` table* (no module has until now) and exposes candidate generate / list / select / delete / review + PNG serving. Two supporting pieces:

- **RenderService** — an injectable HTML→PNG renderer (Playwright/Chromium). Defined as an interface with a **fake for tests**, mirroring the existing `Engine` / `fake.engine` pattern. Lazy singleton browser, a fresh context/page per render, graceful close on module destroy. Local Chromium (`npx playwright install chromium`) — single-user, local-only, no Docker render container.
- **Assets-root config** — one configurable base dir for generated files (`ASSETS_ROOT`, default `uploads/assets`). Tests point it at a temp dir. The PNG-serving endpoint resolves `pngPath` **only within allowed roots** (the assets root + the repo `post-assets/` seed dir), rejecting path escapes.

## The three lanes (data flow)

**HTML lane** — `lane:html`, `image_html` run.
Claude ← (editable) image_brief + `designLanguageDoc` + dimensions → `{ html }` (JSON-schema validated) → RenderService → 1200×1200 PNG → asset row (`htmlSource` set). One candidate per run; regenerate for more.

**Raster lane** — `lane:raster`, `image_gen` run (codex).
`codex exec` runs with `cwd` = the run's target dir (its `workspace-write` sandbox), instructed to write a batch of N (1–10, default 4) PNGs there → app **scans that dir and ingests each readable PNG** into an asset row (`generationPrompt` set, `candidateGroupId` = the batch). This lane **breaks the JSON-output contract**: success = "≥1 readable PNG ingested," not parsed JSON (a codex run with no readable files = failed run). CodexEngine unchanged — the `cwd` mechanism already exists in `EngineRequest`. Quota exhaustion → `failureKind:'quota'` → "plan limit reached — retry after window resets."

**Hybrid lane** — `lane:hybrid`, `image_html` run in hybrid mode.
A "compose over this" action on a raster candidate Kevin has selected: Claude ← brief + `designLanguageDoc` + the chosen raster **inlined as a base64 data-URI background** → `{ html }` compositing typography/pills/labels over it → RenderService → PNG → asset row (`htmlSource` = the composed HTML with the raster inlined; `generationPrompt` = the compose brief). Lineage to the source raster is implicit in the inlined image — **no new FK column, so no migration**. Inlining also keeps the composed `htmlSource` self-contained — no local-file resolution at render time.

## image_review (the tools-disabled exception)

Today every Claude run passes **no** `--allowedTools`; the safety model is "headless denies mutating tools + prompts never ask for tools." image_review is the single explicit exception:

- **Interface change:** add `allowedTools?: string[]` to `EngineRequest`. `ClaudeEngine.command` passes `--allowedTools <list>` only when present; every existing run leaves it undefined → behavior unchanged. image_review sets `['Read']`; candidate PNGs are referenced by absolute path.
- **Prompt/output:** the candidate PNG paths + active `visual` rules + a 0–100 scoring rubric → `{ scores: [{ assetId, score, notes }] }` (shared `ImageReviewOutput` schema). App writes `reviewScore`/`reviewNotes` per asset, scoped by `(assetId, postId)` and filtered to the reviewed candidate set (a model-invented id can't touch another post). Malformed → `parsed_ok=false`, raw view + re-run (standard).
- **Manual, whole-grid comparative:** one run over the current grid; comparative judgment reads better than isolated scores; re-clicking re-scores (overwrites) — acceptable because it is a manual action.
- **Security surface:** this is a headless Claude with the Read tool enabled. **Important:** `--allowedTools Read` gates the tool *type*, not the filesystem — it is NOT a read jail (cwd does not confine which paths Read may open). The residual risk is accepted because the entire prompt is app-generated on a local single-user machine (no user-controlled paths to steer Read elsewhere); the tools-disabled invariant holds for every other run. Gets the **security-lens review** at the plan gate, and a **real-CLI spike** confirming `claude -p --allowedTools Read --output-format stream-json` actually sees a PNG and returns scored JSON — the spike must document actual behavior and must NOT conclude cwd sandboxes reads.

## Rendering model

Render **network-on but gated**: load the HTML, `await document.fonts.ready` + a networkidle wait, then screenshot — and **fail the render if fonts don't load** within timeout (turns a silent fallback-font quality bug into a visible, re-runnable failure). The HTML lane keeps its Google-Fonts `<link>` (self-contained, copy-pasteable, matches the proven post #1 exactly). Hybrid inlines its raster as a data URI (above). Every stored `htmlSource` stays portable and re-renderable.

## Workspace image panel (replaces the Task 16 placeholder)

Lane launchers (each with an editable brief; raster adds a batch-size control). A candidate grid of served-PNG cards: lane badge, review score/notes when present, and a **select radio** (one `isSelected` per post, set **transactionally** — clear others + set one in a single tx). A "score these" button (image_review). The reused **SSE run console** for the active image run (codex streams coarsely, start→finish — acceptable). Regenerate appends a new candidate group; delete removes a candidate (row + file); deleting the selected one just leaves the post imageless. The brief field prefills from the draft's `image_brief` when present, else starts blank (non-T1 or brief-less posts). No publish-gating on images — an image stays optional, per the system spec.

## Runner integration

- `image_html` / `image_review` reuse `RunnerService.execute` with JSON schemas in the shared package: `ImageHtmlOutput = { html: string }`, `ImageReviewOutput = { scores: { assetId, score, notes }[] }`.
- All lanes pass a `finalize` callback to `execute` so render/ingest/scoring run INSIDE the run lifecycle — before `runs.succeed()` and the SSE stream closes. This makes an SSE `done` mean "candidates ready" (the panel has no convergence poll) and makes render/ingest/score failures fail the run instead of falsely succeeding.
- `image_gen` runs **schemaless** (validated by file ingestion + PNG header check in `finalize`, not JSON) — `RunnerService.execute` already supports the schemaless path.
- All three persist to `runs` (kinds `image_html|image_gen|image_review` already in the enum). SSE via the existing hub.

## Error handling

Render failure → the `image_html` run fails with its HTML preserved in the run output (re-runnable); **no orphan asset rows** (rows = successful candidates only). Codex quota → the distinct "plan limit" surface. image_review malformed → quarantine + re-run. All consistent with the system-spec error taxonomy.

## Testing

- **Unit:** RenderService (real Chromium, minimal — assert 1200×1200 + valid PNG header, **never byte-equality**; serialized with the other api tests), codex-output ingestion (fixture PNG dir), image_review output parsing, selection exclusivity (transactional), path-escape rejection in the serve endpoint.
- **Integration:** generate per lane with a **fake RenderService + fake engines** → asset rows; select → exclusivity; serve endpoint → bytes.
- **Hardening (folded):** assets root is config-driven; every test file-write targets a temp dir.
- **Real-CLI gates** (Codex/Claude headroom permitting): one live `image_gen`, one real render, one `Read`-enabled `image_review`.

## Phasing (bottom-up, matches system-spec phase 6)

1. **RenderService** + assets-root config + PNG-serving endpoint (config-driven, temp-dir tests) — standalone, no engines.
2. **`images` module**: candidate list / select (transactional exclusivity) / delete, asset-row CRUD.
3. **HTML lane** (`image_html` → render → candidate) — fully testable today, no codex dependency.
4. **Raster lane** — *first task is a codex spike* pinning the exact `codex exec` gpt-image-2 invocation + output contract (where/how files land, batch behavior, format), then the ingestion pipeline.
5. **Hybrid** compose-over-raster action (data-URI background).
6. **image_review** — *first the `claude -p --allowedTools Read` PNG spike*, then the `EngineRequest.allowedTools` extension + the run + scoring.
7. **Workspace image panel UI** (lane launchers, candidate grid, score button, select, SSE console).

## Spikes / verification (unknowns pinned before building on them)

- **Codex gpt-image-2 invocation** (post-cutoff, native since 2026-04): exact `codex exec` form + output shape — Phase 4, task 1.
- **Claude Read-a-PNG in headless** (`-p --allowedTools Read --output-format stream-json`): confirm it sees the image and returns JSON — Phase 6, task 1.
- **Playwright chromium setup** documented as an explicit step (Plan 1 toolchain-surprise lesson).

## Out of scope

- Auto-consolidation of the three lanes into one workflow (deferred to usage data).
- Inline HTML editor; a Claude "brief→raster-prompt" translation step (raster uses the brief directly, editable); publish-gating on images.
- Deferred hardening carry-list: provenance unique index, promote-race compensation, analytics `?postId=` UI override, sentinel error class for runs-log 404, seed lifecycle — a separate hardening plan.

## Technical calls (veto-able; refined after code analysis)

1. **Rendering:** network-on gated on `document.fonts.ready` + fail-if-fonts-missing; Google-Fonts `<link>` kept; hybrid raster inlined as a data URI. *(Revised from the original "self-host font + network off" — chosen for `htmlSource` portability and to cleanly resolve the font/background interaction.)*
2. **PNG serving:** a streaming `GET /api/images/:id/file` resolving `pngPath` within allowed roots.
3. **image_review:** `EngineRequest.allowedTools` extension; `['Read']` only (tool-type gate, NOT a filesystem sandbox); absolute candidate paths; post-scoped/filtered score writes; security-lens review + spike.
4. **Score scale:** integer 0–100.
5. **Playwright:** local Chromium, no Docker render container.
6. **Codex image-gen invocation:** confirmed against the real CLI (Phase 4 spike), not assumed.
