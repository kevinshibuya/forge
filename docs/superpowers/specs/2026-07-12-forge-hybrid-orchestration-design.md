# Forge — Orchestrated Hybrid Lane (plan-first) — Design

**Date:** 2026-07-12
**Supersedes:** the hybrid-lane decision in `2026-07-12-forge-image-lanes-design.md` (which deferred a standalone hybrid generator in favor of a "compose over a chosen raster candidate" action). This spec un-defers and replaces that decision. HTML lane, raster lane, review, and the image panel are unchanged.

## Context / Why

Plan 3 shipped hybrid as a "compose over this" action on a user-picked raster candidate, inlining the raster as a data URI in the `image_html` prompt. Live verification (2026-07-12) proved this is **fundamentally broken**: a 1200×1200 PNG is ~1.4 MB → ~1.9 MB base64 ≈ ~480K tokens embedded directly in the prompt, which exceeds claude's input context — `claude -p` exits 1, zero candidates produced (run 12: `failed / nonzero_exit`). Control: the HTML lane, same engine, ~16K-char prompt, succeeds. So the defect is the embedded background, not the engine.

Two orthogonal problems must be solved: (1) the multi-MB base64 must never sit in an LLM prompt/output; (2) for a hybrid to look intentional, the background must be generated to *host* text (legible zone, contrast). We adopt the originally-deferred richer design that solves both: a **plan-first orchestrated generator**.

## Goal

`POST /api/images/posts/:postId/hybrid { brief }` produces one `lane:hybrid` 1200×1200 candidate — an on-brand background generated to host text, with legible typography composited on top — coordinated by an up-front composition plan. No user-supplied source asset.

## Locked decisions

| Decision | Choice |
|---|---|
| Orchestration | **Plan-first**: claude plans → codex generates background → claude renders text → app composites |
| Coordination | The plan defines a `textZone`; the background prompt keeps that zone calm/high-contrast; the text HTML places copy in that same zone |
| Compositing | Background reaches the render as a **data URI substituted at render time** (placeholder token `__HYBRID_BG__` in the HTML), never in any LLM prompt/output |
| Stored `htmlSource` | Placeholder form only; the background persists as a sibling `bg.png` in the candidate group dir (a future re-render reads the sibling) — NOT the inlined base64. No new asset column. |
| Background visibility | **Internal intermediate** (a file the hybrid references), not a separate user-facing raster candidate |
| Candidates per run | **One** hybrid candidate (batching deferred) |
| API | `/hybrid` takes `{ brief }` only; `sourceAssetId` removed from `HybridSchema` |
| Billing invariant | Background gen uses codex's built-in `image_gen` tool (ChatGPT subscription); `OPENAI_API_KEY` stays stripped from the codex child (`codex.engine.ts` line 26) — unchanged |

## Flow

`POST /hybrid { brief }` → `ImageComposeService.launchHybrid(postId, brief)` orchestrates, inside one run lifecycle:

1. **Plan** — new `image_plan` run (claude). Prompt = `brief` + `settings.designLanguageDoc`, asking for a fenced JSON composition plan:
   `{ backgroundPrompt: string, headline: string, subtext?: string, textZone: "lower-third"|"upper-third"|"left-half"|"right-half"|"center", palette: string }`.
   The plan is short strings only (no HTML/base64), so claude→JSON is safe here — the *small* structured-output case, not the large-HTML case that broke Plan 3's original `image_html` JSON contract — and it follows the existing `draft`/`triage` claude→JSON precedent. Validated with a zod schema; a malformed/absent plan fails the run.
2. **Background** — codex, the existing raster generation path (batch 1). Prompt derived from `plan.backgroundPrompt`, augmented to keep `plan.textZone` calm/high-contrast and no text. One 1200×1200 PNG written to the candidate group dir as an intermediate (`bg.png`).
3. **Text** — claude, the existing `image_html` path. Prompt = `settings.designLanguageDoc` + the plan (`headline`/`subtext`/`textZone`/`palette`) + an instruction to set the full-bleed CSS background to the **literal token `__HYBRID_BG__`** and compose typography in `textZone`. **The HTML must place a subtle scrim/gradient behind the copy** (a semi-opaque panel or gradient within `textZone`) so text stays legible even if the generated background isn't perfectly calm there — legibility can't depend solely on the image model honoring the calm-zone request. Returns a fenced HTML document (~16K chars, like the HTML lane).
4. **Composite** — `extractHtml(output)` → replace `__HYBRID_BG__` with `data:image/png;base64,<bg.png bytes>` → Playwright render (network-gated on `document.fonts.ready`, fail-if-fonts-missing) → 1200×1200 PNG → ingest one `lane:hybrid` asset (`htmlSource` = placeholder form; `generationPrompt` = `brief`).

