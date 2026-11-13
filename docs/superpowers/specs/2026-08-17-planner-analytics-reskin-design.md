# Phase 4 — Planner/Analytics reskin, analytics data viz, remaining-pages sweep

**Date:** 2026-08-17. **Status:** post-fix-pass. The ONE review wave ran 2026-08-17: fable + codex legs completed and independently converged on the grain-mismatch blocker; the opus leg and the workflow's verify agents died on a session limit, so every finding was hand-verified against code and the dev DB in-session instead (all 8 confirmed, all folded in below). No second wave; next step is the plan.
**Phase context:** phase 4 of 4 per `2026-08-10-overhaul-roadmap.md`. Phases 1–3 merged (`main` @ `1ee0fb5`). This is the last phase: after it, nothing from the overhaul roadmap or the phase-3 deferred list is left dangling.

## References and authority split (design-from-references)

- **Bench "studio hours" = the app-wide visual language**, unchanged from phase 3. Tokens, type, and grammar per `2026-08-16-design-system-shell-overview-design.md` §1–2 — that spec is the design-language contract this phase must stay inside. No new tokens, no new hues.
- **Plausible Analytics (live demo, captured 2026-08-17) = the Analytics page spine.** The screenshots are not kept in the repo. Anatomy transcribed in §1.
- **Buffer publish calendar (marketing capture, 2026-08-17) = the Planner layout spine.** The screenshot is not kept in the repo. Anatomy transcribed in §3.
- **Named grafts, in full:**
  1. Plausible's KPI-tab strip (stat = tab, selection swaps the single big time series) → Analytics band 1.
  2. Plausible's top-N list rows with a horizontal bar-fill *behind* the row → Analytics bands 2–3 and post-detail demographics.
  3. Buffer's day-grouped agenda stream with inline "+ schedule" slot rows → Planner main column.
  4. From the phase-1 planner (kept pieces, not re-averaged): the mini-month density navigator and the unscheduled-queue rail.
- **Never average references.** The Overview page's dark-hero grammar is deliberately NOT extended to Analytics: Analytics is a light working page; the dark band stays exclusive to Overview so the two pages read as different rooms.
- Every element below traces to a reference inventory, a named graft, the Bench grammar, or an explicitly recorded adaptation. Untraceable elements get cut, not restyled.

## Decisions locked in the 2026-08-17 brainstorm

1. **Analytics IA: one page, three bands** (performance → posts & audience → spend), one scroll. Per-post detail stays at `/analytics/:postId`.
2. **Analytics spine = Plausible; Planner spine = Buffer agenda stream** (user picked "A for both" from captured candidates; Fathom, Notion Calendar, Typefully, and keep-the-hybrid were the rejected candidates).
3. **Planner keeps the queue rail and the mini-month**; only the week day-lanes die, replaced by the stream.
4. **KPI strip: 3 daily tabs + 2 context stats.** Tabs (chart-driving): impressions, engagements, new followers. Context (non-tab): engagement rate, followers total. Only daily-grain metrics get a time series — honest to the data grains.
5. **Ranges: 7d / 28d / 90d / all time, default 28.** No custom date picker. "all time" exists because imports start 2026-05 and 90d already misses history.
6. **Post detail gets the full Plausible-style rebuild** on the canonical model, including that post's production cost.
7. **Scope: everything folds in** — the 10 phase-3 deferrals, the user-visible phase-2 leftovers (§5), and a per-page audit pass over the remaining pages. Out: pricing-model rework (codex single-token totals stay a recorded display caveat), structural rework of Workspace/canvas layouts.
8. Spend is display-estimate from `settings.pricing`, never billing truth (standing rule).

## 1. Analytics page (`pages/Analytics.tsx`, route `/analytics`)

