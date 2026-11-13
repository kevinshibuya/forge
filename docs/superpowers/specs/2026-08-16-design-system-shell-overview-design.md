# Phase 3 — Design system + app shell + Overview page

**Date:** 2026-08-16. **Status:** brainstorm-approved; the ONE three-leg review wave (opus + fable + codex, adversarially verified) ran 2026-08-16 and its surviving findings are folded in below — this document is post-fix-pass. No second wave; next step is the plan.
**Phase context:** phase 3 of 4 per `2026-08-10-overhaul-roadmap.md`. Phases 1–2 are merged (`main` @ `4c6f731`). Phase 4 (Planner/Analytics reskin + data viz + remaining pages) follows this one.

## References and authority split (design-from-references)

- **Bench "studio hours" artifact = the app-wide visual language.** The structural spine for tokens, type, and component grammar. Anatomy transcribed in the roadmap (§"Reference anatomy — Bench"); the executing session may fetch https://claude.ai/code/artifact/ebcb3667-cf79-4e22-9aa3-4fa18facee83 for the full HTML if a detail is ambiguous, but the transcribed tokens below are authoritative.
- **Dribbble "Vulnerability overview" = the Overview page structure.** Spine for the page only. Reference URL in the roadmap; anatomy transcribed in the roadmap.
- **Never average the two.** Named grafts, in full:
  1. The Dribbble icon rail → the shell's *collapsed* sidebar state.
  2. Bench salmon/mint replace the Dribbble purple/teal/orange as the only data-encoding hues; the Dribbble dark band uses Bench dark-bone/ink, never pure black.
- Every element below traces to the Bench inventory, the Dribbble inventory, one of those two grafts, or an explicitly recorded adaptation. Untraceable elements get cut, not restyled.

## Decisions locked in the 2026-08-16 brainstorm

