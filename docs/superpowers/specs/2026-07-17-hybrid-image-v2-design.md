# Hybrid image pipeline v2 — structured brief, localized text, quality gate

**Date:** 2026-07-17
**Status:** rolled back. It shipped on `feat/hybrid-image-v2`, was reverted to v1 after three live eye-tests, and its code and schema were purged (ADR 0010, commit `ede28db`). Kept as the record of what was tried.

## Problem

The current pipeline loses brief content structurally, not accidentally:

1. The `image_brief` is a prose paragraph produced as a side-effect of every draft/refine
   run, with one sentence of guidance in the T1 tier spec and no knowledge of which image
   lane consumes it. It churns on every refine and mixes HTML-lane vocabulary
   (`rgba(...)`, font stacks, exact hex) into text a raster model cannot honor.
2. The hybrid lane compresses that paragraph into `{ backgroundPrompt, headline, subtext,
   textZone, palette }`. All in-diagram text (labels inside shapes) dies there: the
   background step forbids text ("NO text, letters, numbers") and the overlay renders only
   headline/subtext. Observed result: empty speech bubble, textless status pills, invented
   brick walls, a literal divider line, an arrow in the wrong place.
3. Nothing compares the rendered PNG to the brief before the user sees it. The existing
   `image_review` run scores candidates against visual playbook rules only.

## Goals

- Raster model owns **all illustration** (shapes: bubbles, chips, gates, arrows — textless).
- HTML overlay owns **all text**, absolutely positioned inside the raster shapes it labels.
- A vision quality gate validates the composite against the brief before the candidate is
  surfaced; bounded auto-repair; failures surface **flagged**, never silently shown or
  silently discarded.

## Architecture overview

```
draft/refine ──▶ image_concept (1–2 sentences, cheap, churns freely)

[panel: "generate brief"]
POST /api/posts/:id/image-brief ──▶ art-director run ──▶ structured brief (stored on post,
                                                          editable in panel, zod-validated)

[panel: "generate image" (hybrid)] — one managed run:
  1. assemble bg prompt   (background mood + ALL element shapes, labels stripped)
  2. codex → bg.png       (raster illustration, textless)
  3. normalize            (renderer: bg-only HTML, cover, 1200×1200 → bg-norm.png; no LLM)
  4. localize             (claude vision reads bg-norm.png → per-element {found, bbox})
        └─ labeled element missing → regenerate bg ONCE with corrective feedback → step 3
  5. text                 (claude writes HTML: __HYBRID_BG__ full-bleed + headline/subtext
                           in textZone + each label absolutely positioned in its bbox)
  6. composite + render   (existing substituteBackground path, unchanged)
  7. verify (gate)        (claude vision reads final PNG vs checklist from brief)
        ├─ label misplaced → re-render text with verify's corrected bboxes (≤2)
        ├─ bg-level failure → bg regen if the single regen budget is unspent → step 3
        └─ still failing → candidate lands FLAGGED with unmet checks visible in panel
```

## 1. Brief contract

### Draft/refine change

`TIER_SPECS.T1` stops requesting the paragraph `image_brief`; instead requests
`image_concept`: 1–2 sentences naming the core inversion/idea to visualize. Shared output
schema renames accordingly (keep `image_brief` parsing as a legacy fallback for existing
drafts).

### Art-director step (new run kind `image_brief`)

Input: final `bodyLinkedin` + `image_concept` + design-language doc (+ legacy prose
`image_brief` as seed context when present). Output (shared `HybridBriefSchema`):

```json
{
  "concept": "a request drifts, a gate holds",
  "background": "textless mood/texture description for the raster model",
  "palette": "dark ink #111822, cream, blue-400, periwinkle #5078B8",
  "headline": "≤ 8 words",
  "subtext": "optional, ≤ 16 words",
  "textZone": "lower-third | upper-third | left-half | right-half | center",
  "elements": [
    { "id": "bubble",    "description": "speech bubble, translucent outline, floating unanchored, three faint echoes behind it", "label": "done", "zone": "upper-left" },
    { "id": "gate",      "description": "solid rectangular gate block, hard-edged",  "label": null,   "zone": "right" },
    { "id": "chip-pass", "description": "small status pill on the gate, bottom row", "label": "PASS", "zone": "right" },
    { "id": "chip-fail", "description": "small status pill on the gate, bottom row", "label": "FAIL", "zone": "right" },
    { "id": "chip-skip", "description": "small status pill on the gate, bottom row", "label": "SKIP", "zone": "right" }
  ]
}
```

Rules:
- **At most one label per element.** Multi-word labels are fine ("done"); multiple
  *positioned* texts require multiple elements (see chips).
- Element descriptions are raster-vocabulary only: shapes, weight, mood, spatial zone.
  No CSS colors-with-alpha, no font names — style tokens live in the design-language doc
  and apply at the HTML layer.
- `zone` is a rough placement hint for bg composition; exact position comes from
  localization later.
- An element **with a label is critical**; unlabeled elements are decorative.

Storage: JSON column `imageBrief` on `posts` (one active brief per post; regenerating
overwrites). Asset provenance keeps using `generationPrompt` (the serialized brief).

## 2. Hybrid run steps (managed run `image_hybrid`, extended)

### Step 1 — bg prompt assembly (code, no LLM)

From the brief: background description + palette + every element's `description`+`zone`
(labels stripped) + hardened invariants:
- no text, letters, numbers, logos (existing)
- **no divider lines, borders, or panel splits** — composition reads as one continuous canvas
- interiors of shapes that will carry text stay **empty and calm**
- keep `textZone` visually calm and high-contrast (existing)

### Step 2 — background (codex → bg.png, unchanged mechanics)

