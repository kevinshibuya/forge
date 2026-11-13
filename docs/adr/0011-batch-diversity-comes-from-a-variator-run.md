# Batch diversity comes from a dedicated variator run

A batch of image candidates exists to find a usable one, so the candidates must be deliberately different. Previously every pipeline in a batch received the same brief and produced near-copies. The fix is an extra `image_variate` run before the fan-out: one model call turns the operator's brief into N distinct visual directions, one per pipeline. It runs only when `n >= 2`.

Source: `docs/superpowers/specs/2026-07-22-batch-hybrid-diversity-design.md` (§Decisions locked, §1 Brief variator). Run kind `image_variate` and `HybridDirectionsSchema` at `app/shared/src/images.ts:38`.

## Considered options

- **A fixed palette of angles.** Rejected as canned and not brief-aware.
- **Prompt-only divergence** — telling each pipeline to be different. Rejected because the pipelines cannot see each other, which makes diversity a matter of luck.

## Consequences

- Directions vary the visual concept only — composition, metaphor, mood, palette emphasis. They never rephrase the headline or subtext; the plan step still derives copy from the operator's brief.
- Diversity comes from the raster background, never from the HTML text layer, which is why the typography-only guard on the text step is a dependency of this design rather than an unrelated cleanup.
- The variator is a real run, so it appears in the runs list and streams to the console like any other engine call.
- Roughly one candidate in four overshoots into content-free abstraction. That is the same freedom that produces real diversity; the lever, if it needs pulling, is a minimum-legibility clause in the variator prompt (`HANDOFF-post-diversity-clean-slate.archived.md`).