1. **Global token swap.** Palette/type/primitives replaced app-wide in one cut. All pages recompile wearing Bench; only shell + Overview get layout work. Transitional roughness on other pages is accepted until phase 4.
2. **Both themes ship now.** Semantic tokens with light and dark values; `data-theme` attribute, `prefers-color-scheme` default, toggle in the shell. Dark audit covers shell + Overview only; other pages inherit and get audited in phase 4.
3. **Collapsible sidebar.** Expanded = Bench-grammar labeled sidebar; collapsed = Dribbble icon-only rail (graft #1). User-toggleable, persisted.
4. **Analytics-led hero.** The dark band shows content performance; operations live in the light lower band.
5. **Hero comparison chart = this window vs previous**, one row per metric.
6. **Lower band is upcoming-centered** (quartet / tick-meter list of scheduled posts + "open planner" CTA / status-mix percent bars).
7. **Time windows: last 7 / 28 / 90 days, default 28.** No custom date picker in phase 3.
8. **Out of scope:** spend/cost anywhere on Overview (phase 4's Analytics page owns it); custom date ranges; layout changes to any page other than Overview; dark audit of non-Overview pages; the Analytics page itself.
9. **Data correction from schema reality:** `members_reached` exists only at window grain (`fact_window_metric`) and per-post lifetime — it cannot be recomputed for arbitrary windows. The hero therefore uses impressions / engagements / new followers for window-driven rows, and the fourth stat card is **total followers** (latest snapshot), not members reached.

## 1. Design system — tokens and type

`app/web/src/index.css` `@theme` is replaced wholesale. Semantic tokens, light and dark values (dark values from the Bench transcription):

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-bone` | `#E7ECEA` | `#0E100F` | page background |
| `--color-ink` | `#0A0B0A` | `#E7ECEA` | primary text, solid controls, hairlines |
| `--color-soft` | `#55605B` | `#9BA5A0` | secondary text |
| `--color-paper` | `#FFFFFF` | `#161917` | raised surface (cards, panels) |
| `--color-salmon` | `#EE9375` | `#EE9375` | accent / data series A |
| `--color-mint` | `#90DE9D` | `#90DE9D` | accent / data series B |
| `--color-hairline` | `#0A0B0A` | `#3A423E` | 1px structural rules |
| `--color-hairline-soft` | ink @ ~18% | `#3A423E` @ ~60% | dense-row separators (adaptation, recorded) |
| `--color-hero` | `#0E100F` | `#0A0B0A` | Overview dark band surface (graft #2) |
| `--color-hero-panel` | `#161917` | `#141614` | the "slightly lighter panel" inside the hero |

- Dark paper/hero-panel values are the executing session's to fine-tune (Bench transcription doesn't carry them); the constraint is: paper reads one step above bone in both themes, hero-panel one step above hero.
- Theme mechanism: tokens defined on `:root` (light), overridden under `[data-theme="dark"]`, and under `@media (prefers-color-scheme: dark)` for the no-preference default (`:root:not([data-theme="light"])`). Toggle writes `data-theme` on `<html>` and persists to `localStorage` (`forge:theme`); absent key = follow system. First-paint init: a tiny inline `<script>` in `index.html` `<head>` reads `forge:theme` and stamps `data-theme` before the bundle loads; `ThemeToggle` only writes thereafter.
- **Type:** grotesk stack `"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`. Plus Jakarta Sans and the `@fontsource-variable/plus-jakarta-sans` dependency are removed. Page headlines: `clamp(2rem, 4vw, 3.2rem)` (app-scaled from Bench's landing-page clamp — adaptation, recorded), weight 700, line-height 0.95, letter-spacing −0.033em, lowercase. Body 15–16px; secondary text in `--color-soft`.
- **Grammar rules (Bench):** 1px ink hairline separators instead of gray borders; pill-shaped buttons and controls (`border-radius: 100px`); flat surfaces — **no drop shadows, no gradients**; circular ink mark as the logo; generous whitespace; content max-width 1400px.
- Radius tokens: `--radius-pill: 100px`; cards/panels drop to a small radius (`--radius-card: 8px`) — Bench is flat and rectilinear, the current 14–18px rounding dies.
- The new `@theme` block **starts with `--color-*: initial;`**, wiping Tailwind v4's entire default palette before defining the Bench tokens. This is load-bearing (wave blocker, reproduced by compilation): the defaults in `tailwindcss/theme.css` already define `--color-blue-*`, `--color-white`, `--color-emerald-*`, etc., so merely deleting our custom tokens would leave every stale `text-blue-500`/`bg-white` compiling in stock oklch. With the namespace zeroed, stale classes emit no CSS and the §6 grep gate becomes a real second line of defense. Old custom tokens (`cream`, `sand`, `mist`, `bark`, `dust`, `blue-50…500`, `peri`) are deleted, not aliased; `--radius-panel` dies too (`rounded-panel → rounded-card` in the sweep).

## 2. Primitives (`app/web/src/ui/primitives.tsx`)

Rebuilt in place. Component **signatures are preserved** wherever a component survives, so pages recompile without call-site edits except where noted.

| Primitive | Fate |
|---|---|
| `Eyebrow` | **Deleted** (banned tell). Call sites swept to plain soft-text labels or removed. |
| `PageHeader` | Rebuilt: big tight lowercase grotesk headline (per type spec) over a 1px ink hairline; optional `sub` in soft. **No eyebrow, no index number, no italic last word.** Signature change: `index` prop dropped. |
| `Panel`, `Card` | Paper surface, 1px hairline border, `--radius-card`. No translucency, no shadow. |
| `Pill` | Hairline-bordered pill, paper surface, soft text. |
| `Button` | Pill geometry kept. `solid` = ink on bone/paper; `ghost` = 1px ink hairline, transparent; `subtle` = paper + hairline-soft. |
| `TierBadge`, `StatusPill` | Same shape, recolored to ink/soft/paper; status dots re-mapped to the new palette (drafting keeps its pulse). |
| `Field`, `inputCls`, `Spinner`, `EmptyState`, `ErrorNote`, `WarnBanner` | Recolored to tokens. `WarnBanner` loses its left accent rail (banned tell) — becomes a hairline-bordered paper note with a salmon leading dot-free label (plain bold text). |
| `BarRow` | Kept; track = hairline-soft, fill = mint (single-hue magnitude stays single-hue). |
| `StatTile` | Bench: huge tabular number in ink, lowercase soft label, paper card with hairline. No colored eyebrow. |

**New primitives** (all hand-rolled SVG/flex — no chart library; flat geometric grammar):

- `DivergingBars({ rows })` — one row per metric: lowercase label left; two bars diverging from a center axis (previous window extends left in `--color-soft`-muted salmon, current window extends right in mint — exact hue assignment is the implementer's, constraint: the two series are salmon/mint family only), numeric values at bar ends, 1px center axis in hairline. Scales to the max value across both series.
- `WeekdayBars({ days })` — grouped mini bar chart, 7 groups (mon–sun), two bars per group (impressions mint, engagements salmon), y-axis with 2–3 hairline gridlines and small soft tick labels.
- `HeroStatCard({ icon, value, label, sub })` — small ink-outline icon in a hairline circle, huge number, lowercase soft label, 1px hairline divider, one sub-metric row (`label: value`). Rendered on `--color-hero-panel`.
- `TickMeter({ stage })` — segmented meter of **4 ticks** for the reachable pipeline stages `queued → drafting → draft_ready → approved`; filled ticks mint, empty ticks hairline-soft. `published`/`measured` can never appear in `upcoming` rows (publishing clears the schedule — migration `0009`), so there is no fifth tick and no acceptance criteria for unreachable branches.
- `ThemeToggle` — pill control, two states, writes `data-theme` + localStorage as in §1.

Dark-band variants: hero-band content renders on dark surfaces in BOTH themes (the band is dark by anatomy). Implement via a `data-surface="dark"` scope on the band that re-points the **complete** token set to theme-independent constants: `bone → --color-hero` · `paper → --color-hero-panel` · `ink → #E7ECEA` · `soft → #9BA5A0` · `hairline → #3A423E` · `hairline-soft → #3A423E @ ~60%`. No component needs theme-conditional logic. The active window pill inside the band uses the scoped `ink` as its surface (so it reads light, like the reference's white active pill) with `--color-hero` as its label color. This scope block is the plan's designated verbatim-CSS contract (§9), written out with both themes shown.

## 3. Shell (`app/web/src/ui/shell.tsx`)

- **Expanded state (default, ≈230px):** circular ink mark + lowercase wordmark "forge" top; nav = lowercase grotesk labels with ink-outline icon per item; active = ink text + filled pill background (paper in light / hero-panel in dark); **no numbered indices, no inset accent rail** (both banned tells). 1px hairline right edge instead of the gray border.
- **Collapsed state (≈72px, Dribbble graft):** logo mark top; icon-only nav with `title` tooltips; active = pill highlight behind the icon.
- **Bottom cluster:** `ThemeToggle` + collapse/expand control (chevron pill). Collapse state persisted to `localStorage` (`forge:sidebar`).
- **Icons:** 8 destination icons + logo mark + chevron + theme glyphs, hand-rolled inline SVG, stroke-based ink outlines (Bench illustration grammar). No icon library dependency.
- Nav item 1 renames `dashboard` → `overview` (route `/` unchanged).
- Main content area: bone background, max-width 1400px, generous padding per Bench.

## 4. Overview page (replaces `pages/Dashboard.tsx` → `pages/Overview.tsx`; the import and route element in `main.tsx` update with the rename)

Band-by-band per the Dribbble spine.

### Dark hero band (full content width, `--color-hero`, radius `--radius-card`)

- **Top row:** page headline top-left (big tight lowercase grotesk, e.g. "overview"). Top-right: pill group `last 7 days / last 28 days / last 90 days` — active pill per the §2 `data-surface` scope (scoped-ink surface, hero-colored label), inactive hairline ghost. Default **28**. Selection is client state; changing it refetches `GET /analytics/overview`.
- **Left column:**
  - `DivergingBars` — 3 rows: `impressions`, `engagements`, `new followers`. Left series = previous window total, right = current window total, values at bar ends.
  - Below: `WeekdayBars` — current window's daily rows bucketed by weekday (sum per weekday), impressions + engagements.
- **Right column:** "main metrics" label; 2×2 `HeroStatCard` grid on `--color-hero-panel`:
  1. **impressions** — sub: `posts published: N` (posts with `publishedAt` in window)
  2. **engagements** — sub: `rate: X%` (engagements ÷ impressions, current window; `—` when impressions = 0)
  3. **new followers** — sub: `per day: X` (mean over window)
  4. **followers total** — latest `followers_total` snapshot; sub: `as of <date>`; card renders `—` + "no follower snapshot yet" sub when none exists.

### Light lower band (3 columns on bone, 1px hairline verticals between)

1. **Quartet** (2×2 big numbers with hairline dividers): `published this week X/goal` and `streak N weeks` — both rendered **only when a weekly goal is set** (current Dashboard behavior preserved; when absent the quartet degrades to the remaining tiles in a 2-up row); `scheduled N` (uncapped count under the same predicate as `upcoming` — §5); `pending N` — the pending count is a link that reveals the pending-actions list (inline expand below the band; each action keeps its `href`).
2. **Upcoming** list: next scheduled posts (up to 5), each row = date (+ time when set) · title · `TickMeter(stage)`; single CTA pill `open planner` (→ `/planner`). **Exactly one CTA in the lower band.**
3. **Status mix**: labeled percent bars — one per post status with ≥1 post (label · % of all posts · mint fill on hairline-soft track), from the extended dashboard payload.

### Empty/thin states

- No analytics rows in the current window → hero left column shows a hairline-bordered empty state ("no analytics in this window — import an export on the analytics page"). `daysWithData` gates **only the three window-derived cards** (impressions, engagements, new followers) and their derived sub-metrics: real zeros when the window has imported days, `—` otherwise. `posts published` and `followers total` keep their independently sourced values regardless. **No invented numbers anywhere.**
- Previous window empty but current populated → diverging bars render the left side at zero with the value label `0` (an honest zero, since absence of imported data and zero are indistinguishable at this grain — recorded adaptation).
- No scheduled posts → column 2 keeps the CTA with an empty state, as today.

## 5. Data / API

### New: `GET /analytics/overview?window=7|28|90` (default 28)

Lives in `analytics.service.ts` beside `trends()`/`forPost()`. Reads `fact_profile_metric` for all metric aggregates, plus `posts` for the published count (the legacy `analytics_snapshots` table no longer exists — dropped by migration 0010). Day boundary: America/Sao_Paulo, **deliberately pinned to the ingestion zone** rather than `settings.scheduling.timezone` — `fact_profile_metric` dates are zone-fixed at parse time, so do not "fix" this query onto the settings zone. Current window = last N calendar days **ending today, inclusive**; previous window = the N days immediately before. Missing days count as 0. A `window` value outside {7, 28, 90} is a 400 (unit-tested).

```jsonc
{
  "window": 28,
  "current":  { "start": "2026-07-20", "end": "2026-08-16",
                "impressions": 0, "engagements": 0, "followersNew": 0,
                "postsPublished": 0, "daysWithData": 0 },
  "previous": { /* same shape */ },
  "weekday":  [ { "weekday": 1, "impressions": 0, "engagements": 0 } /* 1=mon … 7=sun, always 7 entries */ ],
  "followersTotal": { "value": 0, "asOf": "2026-08-10" } // or null
}
```

- `impressions`/`engagements`/`followersNew` = SUM of the daily `fact_profile_metric` rows in range (metrics `impressions`, `engagements`, `followers_new`).
- `followersTotal` = the `followers_total` row with the greatest date ≤ today, or null.
- `daysWithData` = count of distinct dates in range having any of the three daily metrics — the web uses it for the zeros-vs-`—` distinction in §4.
- Derived values (engagement rate, per-day mean) are computed client-side. The per-day mean divides by `daysWithData`, not by N (honest-numbers rule), and renders `—` when `daysWithData` is 0.
- Endpoint is read-only, no auth change, added to `analytics.controller.ts`.

### Extended: `GET /dashboard`

Adds to the existing payload: `statusMix: [{ status, count }]` (all statuses, zero-count rows omitted) and `scheduledCount` — **the same predicate the `upcoming` list already uses** (`publishedAt IS NULL AND scheduledDate >= today`, settings zone, per `planning.service.ts`), just uncapped. `upcoming` rows already carry `status` — the web derives the 4-tick `TickMeter` stage from it (§2).

## 6. The sweep (global token swap mechanics)

- **Scope: all of `app/web/src`** — not just `pages/*`. Roughly 78 stale-token lines and 3 of the 4 `Eyebrow` call sites live outside `pages/`: `ui/run-detail.tsx`, `ui/canvas-editor.tsx`, `ui/selection-refine.tsx`, `ui/run-console.tsx`, `ui/planner/*`, `ui/hashtag-editor.tsx`, `ui/lightbox.tsx`, and `lib/run-status.ts` (a status→class map, not markup — easy to skip). The plan enumerates the exact file list from `grep -rl` over the pre-sweep tree, excluding the rebuilt `primitives.tsx`/`shell.tsx`.
- Because §1 wipes the default palette (`--color-*: initial`), stale classes emit no CSS after the swap — including the Tailwind default-backed ones (`blue-*`, `white`, `emerald`, `rose`, `amber`). The grep gate below is the second line of defense; the visual smoke is the third.
- Mapping guide (layouts untouched, class tokens only): `cream/sand → bone` · `white`, `white/40…80 → paper` · `mist → hairline(-soft)` · `bark/dust → soft` · `blue-400/500` accents → `ink` (interactive) or `salmon` (emphasis) · `blue-50/100` washes → `paper` · `peri → salmon` · `emerald → mint` · `rose → salmon` · `amber → soft` (status hues fold into the Bench pair: success = mint, failure = salmon, warnings de-color to soft text) · `rounded-panel → rounded-card` · `shadow-* →` none: floating overlays (popovers, run console, lightbox) get 1px hairline border + paper surface instead of elevation (recorded adaptation of Bench flatness). Judgment calls (which accent where) belong to the implementer within the constraint: salmon/mint are accents and data hues, never large surfaces.
- **Sweep-proof gate** — patterns anchored on token names in utility positions (never bare words, which false-positive on "thou**sand**"/"in**dust**ries"):
  1. `grep -rEn '[A-Za-z-]+-(cream|sand|mist|bark|dust|peri|blue-[0-9]+|emerald-[0-9]+|rose-[0-9]+|amber-[0-9]+)(/[0-9]+)?\b' app/web/src`
  2. `grep -rEn '(^|[^A-Za-z-])(bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|accent)-white(/[0-9]+)?\b' app/web/src`
  3. `grep -rEn 'rounded-panel|shadow-(sm|md|lg|xl|2xl|\[)|var\(--color-(cream|sand|mist|bark|dust|peri|blue)' app/web/src`
  - Discipline: each pattern MUST produce >0 hits on the pre-sweep tree (record the counts) and exactly 0 after — a gate that never fired proves nothing. The plan may refine the patterns; the >0-then-0 discipline is non-negotiable.
- The sweep changes only class tokens and removed-primitive call sites (`Eyebrow` — including its three `ui/*` importers — and the `PageHeader` `index` prop); layouts stay untouched.
- `index.css` `::selection` and `:focus-visible` re-point to tokens (focus ring: salmon in light, mint in dark — visible on both bone and hero surfaces).

## 7. Verification

| Gate | Command / probe |
|---|---|
| Types + lint | `cd app/api && npm run typecheck` · `cd app/web && npm run typecheck && npm run lint` |
| API unit | vitest: overview aggregation — window boundaries (inclusive end, Sao Paulo), previous-window offset, empty window, `followersTotal` latest-wins, `daysWithData`, statusMix/scheduledCount |
| Browser smoke | `app/api/scripts/route-smoke.mjs` **extended**: `ROUTES` grows from 5 to all 10 — add `/backlog`, `/playbook`, `/analytics`, `/analytics/1` (post #1 is measured), `/posts/5` (the sacrificial post); the unprobed routes carry the heaviest sweep impact (Workspace, ImagePanel, Playbook, Analytics). The `<title>`-is-`forge` port check moves INTO the script. New probes: Overview hero renders **either** the diverging bars **or** the §4 empty state (the dev DB's only import window ends 2026-08-08, so data presence is not probe-stable) AND all 4 stat cards; window pill click fires a `/analytics/overview?window=` request; theme toggle flips `data-theme` + background; sidebar collapse toggles rail width and persists across reload. Zero console errors on every route. |
| Sweep proof | the §6 patterns: recorded >0 pre-sweep, exactly 0 post-sweep; fontsource removed via `npm uninstall -w web @fontsource-variable/plus-jakarta-sans` and absent from `index.css`, `app/web/package.json`, and `app/package-lock.json` |
| Design-tells | `check-design-tells.sh` hook passes with **no** `design-tells: acknowledged` overrides — the new system needs none |

Smoke discipline: probes may mutate **post #5 only** and must restore it; the settings row is never touched. Verify the web server on 5173 is actually forge (`<title>` check) before trusting probe results.

## 8. Absence list (what is NOT in the references and stays out)

Explicitly enumerated per design-from-references step 3: eyebrow/kicker labels (current `Eyebrow` dies) · numbered nav/section markers (current `01–08` die) · italic word in a sans headline (current `PageHeader` em dies) · accent rail on cards (current active-nav inset and `WarnBanner` rail die) · stat strips with invented metrics (every Overview number is real data or an honest `—`) · gradient washes · drop shadows · icons beside every list item (icons exist ONLY in the nav rail and hero stat cards, where the references have them) · second CTA in the lower band · badges above sections · testimonial/logo elements.

## 9. Risks and notes for the plan

- **Sparse real data:** the dev DB has one aggregate import (May–Aug window). 7-day windows will often be empty — the empty states in §4 are load-bearing, and acceptance tests must cover them, not just the happy path.
- **`followers_total` is sparse** (one snapshot per aggregate import). The "as of" sub-line is what keeps it honest.
- **Hero-band token scoping** (`data-surface="dark"`) is the one genuinely fiddly CSS piece — a good candidate for a verbatim-shape contract in the plan.
- The sweep touches most files under `app/web/src` (pages, `ui/*`, `lib/run-status.ts`) — mechanical, but wide; slice it as an enumerated file list (editor rung) separate from the judgment work (tokens, primitives, shell, Overview → integrator rung).
- Route-smoke currently hardcodes `localhost:5173`; keep that, but the plan must carry the port-collision trap from HANDOFF.md.
- `PostAnalytics`/`Analytics` pages use `BarRow`/`StatTile` heavily — they must remain legible after the sweep (phase 4 rebuilds them properly).