### Step 3 — normalization (renderer, no LLM)

gpt-image-2 output size is not guaranteed 1200×1200, and CSS `cover` scales/crops it —
bboxes measured on raw bg.png would be systematically offset on the final canvas.
Render a trivial bg-only HTML page (full-bleed cover, 1200×1200) through the existing
renderer → `bg-norm.png`. **Localization space now equals final canvas space by
construction.** The text step's background CSS is identical, so coordinates line up 1:1.

### Step 4 — localization (claude vision, `Read` on bg-norm.png only)

Output (`LocalizationSchema`): `{ elements: [{ id, found, bbox: {x,y,w,h} | null }] }`,
pixel coordinates in the 1200×1200 canvas space, one entry per brief element, ids must
match the brief exactly (same every-element-exactly-once validation pattern as
`image_review`).

- Any **critical** (labeled) element `found:false` → regenerate bg once with corrective
  feedback appended to the bg prompt ("the previous attempt lacked X / added a divider —
  do not …"), then re-normalize and re-localize. Budget: **1 bg regen per run, total**
  (shared with step 7).
- Decorative element missing → recorded, becomes a verification warning, not fatal.

### Step 5 — text (claude → HTML)

Extends `assembleImageHtmlPrompt`: `__HYBRID_BG__` full-bleed (existing) + headline/subtext
in `textZone` with scrim (existing) + a **positioned-labels block**: for each labeled
element, its bbox as data, instruction to absolutely position the label centered within
that box, styled from the design-language doc. No JSON in output — same fenced-HTML
contract as today.

### Step 6 — composite + render (existing `substituteBackground` path, unchanged)

### Step 7 — verify (claude vision, `Read` on the final PNG only)

Checklist derived mechanically from the brief (code, not LLM): every element present;
every label readable and inside its element; headline/subtext legible in `textZone`; no
stray text artifacts; no divider lines; concept conveyed (single holistic judgment).
Output (`VerificationSchema`):

```json
{ "checks": [{ "id": "label:bubble", "pass": false,
               "note": "the word 'done' sits 40px left of the bubble",
               "correctedBbox": { "x": 610, "y": 120, "w": 180, "h": 90 } }],
  "verdict": "pass | repairable_text | repairable_bg | fail" }
```

Repair routing:
- `repairable_text` → re-render text (step 5) using `correctedBbox` values directly —
  **do not re-run localization** (a fresh localization risks a different wrong answer).
  Budget: ≤ 2 text re-renders per run.
- `repairable_bg` → bg regen with corrective feedback, if the single regen budget is
  unspent → back to step 3.
- Budgets exhausted or `fail` → candidate is created **flagged**: `verification` JSON
  stored on the asset, unmet checks listed in the panel. Never discarded, never shown
  as clean.

Worst-case run: ~9 LLM calls (vs 3 today) + the separate art-director run. Accepted:
quality over cost for T1 flagship images.

## 3. Data & API changes

- `@forge/shared`: `HybridBriefSchema`, `LocalizationSchema`, `VerificationSchema`;
  `HybridPlanSchema` retired from the hybrid lane. Draft output schema: `image_concept`
  added, `image_brief` kept optional for legacy parsing.
- DB: `posts.imageBrief` (jsonb, nullable); `image_assets.verification` (jsonb, nullable).
- API: `POST /api/posts/:id/image-brief` (launches art-director run; result PATCHes the
  post), `PATCH /api/posts/:id/image-brief` (save user edits, zod-validated);
  hybrid generate endpoint consumes the stored brief instead of a free-text prompt body.
- Runs: new kind `image_brief`; hybrid sub-steps (bg/localize/text/verify) stream into the
  single `image_hybrid` run's live console via `executeManaged`/`call()` events — no
  per-step run rows.
- Vision-step prompts follow the `image_review` precedent: untrusted content fenced as
  data-only, explicit file allow-list for `Read`.

## 4. Web (ImagePanel / Workspace)

- Panel gains a **"generate brief"** action → shows the structured brief as editable JSON,
  validated client-side with the shared zod schema; "generate image" is enabled only when
  the brief parses. Editing + saving PATCHes the post.
- Legacy: posts with only a prose `image_brief` show it as seed context; generating a
  structured brief replaces it as the active input.
- Candidates carry a verification badge: clean pass silently; flagged shows "N checks
  failed" with notes on expand.
- HTML lane (non-hybrid) keeps working: it consumes the structured brief serialized to
  prose (that lane renders text/styles natively and needs no localization).

## 5. Failure invariants & bounds

- Existing invariant preserved: any hard step failure fails the one managed run; no
  partial candidate; bg.png cleaned up on failure.
- Repair budgets per run: **≤ 2 text re-renders, ≤ 1 bg regeneration** (shared between
  localize-miss and verify-routed regen).
- Every-element-exactly-once validation on localization and verification outputs (the
  `image_review` duplicate/missing/foreign-id pattern).
- A flagged candidate is a **successful run** with stored verification — flags are data,
  not errors.

## 6. Testing

- Unit (fake engines, extended with fake vision outputs): prompt assemblers (labels
  stripped from bg prompt; positioned-labels block in text prompt), schema
  accept/reject, localization id-set validation, repair-loop budget exhaustion paths,
  flagged-not-discarded persistence, normalization coordinate mapping.
- Existing 140 tests stay green; hybrid specs updated for the new plan-less flow.
- Manual-testing guide: new journey — concept → generate brief → edit brief → generate →
  flagged candidate → repair visibility in `/runs`.

## Out of scope

- Comparative `image_review` changes (it may later consume verification data; not now).
- Multi-candidate hybrid generation, A/B briefs.
- Settings UI for the design-language doc.
- Embeddings backfill and other open handoff candidates.