**Run & progress model:** `/hybrid` returns a **single `runId`** and the panel watches **one SSE stream**, as today. The POST must return the `runId` **immediately** — the ~2–4-minute orchestration (background gen alone is ~105s) runs in the run's background lifecycle, never blocking the HTTP request. Internally it makes three engine calls (plan → claude, background → codex, text → claude) plus the composite. Modeling is left to the implementation plan, but it must honor these constraints:

- **New run-kind + migration.** The hybrid needs at least one new `runKind` value (e.g. `image_hybrid`; plus `image_plan` if the plan step is its own tracked run). `runKind` is a Postgres pgEnum, so this requires a **generated Drizzle migration** (`db:generate` → `db:migrate` via `src/db/migrate.ts`). Note `ALTER TYPE run_kind ADD VALUE` cannot add *and use* a value in the same transaction — verify the migration applies against a real DB (the test suite runs migrations on boot, so green tests confirm it).
- **Fake-engine distinguishability.** `FakeEngine` keys its canned output on `req.kind`, so the three engine calls must have distinguishable kinds — otherwise the orchestration test can't stub plan/background/text independently.
- **Atomicity.** A failure at any step fails the one hybrid run and lands no partial candidate.

## Components

- **New:** new `runKind` enum value(s) for the hybrid run + plan step (shared contract enum **+ a generated Drizzle migration for the `run_kind` pgEnum** — see the run-model note) + planning prompt-assembly + zod plan schema + JSON extractor (fenced block, mirroring `extractHtml`'s robustness).
- **New:** `substituteBackground(html, dataUri)` helper — replaces `__HYBRID_BG__`; throws if the token is absent (fails the run rather than rendering a background-less image).
- **Reuse:** codex background generation (as an internal step, not a user candidate); the Playwright renderer; the atomic write-then-cleanup `finalize` pattern.
- **Modified:** `ImageComposeService.launchHybrid` → the 4-step orchestration. Extend `assembleImageHtmlPrompt` with an optional `backgroundToken` param: when present it instructs the model to set the full-bleed background to that literal token; the plain HTML lane calls it without the param, so its output is unchanged.
- **Removed:** `sourceAssetId` from `HybridSchema` and the controller; the old data-URI-in-prompt path.

## Error handling / atomicity

Each step fails the run with a clear `failure_kind` and lands no partial candidate: invalid plan JSON, background produced no readable PNG, text output has no HTML document, or `__HYBRID_BG__` missing after generation. The intermediate `bg.png` is removed on any downstream failure (extend the existing PNG write-then-unlink guard). The SSE stream closes only once the candidate row exists (unchanged panel refetch behavior).

## Testing / verification

- **Unit:** plan prompt assembly; plan zod schema (accepts a valid plan, rejects malformed); `substituteBackground` (present token → replaced; missing token → throws).
- **Fake-engine:** full orchestration with stubbed plan + background + html → asserts one `lane:hybrid` row + PNG of the right size, and that the prompt handed to the text step contains `__HYBRID_BG__` and **no** `data:image` payload.
- **Live (completion gate):** a real `POST /hybrid { brief }` → visually confirm a composited candidate with legible text on an on-brand background; confirm the text-step run's prompt length is ~16K (not ~1.9M) — i.e. no base64 in any prompt.
- **Regression:** full `npm test` green (shared + api), web typecheck + lint clean, fresh-context opus review of the delta before merge.

## Non-goals (v1)

Batching multiple hybrid candidates; letting the user hand-pick or reuse an existing raster as the background; vision-adaptive text placement; per-lane briefs; editing the plan before generation. All deferred until usage justifies them.
