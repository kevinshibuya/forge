# The four-phase overhaul — roadmap and standing context

> **All four phases are merged as of 2026-08-22.** This document is now historical context, not a plan. Leftovers that outlived the roadmap live in `HANDOFF.md`.

**Date:** 2026-08-10. **Purpose:** this work spans multiple sessions. This doc carries the user's original directions, every decision made in the 2026-08-10 brainstorm, and the discoveries (real export structures, reference anatomies) that later phases need. A fresh session should be able to start any phase from this doc + that phase's spec alone.

## The user's original directions (2026-08-08, verbatim intent)

1. **Kill "3 posts per week".** The forge week was stale ("week of 2026-08-03" shown when that week was over). But the fix is not a better week pointer — the user wants to "completely change this logic": full control of when and how many posts per week, with "really good UX calendar navigation for both the dashboard and the planner pages".
2. **Dashboard becomes "Overview"**, restructured completely, aiming at this reference: https://cdn.dribbble.com/userupload/3348979/file/original-13fd7647b443fb9c7f49aad6378573ac.png (anatomy transcribed below; the saved screenshot is not kept in the repo).
3. **Complete UX/UI overhaul of the whole project**, based on the artifact the user liked: https://claude.ai/code/artifact/ebcb3667-cf79-4e22-9aa3-4fa18facee83 ("Bench — studio hours"; anatomy transcribed below).
4. **Analytics page changes completely**, based on (a) the "LinkedIn Analytics — Local Export Ingestion" design notes (reproduced in full below — they are the phase-2 contract), plus (b) the spend/cost data the app now has (runs + `settings.pricing`, shipped in PR #4). Real export files were explored this session; structures below. Goal: "best-in-class UX for data viz".

The user chose the phase order interactively: **data first** (initially picked "design first", then reversed — data first is the settled decision).

## Phases

| # | Phase | Spec | Status |
|---|---|---|---|
| 1 | Scheduling model — free-form per-post scheduling, hybrid Planner calendar | `2026-08-10-scheduling-model-design.md` | **DONE** — 8 slices executed, reviewed (opus xhigh + codex), 6 findings fixed; PR #5 merged 2026-08-10 @ `0948875` |
| 2 | Analytics ingestion — canonical two-grain model, both export types | `2026-08-11-analytics-ingestion-design.md` | **DONE** — PR #6 merged 2026-08-16 @ `4c6f731` |
| 3 | Design system + shell + Overview — Bench language app-wide, Overview per Dribbble anatomy | `2026-08-16-design-system-shell-overview-design.md` | **DONE** — 8 slices, reviewed (opus xhigh + codex), 1 blocker + 6 should-fix fixed, 3 motion refinements; PR #7 merged 2026-08-17 @ `1ee0fb5` |
| 4 | Planner/Analytics reskin + remaining-pages sweep + analytics data viz | `2026-08-17-planner-analytics-reskin-design.md` | **DONE** — 13 slices, reviewed (opus xhigh + codex), 9 findings fixed; PR #8 merged 2026-08-22 @ `e53c83f` |

Each phase: brainstorm (main session) → spec → three-leg spec/plan review wave (opus + fable + codex — codex was explicitly re-opened by the user for review legs this session) → ONE consolidated fix pass → plan → fresh-session execution on opus. Standing rules in `~/.claude/CLAUDE.md` and `HANDOFF.md` apply (never merge/push main without per-action permission; sacrificial post #5 only; reviews are user-triggered).

## Decisions locked in the 2026-08-10 brainstorm (apply beyond phase 1)

- Scheduling: free-form per-post date + optional time; optional weekly goal (published-only, `publishedAt IS NOT NULL`) + streak on top; queue nudges. Cadence/slots/tier-warnings/publish-window die.
- Planner: hybrid layout — mini-month navigator + selected-week day lanes + unscheduled-queue rail; click-first assignment, drag as enhancement.
- Dashboard gets only a minimal phase-1 touch (upcoming list); the real rebuild is phase 3 as "Overview".
- Phase 3 design authority: **Bench artifact = app-wide visual language; Dribbble shot = Overview page structure** (spine), per the design-from-references discipline — never average the two.

## Reference anatomy — "Bench — studio hours" artifact (app-wide language, phase 3)

Fetch the artifact URL above for the full HTML. Load-bearing tokens and grammar:

- Palette (light): bone `#E7ECEA` background, ink `#0A0B0A`, soft gray-green `#55605B`, salmon `#EE9375`, mint `#90DE9D`, paper `#FFFFFF`. Dark: bone→`#0E100F`, ink→`#E7ECEA`, soft→`#9BA5A0`, hairline `#3A423E`.
- Type: grotesk stack ("Helvetica Neue", Helvetica, Arial); huge tight headlines (`clamp(2.9rem,6.4vw,5.6rem)`, weight 700, line-height 0.95, letter-spacing −0.033em); body 15–16px; soft color for secondary text.
- Grammar: 1px ink hairline separators (not gray borders); pill-shaped buttons/controls (border-radius 100px); circular ink mark; flat geometric SVG illustration (ink outlines + salmon/mint fills); a working light/dark toggle (`data-theme` attr + `prefers-color-scheme` default); generous whitespace, max-width 1400px page.

## Reference anatomy — Dribbble "Vulnerability overview" (Overview page spine, phase 3)

- Icon-only white left sidebar, ~72px: logo mark top, 6 nav icons, notification + avatar bottom.
- **Dark hero band** spanning the content width: page title top-left (large, lowercase-friendly); top-right time-range pill group ("last week / last month / last year" + "select date" with calendar icon).
- Hero band left column: labeled horizontal comparison bars (two series diverging from a center axis, values at bar ends); below it a grouped mini bar chart by weekday.
- Hero band right column: titled 2×2 stat-card grid inside a slightly lighter panel — each card: small icon, huge number, label, hairline divider, one sub-metric row ("domains: 48").
- **Light lower band**, 3 columns: (1) big-number quartet in a 2×2 grid with hairline dividers ("62 generated / 53 processed / …"); (2) list of items each with a segmented tick-meter + one CTA button; (3) labeled percent progress bars ("low 20% / medium 50% / critical 12%").
- Adaptation note: replace its purple/teal/orange accents with Bench salmon/mint; the dark band uses Bench dark-bone/ink, not pure black.

## Phase-2 contract — "LinkedIn Analytics — Local Export Ingestion" design notes (2026-08-08, verbatim)

### Why this shape (so future-me doesn't re-litigate it)

- An official API exists: `memberCreatorPostAnalytics` + `memberFollowersCount` (Community Management API, `api.linkedin.com/rest/`, header `Linkedin-Version: YYYYMM`). Gated behind: registered legal org, commercial use case only, business email (personal emails fail vetting), app verified by a super admin of the org's LinkedIn Page, then Dev tier → Standard tier w/ narrated screencast. Not viable for a solo personal project.
- Automating the export button is out. UA §8.2 bans "bots or other unauthorized automated methods to access the Services" and explicitly names "browser plugins and add-ons". Owning the data is irrelevant — the clause governs *access method*. Contract breach, not a crime (cf. hiQ v. LinkedIn: won on CFAA, lost on breach of UA). Consequence = ban on the exact account holding the history.
- "Get a copy of your data" archive has NO analytics. `Reactions.csv`/`Comments.csv` are what *you gave others*. No impressions, no reach, no demographics.
- => Human clicks export (~1 min/week). Everything after the file hits disk is automated. Zero ToS surface.

### Sources — what to click, what comes out

| Page | Gives |
|---|---|
| `/analytics/creator/content/` | post performance over selected window |
| `/analytics/creator/audience/` | follower count + demographics — **only** source, no API equivalent |
| `/analytics/post-summary/urn:li:activity:N/` | single-post lifetime detail |
| `/dashboard/` | profile views, search appearances |

Format is `.xlsx`, multi-sheet. **UI filters change file contents** — record which filter + date range was applied at download time (filename won't tell you).

### Step 0 — before writing any parser

Do not code against remembered column names. LinkedIn renames headers/sheets without notice and the shape differs per page and per selected filter. Dump sheet names + first rows of every export before parsing (a working ExcelJS dump script from this session is reproducible in ~30 lines; `pandas.ExcelFile` equivalent in the original notes). Commit a redacted sample of each export type as a test fixture.

### Pipeline

```
watch ~/Downloads (chokidar / watchdog)
  → settle: size stable across 2 polls (dodges partial .crdownload / .part)
  → classify by SHEET-NAME SIGNATURE, not filename (filenames are inconsistent + localized)
  → parse → canonical rows
  → upsert
  → archive raw to raw/<sha256>.xlsx   # never delete
```

Keep every raw file forever. First-pass parsers will be wrong; you'll want to replay.

### Canonical model — two grains, never mix them

```
dim_post(post_urn PK, activity_urn, share_urn, published_at, text, format)
fact_post_metric(post_urn, metric, date, value, source_file_id)      -- daily grain
fact_post_lifetime(post_urn, metric, value, as_of_date, source_file_id) -- snapshot grain
fact_profile_metric(metric, date, value)          -- followers, profile views, search appearances
fact_audience_segment(dimension, value, count, unit, as_of_date)  -- snapshot ONLY, never daily
```

### Idempotency

- PK `(post_urn, metric, date)`. Re-importing an overlapping export = no-op, not a duplicate.
- Exports overlap by design — you'll re-pull "last 28 days" every week.
- Same day can differ between exports; LinkedIn backfills and corrects. Go last-write-wins (simple), and rely on retained raw files to recover history if ever needed.
- Hash file → skip if already ingested; keep a `--force` flag for reparse after parser fixes.

### Gotchas

- **URN types.** UI URL gives `urn:li:activity:N`. API/exports use `ugcPost` or `share`. The numeric part is not always the same across types. Store all three, key on one canonical.
- **Lifetime vs windowed.** "Impressions" on post-summary = lifetime-to-date. Same word on the content export = within the selected window. This is the #1 way to silently corrupt the set.
- **Demographics may be % not counts** depending on the sheet — store raw value + `unit` column, never pre-convert.
- **No timezone in exports.** Assume account-locale day boundary, record the assumption, don't shift.
- **Deleted posts vanish** from later exports. Absence ≠ delete. Never cascade-delete on missing.
- **Search appearances are weekly**, not daily. Don't force it into the daily grain.

### If API access ever opens

Ingest layer unchanged — write an adapter emitting the same canonical rows from `memberCreatorPostAnalytics` (`q=me`, `aggregation=DAILY`, dateRange) and `memberFollowersCount`. Note `DAILY` is unsupported for `MEMBERS_REACHED`, `LINK_CLICKS`, `FOLLOWER_GAINED_FROM_CONTENT`, `PROFILE_VIEW_FROM_CONTENT`. And the API still has **no** audience demographics for members — the manual audience export stays required either way.

Docs: learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics

## Discovered: the REAL export structures (dumped 2026-08-10 from the user's files)

Files explored (in `~/Downloads`; account locale **pt-BR** — all sheet names and labels are Portuguese):

- `AggregateAnalytics_<name>_2026-05-11_2026-08-08.xlsx` — filename carries the selected date range.
- `SinglePostAnalytics_<name>_9990000000000000105.xlsx` — filename carries the activity URN id.
- `SinglePostAnalytics_<name>_9990000000000000106 (1).xlsx` and `(2)` — SAME post captured twice; impressions differ by a handful. Perfect real-world idempotency/last-write-wins test pair.

### AggregateAnalytics — 5 sheets

| Sheet | Shape |
|---|---|
| `Descoberta` | 3 rows, label/value: period header ("Desempenho geral" + "11/05/2026 - 08/08/2026"), Impressões total, Usuários alcançados total |
| `Engajamento` | header `Data \| Impressões \| Engajamentos`, then one row per day (window grain, daily) |
| `Publicações mais em alta` | r1 note ("Máximo de 50 publicações…"), r2 blank, r3 headers of TWO side-by-side tables sharing the sheet: cols A-C = top by Engajamentos (URL, Data de publicação, Engajamentos), cols E-G = top by Impressões. Row counts differ per table (blank cells pad the shorter) |
| `Seguidores` | r1 = `Total de seguidores em <date> \| <n>` (snapshot!), r2 blank, r3 headers `Data \| Novos seguidores`, then daily rows |
| `Dados demográficos` | header `Principais dados demográficos \| Valor \| Porcentagem`; rows grouped by dimension label in col A: Empresa, Localidade, Tamanho da empresa, Nível de experiência, Setor, Cargo; values are PERCENT strings ("43%", "menos de 1%" possible) |

### SinglePostAnalytics — 1 sheet `Análise da publicação`, label/value rows (lifetime snapshot grain)

- Header block: `URL da publicação`, `Data da publicação` (dd/mm/yyyy), `Hora da publicação` (HH:mm).
- Section headers as label rows with empty value: `Descoberta` (Impressões, Usuários alcançados), **`Desempenho do vídeo` — present ONLY for video posts** (Visualizações de vídeo, Tempo de visualização "20 min15 seg", Tempo médio de visualização "11 seg"), `Atividades do perfil` (Visualizações do perfil…, Seguidores obtidos…), `Engajamento` (Reações, comments, reposts, Salvamentos…), then demographics: `<dimension> | <value> | <percent>` rows (same 6 dimensions as aggregate).
- Row count varies by post type (41 rows video post vs 56 non-video with fuller demographics) — **parse by label, never by row position**. "Reações" repeats for sub-breakdowns; first occurrence wins (existing parser convention).

### Existing code phase 2 must reckon with

- `app/api/src/analytics/xlsx-parser.ts` — ExcelJS parser for the SINGLE-POST pt-BR export only, with `CATEGORY_MAP` for the 6 demographic dimensions, "menos de 1%" → 0.5 handling, first-occurrence-wins label lookup, São Paulo zone. Feeds flat `analyticsSnapshots` rows (`analytics.service.ts` saves raw file to `uploads/analytics/`, marks post measured). The canonical model supersedes `analyticsSnapshots` — migration/coexistence is a phase-2 spec decision. No aggregate-export parser exists yet.
- Spend/cost data for the analytics page: `runs`/`run_steps` + `settings.pricing`, estimated at read time (`GET /runs/:id`, `shared/src/pricing.ts`). Known deferred issue: codex single-token-total pricing (HANDOFF.md #1).
- `posts` link to LinkedIn via `linkedinUrl`; analytics import matches by URL (`findByUrl`) — URN↔post mapping for the canonical `dim_post` is a phase-2 decision.

## Session discoveries that saved future work (don't re-derive)

- The three-leg spec review found the phase-1 spec's biggest trap: `posts.scheduled_slot` already stores schedules with a full read/write surface — always sweep for existing state before claiming "no migration needed".
- Web is EXCLUDED from the root `typecheck`/`test` scripts (`app/package.json`) — any gate must add `cd app/web && npm run typecheck && npm run lint` explicitly.
- `new Date('YYYY-MM-DD')` renders a day early in São Paulo — bare dates need a calendar-parts formatter (`lib/format.ts` trap).
- ~~No standing browser-smoke harness exists~~ — phase 1 authored one: `app/api/scripts/route-smoke.mjs` (routes render, zero console errors, plus a date-placement probe). Extend it rather than writing ad-hoc scripts. It mutates post #5 only and restores it.
- Visual companion mockups from this brainstorm persist in `.superpowers/brainstorm/63300-1786406189/content/` (calendar layout options; user picked C, the hybrid).
