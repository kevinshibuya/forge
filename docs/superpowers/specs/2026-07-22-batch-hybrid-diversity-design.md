# Batch hybrid diversity — brief variator + reference-as-direction

2026-07-22. Kevin-approved design (interactive brainstorm). Goal: the batch exists to find a
suitable candidate, so N candidates must be deliberately DIFFERENT — today all N pipelines get the
same brief and, when a reference is set, an instruction to reproduce it, yielding N near-copies.

## Decisions (locked)

- Sequencing: ships as its own arc AFTER `feat/batch-hybrid-hybrid-only-ui` merged with the
  2026-07-21 fix wave (engine cwd isolation, typography-only text-step guard, extractHtml error
  tail). The typography guard is a dependency of this design: diversity comes from the raster
  background, never from the HTML text layer.
- Diversity mechanism: a **variator call** — one extra Claude run per batch generates N distinct
  visual directions from Kevin's brief. Rejected: fixed angle palette (canned, not brief-aware),
  prompt-only divergence (pipelines can't see each other; diversity is luck).
- Variation axis: **visual concept only** (composition, metaphor, mood, palette emphasis). The
  message is untouched: directions never rephrase headline/subtext copy; the plan step still
  derives copy from Kevin's brief.
- Reference role: **direction, not base**. Plan step extracts what worked; the bg step still
  attaches the image (`-i`) but reframed as style/quality reference with an explicit
  do-not-copy-composition instruction. Rejected for now: extract-to-text-only (loses the
  pixel-level quality anchor; the 2026-07-21 no-ref batch showed drift + raster garbage).
  Documented fallback if the eye-test still shows copying: drop the `-i` attachment (one line).

## 1. Brief variator

- New run kind `image_variate` (shared `run_kind` enum + migration 0005 — a plain
  `ALTER TYPE ... ADD VALUE`; 0003's recreate dance is only needed for removals). Every LLM call
  is an audited run; the variator is visible in the runs list / console (RunsLog kind filter
  gains `image_variate`).
- Lives in `launchHybridBatch`: when `n >= 2`, run the variator BEFORE the fan-out; `n == 1`
  skips it entirely. Model: `settings.models.image_html` (same tier as plan step).
- Contract: input = Kevin's brief + n. Output = fenced JSON OBJECT `{ "directions": [...] }`
  holding exactly n short strings (each <= ~40 words), mutually distinct visual directions
  (different composition/metaphor/mood/palette-emphasis axes), visuals only — never alter the
  message, tone of copy, or wording. Object-wrapped because `extractJson` extracts `{...}` only,
  never a bare array (pre-review C1). Parsed with `extractJson` + zod
  (`z.object({ directions: z.array(z.string().min(1)).min(1) })`), sliced/validated to n.
- Plumbing: pipeline i runs `launchHybrid(postId, augmentedBrief_i)` where
  `augmentedBrief_i = brief + "\n\n## visual direction (this candidate)\n" + direction[i]`.
  `launchHybrid` is UNCHANGED — the augmented brief flows into the run row's `prompt` and the
  candidate's `generationPrompt` (panel-visible) for free.
- Fail-open: variator run failed / unparseable / fewer than n directions → missing slots use the
  plain brief; the batch always launches (a failed variator records its own failed run row).
  Degraded-mode note: with a reference set and no directions, the reframed ref instruction is the
  only anti-copy force — accepted.

## 2. Reference as direction

- `HybridPlanSchema` (shared) gains optional `refLearnings: string` (<= ~60 words).
- `assemblePlanPrompt` ref section flips from "reproduce its look" to: view the reference, extract
  what worked — palette, line quality/weight, density, mood, motif style — into `refLearnings`;
  choose `textZone`/`palette` consistent with it. The new background must NOT copy the reference's
  composition.
- `assembleBackgroundPrompt` ref line flips from "reproduce its composition, palette, and texture
  treatment; adapt the scene" to: "Image 1 is a STYLE/QUALITY reference only. Do NOT copy its
  composition or layout. Compose a NEW scene per the brief below." followed by
  `Carry over what worked: {plan.refLearnings}` (clause omitted when `refLearnings` absent).
- `-i` attachment unchanged (attached form `-i=<path>`, see codex gotcha in memory).

## 3. Surface

No API, DB-schema (beyond the enum), or UI changes: same `POST /images/posts/:postId/hybrid`
`{brief, batch}`, same run rows per pipeline, direction visible via existing `generationPrompt`.

## 4. Error handling

- Variator failure: fail-open (above), logged via its run row.
- Per-pipeline failures: unchanged (partial success; zero-start → ConflictException).
- Plan output missing `refLearnings` with a ref set: valid (optional field); bg prompt omits the
  carry-over clause.

## 5. Testing

- Unit: variator prompt assembly (n, visuals-only constraint text); direction-array parse +
  slice/fallback paths; `assemblePlanPrompt`/`assembleBackgroundPrompt` new wording incl.
  refLearnings present/absent; augmented-brief format.
- Integration (fake engines): batch n=4 → 4 pipelines receive 4 DISTINCT briefs (QueueClaude
  request capture; its queues are PER-KIND, so the variator has its own `image_variate` queue —
  no ordering constraint); variator-fails → all pipelines get the plain brief and batch still
  yields runIds; n=1 → no variator run row.
- Suite invariant: image specs run against fake engines only; no real codex/claude spawns.

## Merge gate

Kevin eye-test: post 4, reference set, batch 4 → 4 candidates sharing the design language but
visibly different in composition; no near-copies of the reference, no raster garbage, no
drawn-on-top schematic elements. If candidates still near-copy the ref: apply the documented
fallback (drop `-i`) and re-test before re-review.