Reference anatomy (Plausible): sticky-light one-column page; KPI strip where each stat is a tab (active = darker text + underline) and clicking swaps the single big area/line chart below; date-range control top-right; below the chart, symmetric two-column paper panels, each a tab group over a top-N list; each list row has a value right-aligned and a tinted horizontal bar-fill behind the row proportional to the value; everything is a list or one chart — no gauges, no donuts.

### Header

- Bench `PageHeader`: lowercase headline (keep "the numbers"), hairline under.
- Right cluster: range pills `7d / 28d / 90d / all time` (active = solid ink pill, same pill grammar as Overview's window pills; the compact labels are a recorded adaptation — four pills don't fit Overview's "last 28 days" wording) + an **import pill** (`↑ import export`, ghost pill wrapping the file input). The current upload Panel dies; after an import, the result/warning line renders under the hairline in soft text. Import shapes (already-imported / linked / account-wide / unlinked) keep their current voice.

### Band 1 — performance (paper panel)

- KPI strip: `impressions`, `engagements`, `new followers` as tabs — active tab ink + 2px ink underline, inactive soft; each shows the window total (new followers as `+N`). Right-aligned context stats: `engagement rate` (engagements ÷ impressions, `—` when impressions 0) and `followers total` (latest snapshot with `as of <date>` sub-line, `—` + "no snapshot yet" when none).
- One chart: daily series of the active tab across the range. Hand-rolled SVG (no chart library, per Bench flatness): 1.5px ink line, mint area fill at low opacity, 2–3 hairline gridlines, soft tick labels (start / mid / end dates, year included when the range crosses a year boundary). Hover: nearest-point dot (salmon) + value/date readout.
- **Gaps, not zeros:** days with no imported rows render as line breaks (`null` segments), not zero dips — absence of data and zero are distinguishable at this grain and must render differently. (This is the page-level analogue of Overview's `daysWithData` rule.)
- Empty range → the band renders the hairline-bordered empty state, same voice as Overview ("no analytics in this window — import an export").

### Band 2 — posts & audience (two paper panels, ~55/45)

- **Posts panel.** Tabs: `top posts` (by best-known impressions) / `recent` (by published date). Rows: title (or `urn:…` for unlinked imports) · impressions value · mint bar-fill behind the row scaled to the max. Wide viewports add er % and `+followers` columns. Linked rows click through to `/analytics/:postId`; **unlinked rows show an `attach` affordance** opening a small picker of unmatched app posts (→ §6 link endpoint). Every post the exports know appears — `dim_post` is the source, not `posts`.
- **Grain rule (wave finding, verified against the dev DB — 12 of 14 `dim_post` rows have only window-grain facts):** posts with lifetime facts show the latest lifetime impressions; posts seeded only by the aggregate top-posts sheet fall back to their MAX `fact_window_metric` impressions and carry a soft `window` tag on the value. Sort by best-known impressions across both. Derived stats (er, `+followers`) render `—` for window-only rows — never derived across grains. `fact_window_metric` is otherwise out of scope for this page.
- **Audience panel.** One tab per demographics dimension (seniority / location / industry / title / company size / company — the 6 canonical dimensions), latest account-level snapshot, `as of <date>` shown. Rows: segment · stored value rendered with its stored unit (percent strings stay percents — never re-derived). Mint fills.
- Either panel without data → panel-level empty state; the other still renders.

### Band 3 — spend (paper panel)

- Stat row: `est. spend` (window) · `runs` (count) · `est. cost per published post` (spend ÷ posts published in window, `—` when none). Soft right-aligned caveat: "estimates from settings.pricing — display only".
- Two columns: **spend by run kind** (salmon fills, per `run_kind`, window) and **cost vs return** (measured posts: title + est. cost left, lifetime impressions right, mint fill scaled by impressions-per-dollar — the "was it worth it" list; only posts with both cost and impressions).
- Spend always has data (runs are local); no import-gated empty state, just "no runs in this window" when empty.
- **Hue rule, page-wide: mint = LinkedIn performance, salmon = internal spend.** Never mixed within a band.

## 2. Post detail (`pages/PostAnalytics.tsx`, route `/analytics/:postId`)

- Header: lowercase headline (post hook slice), sub: published date/time + tier pill + link to workspace and to the LinkedIn URL.
- Stat strip (lifetime, latest snapshot): impressions · members reached · reactions/comments/reposts · saves · profile views · followers gained — whichever exist; absent metrics render `—`, never 0. Video metrics appear only when present.
- **Snapshot series:** when ≥2 `as_of_date` captures exist, a small multi-point line (impressions over capture dates) replaces the current text list — the "how it aged" view. One capture → no chart, no fake series.
- Demographics: this post's segments as tabbed bar-fill lists (same grammar as the page's audience panel), `as of` shown.
- **Production cost:** this post's runs (kind, engine, est. cost each, total) as a compact salmon bar-fill list. Same display-only caveat.

## 3. Planner (`pages/Planner.tsx` + `ui/planner/*`)

Reference anatomy (Buffer): vertical chronological feed; each date a bold day header; under it, that day's post cards (time label left) and slim "+ new" slot rows; scheduling happens on the row, no month grid in the primary view.

### Layout

- **Main column — agenda stream.** Continuous day-by-day feed, **today first** (2px hairline + salmon `today` pill on its header), scrolling forward. Past days render collapsed (header + cards, no slot rows). Each future/today day group: hairline-topped header (`mon aug 17`, lowercase) + scheduled-post cards + one dashed **"+ schedule a post here"** slot row.
- **Stream range semantics (wave finding, pinned):** initial load = today → today+27 days, plus the count of earlier posts — published history (by settings-zone published day) AND missed still-scheduled posts (user decision 2026-08-17); the stream renders with today's group at the top (no past DOM above it initially). A **"show earlier · N posts"** row above today loads the previous 28-day chunk and prepends it (repeatable). A mini-month click inside the loaded range scrolls to that day; outside it, the stream refetches anchored on that day's 28-day window and re-renders (same "show earlier" affordance in both directions). Empty days in a loaded range always render their header + slot row (future) or nothing (past, no posts).
- Post card: time pill (`09:30`) or dashed `no time` pill · title · the existing 4-tick stage meter · status word in soft. Card actions: click → workspace; inline controls to edit time and unschedule (confirm-less, it's reversible).
- Slot row click → assign popover: list of unscheduled posts + optional time field; picking one schedules it to that day (existing schedule endpoint). The existing `schedule-popover` is rebuilt to serve both this and the queue's `schedule` button (which adds a date field).
- **Right rail:** mini-month (kept) — lowercase weekday initials, scheduled days marked (ink dot/underline), today solid-ink; click a day → stream scrolls/jumps to it; month arrows page the calendar without touching the stream until a day is clicked. Below: **unscheduled queue** (kept) — cards with title + `schedule` pill; weekly-goal nudge renders at the rail bottom only when a goal is set and the week is short (current nudge logic, restyled).
- Drag-and-drop from queue to a day group stays as the enhancement it is today; click-first is the contract.
- Week day-lanes (`day-lane.tsx`) die. `mini-month.tsx` and the queue rail are restyled, not restructured.

### Data

- **The endpoint being changed is `GET /planner?date=`** (`planning.controller.ts` — there is no standalone scheduled-posts endpoint; it returns a combined payload). It gains optional `from`/`to` (ISO dates, settings-zone day boundaries, inclusive): when present, the `days` portion covers that range instead of the derived week, and the payload adds `earlierCount` (posts before `from`: missed still-scheduled ones plus published history by settings-zone published day — user decision 2026-08-17). `queue`, `goal`/streak, and the mini-month month data keep their current shapes; `date` alone keeps its exact current behavior until the web flips over, then the week-shaped variant can drop. Response contract to be written out verbatim in the plan's slice.

## 4. Remaining pages — audit pass

Scope: `PostsIndex`, `Backlog`, `RunsLog`, `SettingsPage`, `Playbook`, `Workspace`, `ImagePanel` (+ `ui/run-detail`, `ui/run-console`, `ui/canvas-editor`, `ui/lightbox`, `ui/selection-refine`, `ui/hashtag-editor` as their surfaces). Per page, five checks — fix what fails, no structural rework. **Completion evidence (wave finding): each page's audit slice returns the filled 5×2 checklist (five checks × light/dark) with a pass/fixed/n-a verdict and the fix commit per cell — the verifier maps checklist to evidence; an unfilled cell is an incomplete slice, not a pass.**

1. **Dark-theme audit** (phase 3 only audited shell + Overview).
2. **Figure/ground** — toolbar/filter strips separated from the page ground (§5 item 1 pattern); no two adjacent surfaces sharing a token without a hairline.
3. **Status colors** — success = mint, failure = salmon, warnings = soft (phase-3 spec §6 rule), applied at the flattened call sites (§5 item 7) and anywhere else the audit finds.
4. **Affordance consistency** — interactive = pill grammar or explicit hover state; no link-styled dead text; disabled states legible in both themes.
5. **Empty-state voice** — lowercase, hairline-bordered, one sentence, action named when one exists.

## 5. The deferred list — dispositions (all fold in)

Phase-3 deferrals (HANDOFF numbering):

1. Lost `cream`/`sand` tint → filter/toolbar rows become **paper strips with hairline border** (RunsLog, PostsIndex; audit finds the rest). No third neutral returns.
2. Dark-scrim inversions → `canvas-editor.tsx:301`, `run-console.tsx:151`, `Playbook.tsx:98`, `lightbox.tsx:17` switch `bg-ink` → `bg-hero` (dark in both themes; text inside is already `text-bone`-family).
3. Tier pills **stay uppercase**; recorded rule: data codes (T1/T2/T3, urn fragments, run ids) are exempt from the lowercase style — only UI copy lowercases.
4. `/posts` excerpts get a real ellipsis.
5. Status dots re-differentiated within the 2-hue palette by fill, not hue: `queued` = ink-outlined hollow dot · `drafting` = salmon + pulse · `draft_ready` = solid salmon · `approved` = mint · `published`/`measured` = solid ink. (Fixes the invisible `queued` and the pulse-only distinction.)
6. `WarnBanner` drops the hard-coded "heads up" lead word entirely; no separator needed once it's gone.
7. Success/failure emphasis restored (mint/salmon) at `SettingsPage.tsx:184,312`, `Playbook.tsx:131`, `run-detail.tsx:69`.
8. `Workspace.tsx:93` dead `backdrop-blur` removed.
9. `app/api/test/analytics-overview.spec.ts` made hermetic — the test "an empty window returns zeros with daysWithData 0 and a null followersTotal" gets its own scoped fixture/cleanup instead of relying on other specs' leftovers (cite by title, not line — the HANDOFF line number was drifted).
10. `fmtNum` rounds to integers (display); Overview `range()` includes the year when the window crosses a year boundary (rule shared with the new Analytics chart ticks).

Phase-2 leftovers folding in: **attach affordance** for unlinked imports (§1 band 2 + §6 link endpoint) · `alreadyImported`/`linkedPostId` — **already fixed on main** by `healLink` (verified this session; HANDOFF.md's "unchanged" claim was stale): this item shrinks to a regression test only · `parseDuration` hours-token fix · migrations `0002`/`0003` fixed to apply on a brand-new empty DB — note the failure is CROSS-file: the migrator applies pending migrations in one transaction, so 0003's use of the enum value 0002 adds is the break; fix by text-casting 0003's enum references (`kind::text = 'image_brief'`) or removing 0002's `ADD VALUE`, and prove it with a fresh-schema apply test (existing DBs unaffected — applied migrations are skipped) · top-posts queries guard against two `dim_post` rows sharing a `post_id` (group or dedupe — no double rows in the UI).

Explicitly staying out: pricing-model rework (codex single-token totals remain a display caveat, noted in band 3), `dim_post` backfill re-keying, Workspace/canvas structural changes, custom date pickers.

## 6. Data / API

### New: `GET /analytics/board?range=7|28|90|all` (default 28)

One read-only aggregate powering the whole page. Lives beside `overview()` in `analytics.service.ts`; same São Paulo day pinning (deliberately the ingestion zone — do not "fix" onto the settings zone); invalid `range` → 400 (unit-tested).

```jsonc
{
  "range": "28",                       // echo; "all" spans first imported date → today
  "start": "2026-07-21", "end": "2026-08-17",
  "series": [ { "date": "2026-07-21", "impressions": 0, "engagements": 0, "followersNew": 0 } ],
  //           ONLY days having ≥1 imported row appear — the web renders missing days as gaps
  "totals": { "impressions": 0, "engagements": 0, "followersNew": 0, "postsPublished": 0 },
  "followersTotal": { "value": 0, "asOf": "2026-08-10" },        // or null
  "posts": [ { "postUrn": "…", "postId": 4, "title": "…", "linkedinUrl": "…",
               "publishedAt": "…", "grain": "lifetime",           // or "window" (§1 grain rule)
               "impressions": 0, "engagements": 0, "er": 0,       // er/engagements/followsGained null when grain=window
               "followsGained": 0 } ],                            // postId/title null when unlinked
  "audience": { "asOf": "2026-08-08",
                "dimensions": [ { "dimension": "seniority",
                                  "segments": [ { "segment": "senior", "value": 43, "unit": "percent" } ] } ] }, // or null
  "spend": { "total": 0, "runs": 0, "perPublishedPost": 0,        // perPublishedPost null when none
             "byKind": [ { "kind": "draft", "total": 0 } ],
             "byPost": [ { "postId": 4, "title": "…", "cost": 0, "impressions": 0 } ] }
}
```

- `posts`: per `dim_post`, latest lifetime snapshot per metric; includes unlinked rows; deduped per app post (§5 guard). Sort client-side for top/recent tabs.
- `audience`: account-level (`post_urn IS NULL`) segments at the greatest `as_of_date`; values verbatim with their `unit`.
- `spend`: runs with `started_at` in range, cost via the existing `shared/pricing.ts` estimator; `byPost` joins runs → posts → lifetime impressions, only rows having both.
- `range=all`: start = MIN across the fact tables' first date AND the first run's `started_at` day (wave finding: runs predate/outlive imports — spend history must not be silently clipped). Empty DB → today; everything zero/empty and the UI shows empty states.

### Extended: `GET /analytics/posts/:postId`

Response reshaped for §2: lifetime metrics (latest + per-`as_of_date` series), this post's demographics segments, and its runs' costs (kind, engine, est. cost). The old `analyticsSnapshots`-shaped payload and `useSnapshots` hook die with the page rebuild.

**Scope boundary (wave finding, verified):** only the HTTP payload and the web hook die. `latestByPost()`, `countMeasuredSince()`, and the `SnapshotRow` pivot behind them **stay** — they feed `drafting.service.ts:158`, `retro.service.ts:49,61`, and `planning.service.ts:166`, none of which this phase touches. The `SnapshotRow` docstring's "phase 4 retires it along with the pivot" claim is corrected in this slice; porting those consumers onto direct canonical queries is explicitly out of scope.

### New: `POST /analytics/link { postUrn, postId }`

Sets `dim_post.post_id` (validating the app post exists and is not already linked to another urn — 409 otherwise). Marks the post measured if lifetime facts exist, mirroring import behavior.

### Planner

`GET` for scheduled posts generalizes to `?from=&to=` (defaults preserving current behavior). No schema changes anywhere in this phase.

## 7. Verification

| Gate | Command / probe |
|---|---|
| Types + lint | `cd app/api && npm run typecheck` · `cd app/web && npm run typecheck && npm run lint` |
| API unit | vitest: board aggregation (range math incl. `all` and 400s, `all` lower bound covers runs predating imports, series presence-only days, followersTotal latest-wins, audience latest-snapshot, spend totals/byKind/byPost, dim_post dedupe guard, **grain fallback: window-only posts get max-window impressions + `window` tag, `—` derived stats, correct mixed sort**), post-detail reshape, link endpoint (happy, missing post, already-linked 409), planner `from`/`to` + `earlierCount`, parseDuration hours, migrations on empty DB (fresh-schema apply test), alreadyImported/healLink regression |
| Browser smoke | `route-smoke.mjs` extended — Analytics: KPI tab click swaps the chart and fires `/analytics/board?range=`, range pills render, import pill present, posts panel renders rows or empty state; Planner: today header renders, "+ schedule" opens the assign popover (and closes clean), queue rail + mini-month render; post detail `/analytics/1` renders stat strip. Mutations: **post #5 only**, restored, settled handlers attached at creation (phase-3 probe traps apply). Dark probe (respecified per wave finding — run-console and Playbook's live block only mount during a live engine run, which the smoke must never start): `data-theme=dark` set, assert computed dark backgrounds on **lightbox and canvas-editor** (reachable read-only); run-console and the Playbook live block are covered by a grep gate (zero `bg-ink` at the four §5-item-2 sites) since all four share the same `bg-hero` token the probed pair exercises |
| Design tells | `check-design-tells.sh` passes with no acknowledged overrides |
| Figure/ground | every palette-touching slice ends with reading the rendered page (phase-3 lesson: greps and smokes are structurally blind to this class) |
| Risk-gated manual | computer-use pass on planner assign/drag + analytics tab/range flows before batch-done; user's own pass is final acceptance |

Port trap carries forward: verify `<title>` is forge before trusting any probe (built into route-smoke; local 5174 workaround per HANDOFF).

## 8. Absence list (in the references, kept out — or absent and staying absent)

Plausible's live-visitors badge and map (no data source; map is also off-grammar) · Plausible's funnels/goals machinery · Buffer's multi-channel icons and per-network tabs (forge has one channel) · Buffer's "best time to post" suggestions (no data) · any donut/gauge/radial chart (off both spines) · chart libraries (hand-rolled SVG only, per phase 3) · dark hero band on Analytics (Overview-exclusive, recorded decision) · custom date pickers · eyebrow labels, numbered markers, accent rails, drop shadows, gradients (Bench absences, unchanged).

## 9. Risks and notes for the plan

- **Sparse dev data**: the only import window ends 2026-08-08, so 7d/28d ranges will often be empty — empty states and the gaps-not-zeros chart rule are load-bearing; acceptance tests must cover them, not just happy paths. `range=all` is the only range guaranteed to show the imported window.
- **The chart is the one genuinely novel component** (hover readout, gap segments, tick/year rules) — candidate for a verbatim-shape contract in the plan; everything else composes existing grammar.
- The Analytics rebuild deletes `trends()`/`useTrends`/`drift.ts` usage — sweep for orphans (`geoMix`/`seniorityMix`, `StatTile`/`BarRow` call sites that die) rather than leaving dead exports.
- Planner rebuild must preserve the phase-1 scheduling contracts (free-form date + optional time, publish clears schedule) — this phase is layout, not scheduling semantics.
- Spend `byPost` joins across grains (runs per app post vs lifetime impressions per urn) — the dedupe guard (§5) matters here or costs double-count.
- The audit pass (§4) is judgment work across many files — slice it per page with the checklist as acceptance criteria, distinct from the mechanical deferral fixes (§5), which are enumerable editor-rung work.
