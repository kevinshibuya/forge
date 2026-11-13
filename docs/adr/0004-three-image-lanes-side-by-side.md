# Three image lanes run side by side, consolidated later from usage data

Rather than pick one image-generation approach up front, the app ships three as peers — `html` (model-authored HTML rendered by Playwright), `raster` (gpt-image-2 through codex), and `hybrid` (a raster background under an HTML text layer) — and defers consolidation until real usage shows which one earns its keep. Nobody could tell in advance which would produce publishable images, and the cost of guessing wrong was a rebuild.

Source: `docs/superpowers/specs/2026-07-11-forge-content-system-design.md` (§Decisions locked — "Three candidate lanes side by side … consolidated later from usage data").

Amended 2026-07-21: the web launches only the hybrid lane (`ImagePanel.tsx`). The html and raster lanes stay reachable through the api. That was the consolidation this decision deferred.

## Consequences

- `asset_lane` is a Postgres enum, so retiring a lane is not a code deletion — removing an enum value needs the migration-recreate dance that migration `0003` performs, unlike the plain `ALTER TYPE … ADD VALUE` an addition takes.
- Every image surface is lane-shaped: the panel, the candidate tiles, the run kinds (`image_html`, `image_gen`, `image_hybrid`) and the model-routing slots in settings.
