# Reference-image flow for the hybrid lane — design

Date: 2026-07-19
Status: approved by Kevin (interactive brainstorm)

## Problem

The hybrid lane's image quality tracks brief richness, but a rich brief alone cannot
reproduce a specific *layout*: run 34 replayed run 29's byte-identical 2,704-char brief
(md5-verified) and reproduced the concept, not the composition — the plan step
re-interprets and gpt-image-2 resamples. Kevin wants "exact look with variations":
anchor new generations to a proven winner (e.g. asset 16) while the brief still drives
content.

Capability confirmed (2026-07-19): codex CLI 0.144.1 built-in `image_gen` supports
reference images on the ChatGPT-subscription path — `codex exec -i/--image <FILE>...`
attaches local PNGs; up to 16 input images per call, <50MB each; no `OPENAI_API_KEY`
required, so the billing invariant (key never reaches codex children) holds. Source:
`~/.codex/skills/.system/imagegen/SKILL.md` (the doc the codex agent reads before
calling `image_gen`) + `references/image-api.md`.

## Decisions (settled in brainstorm)

- **Purpose: both use-cases.** Iterate within a post ("more like this") AND cross-post
  brand consistency (a post may borrow another post's winner). One mechanism covers both.
- **Engagement: sticky per-post with visible indicator.** Once set, every hybrid run for
  that post uses the reference automatically; the image tab shows a chip (thumbnail +
  one-click clear). No per-run toggle.
- **Lane scope: hybrid only.** Raster can adopt later once the lever is validated.
- **Approach A — generate-with-reference.** The reference anchors composition/palette/
  texture; the prose brief still drives content. Approach B (edit-mode framing: "produce
  a variation of this exact image") is the sanctioned fallback if A drifts — same
  plumbing, one prompt-string change, eye-test decides. Approach C (byte-reuse bg.png,
  skip generation) rejected: static, non-adapting, sidesteps the lever.

## Data model

- New nullable column `posts.reference_asset_id` → FK `assets.id`, `ON DELETE SET NULL`.
  Migration 0004 (additive only).
- The FK may point at any hybrid-lane asset, including another post's — that IS the
  cross-post borrowing.
- **The file fed to codex is `bg.png`, never `0.png`.** `0.png` is the composite with
  typography; feeding it risks the model painting text into the new background. `bg.png`
  is the textless background sitting next to it: `dirname(asset.png_path)/bg.png`
  (written by `launchHybrid`, kept on success). Verified present for asset 16.
- Eligibility (validated when setting): asset exists, `lane = 'hybrid'`, `bg.png` exists
  on disk.

## Engine & pipeline

- `EngineRequest` gains `images?: string[]`. `CodexEngine.command()` appends
  `['-i', path]` per image before the prompt. Claude engine ignores the field. This is
  the entire engine change. Note: `-i` attachment happens CLI-host-side (pre-sandbox),
  so a reference `bg.png` living in a different candidate dir — or another post's dir —
  works fine under the `workspace-write` sandbox whose cwd is the new run's dir.
- `launchHybrid` (image-compose.service.ts): when the post has `reference_asset_id`,
  resolve the reference `bg.png` path up front. Missing file at run time → fail the run
  with explicit `errorDetail` (never a silent unreferenced run).
- **Plan step (reference-aware):** the plan chooses `textZone`/`palette`; the reference
  already has a calm zone baked in. When a reference is set, the plan call gets
  `allowedTools: ['Read']` plus the reference image path, instructed to pick `textZone`
  and `palette` consistent with the reference. Reuses the capability `image_review`
  already exercises (claude reading a PNG via Read).
- **Background step (the lever):** the codex call gets `images: [refBgPath]`, and
  `assembleBackgroundPrompt` gains a reference block when a reference is present, in the
  imagegen skill's own idiom (`Input images: Image 1: role`):
  "Image 1 is a style/composition reference: reproduce its composition, palette, and
  texture treatment; adapt the scene to the brief below. Still NO text, letters,
  numbers, or logos."
- Text + composite steps: unchanged.

## API

- `PATCH /api/posts/:id/reference` body `{ assetId: number | null }` — validates
  eligibility, sets/clears. Ineligible → 422 with reason (wrong lane / no bg.png /
  asset missing). Post GET responses include `referenceAssetId`.
- `GET /api/posts/:id/reference-candidates` — picker list: that post's own hybrid
  candidates plus other posts' **selected** hybrid winners (asset id, postId, thumbnail
  URL; assets are already statically served). Nested under `:id` deliberately: a static
  `/posts/reference-candidates` route would be captured by the existing `@Get(':id')`.

## UI (image tab only)

- Hybrid candidate cards get a "Use as reference" action.
- Tab header shows the reference chip: thumbnail + "ref" + × to clear. Chip present ⇒
  next hybrid runs use it. The chip (and picker) show the asset's normal composite
  thumbnail (`png_path`) — recognizable to the eye; `bg.png` is only what codex is fed.
- "Borrow…" on the chip area opens a minimal picker fed by `reference-candidates`.
- Generate button and run console unchanged.

## Error handling

- Set-time: 422 + reason for ineligible assets.
- Run-time: missing `bg.png` fails the run loudly.
- Referenced asset deleted: FK `SET NULL` clears the reference; chip disappears.
- Codex ignoring the reference is a taste failure, not a code failure — the eye-test
  owns it.

## Testing

- Unit (fake-engine suite): codex arg construction (`-i` per image, before the prompt);
  `assembleBackgroundPrompt` reference block; plan-prompt reference variant; PATCH
  validation (wrong lane, missing file, clear, cross-post allowed); hybrid pipeline
  threading `images` through the background call.
- **Merge gate = live eye-test by Kevin:** set asset 16 as post 4's reference, run
  hybrid, judge layout fidelity vs run 34's drift. Same gate discipline as the
  v1-restore arc.
- Any mutating smoke automation uses a sacrificial post (standing rule:
  smoke tests never touch real content).

## Out of scope

- Raster-lane reference support (adopt after validation).
- Multiple references per post (≤16 supported by the tool; start with 1).
- Approach C byte-reuse mode.
- Edit-mode framing as a separate user-facing action (it is only the fallback prompt).
