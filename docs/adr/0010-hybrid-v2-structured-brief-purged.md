# The hybrid v2 structured-brief subsystem was purged; image quality comes from brief richness

Hybrid image v2 replaced the prose brief with a structured `image_concept`, added text localization against the background and a vision quality gate with bounded auto-repair. It was rolled back, and the dormant machinery was then deleted outright — the `image_brief` run kind, `ImageBriefService`, `posts.image_brief`, the localization and verification schemas, and the structured-brief editor in the web panel. What replaced it is the v1 plan-first flow gated on a plain prose brief.

The evidence behind the rollback: image quality tracks **brief richness**, proven twice against the database. The best image the project produced came from a 2,704-character art-directed prose brief; the bad post-purge image came from a one-sentence `image_concept` fallback.

Source: `docs/superpowers/specs/2026-07-19-v2-purge-workspace-redesign-design.md` (§Context, §Part 1 — v2 purge); `HANDOFF-v2purge-and-reference-image.archived.md` (§What worked / what didn't). The v2 design it replaced is `docs/superpowers/specs/2026-07-17-hybrid-image-v2-design.md`, kept for history.

## Consequences

- `HybridPlanSchema` (v1) stays; the v2 brief, bbox, localization and verification schemas are gone.
- A byte-identical brief reproduces the *concept* but not the *layout*, because the plan step re-interprets it and gpt-image-2 samples. Reproducing an exact look needs the reference-image lever, not a re-run.
