# Hybrid v1 Restore — generation flow rollback

**Status:** approved for planning (2026-07-18)
**Owner decision trail:** rollback direction user-decided after three live eye-tests (v2, v3, v3+SDS all lose to the v1 reference image); scope = generation only; v3+SDS branch archived unmerged.

## Problem

Live evidence across three iterations: the v1 pipeline's image ("the gate the model can't
route around", flat line-art painted wholly by gpt-image-2) is cleaner than every image the
v2 structured-brief, v3 layered-renderer, and v3+schematic-canon pipelines produced. The
model is not the lever (gpt-image-2 = ChatGPT Images 2.0, April 2026, is OpenAI's frontier
image model with no successor as of July 2026). The lever is prompting: v1 let claude write
ONE freeform prose `backgroundPrompt` and gave gpt-image-2 full compositional freedom;
every structure added since (element lists, zones, labels, renderer tags, checklists)
traded taste for control and lost.

## Decisions (settled — do not re-litigate)

1. **Restore the v1 generation flow exactly** (as of `e38bdbe`, the pre-v2 tip): claude
   plans `{backgroundPrompt, headline, subtext, textZone, palette}` via `assemblePlanPrompt`
   → gpt-image-2 paints the ENTIRE image from the freeform `backgroundPrompt` (textless,
   text-zone-calm, palette) → claude composes typography only, over `__HYBRID_BG__` →
   composite → candidate. No localization, no checklist, no vision verify, no repair loop,
   no flags on new hybrid candidates.
2. **Generation-only scope.** The v2 structured-brief machinery (art-director `image_brief`
   run, `posts.image_brief` column, PATCH endpoint, panel editor) and `VerificationSchema`
   stay in code and DB — dormant for hybrid, untouched. Stored data remains parseable.
3. **Branch:** `feat/hybrid-v1-restore` off `main` (v2). `feat/hybrid-image-v3` (v3+SDS) is
   archived unmerged — do not delete it; its docs/specs are the record of why.
4. **Hybrid brief input reverts to the v1 contract:** `POST /images/posts/:postId/hybrid`
   takes `{ brief: string }` (prose), same as the html/raster lanes; `launchHybrid(postId,
   brief)`. The web hybrid button sends the same prose brief the html/raster buttons send
   and stops requiring a saved structured brief.

## Components

1. **Shared contracts:** re-add `HybridPlanSchema` (verbatim from
   `git show e38bdbe:app/shared/src/images.ts`) alongside the existing v2 schemas; restore
   its v1 test block. Nothing removed.
2. **API prompts (`hybrid-prompts.ts`):** restore v1's `assemblePlanPrompt`,
   `assembleBackgroundPrompt(plan: HybridPlan)`, `hybridTextBrief(plan: HybridPlan)`
   verbatim; KEEP v2's `assembleBriefPrompt` (the dormant `image-brief.service` imports
   it); DELETE v2's localize/checklist/verify prompt surface (`assembleLocalizePrompt`,
   `bgOnlyHtml`, `buildChecklist`, `assembleVerifyPrompt`, `VerifyCheck`,
   `PositionedLabel`) and `hybrid-pipeline.ts` + its spec entirely (only
   `image-compose.service` consumes them — verify with grep before deleting).
3. **Pipeline (`image-compose.service.ts`):** restore the v1 `launchHybrid` internals and
   signature verbatim from `e38bdbe` (plan → bg → text → composite → create; `image_plan`
   run kind — still in the `run_kind` enum, no migration). Non-hybrid parts
   (`extractHtml`, `assembleImageHtmlPrompt`, `substituteBackground`, `launchHtml`) are
   expected identical between `e38bdbe` and main — verify by diff, do not hand-edit.
4. **Controller:** hybrid endpoint takes `ZodBody(BriefSchema)` again (v1 contract).
5. **Web (`useComposeHybrid` + `ImagePanel.tsx`):** the hybrid mutation posts
   `{ brief }`; the generate-hybrid button sources the same prose brief state the
   html/raster buttons use and its enablement follows theirs (no structured-brief
   prerequisite). No other panel changes; the brief editor stays (dormant for hybrid).
6. **Tests:** restore `test/hybrid.spec.ts` and `hybrid-prompts.spec.ts` from `e38bdbe`
   (adjust only if surrounding harness drifted); rework `images-http.spec.ts`'s hybrid case
   to the v1 contract (no verify queue) while KEEPING its brief-endpoint coverage; shared
   `images.spec.ts` keeps all v2 blocks and regains the `HybridPlanSchema` block.
7. **Docs:** J2b rewritten to the v1 flow; HANDOFF records the rollback rationale + the
   archived v3 branch.

## Out of scope (logged)

- Removing the brief panel/endpoints/column — revisit only if the dormant machinery annoys.
- Any quality gate on hybrid output — deliberately none, per the rollback decision.
- The schematic-design-system doc/seed changes — they exist only on the archived branch.

## Verification

- `cd app && npm test` green + `npm run typecheck` clean at every commit; web typecheck +
  lint clean for the web task.
- Acceptance (user, live): API restart, then a hybrid run on post 4 using the prose brief,
  judged by eye against the v1 reference image. Nothing merges on green tests alone.
