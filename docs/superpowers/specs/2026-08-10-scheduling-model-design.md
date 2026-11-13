# Scheduling model — free-form per-post scheduling (phase 1 of 4)

**Date:** 2026-08-10
**Status:** approved in brainstorm; revised after the three-leg spec review (opus + fable + codex), 2026-08-10

## Roadmap context

**Full standing context for all four phases — the user's original directions, reference anatomies, the verbatim analytics-ingestion design notes, and the real export structures — lives in `2026-08-10-overhaul-roadmap.md`. Fresh sessions start there.**

This is phase 1 of a four-phase overhaul, decided in the 2026-08-10 brainstorm ("data first"):

1. **Scheduling model** (this spec) — kill the fixed cadence, per-post scheduling, hybrid calendar on the Planner.
2. **Analytics ingestion** — canonical two-grain model for LinkedIn xlsx exports (aggregate + single-post), per `# LinkedIn Analytics — Local Export Ingestion` design notes.
3. **Design system + shell + Overview** — app-wide visual language from the "Bench — studio hours" artifact (bone/ink, salmon+mint accents, grotesk, hairlines, pills, light/dark); Dashboard becomes "Overview" with the Dribbble vulnerability-dashboard anatomy as structural spine (dark hero band with time-range pills + stat cards, light lower band). The reference URL is in the roadmap.
4. **Planner/Analytics reskin + remaining-pages sweep + analytics viz** — apply the design system everywhere, best-in-class data viz on the new analytics data.

Each phase gets its own spec → plan → implementation cycle.

## Problem

The app hardcodes "3 posts per week on mon/wed/fri" (`settings.cadence`), and every planning surface derives from it: week slots, streak, tier warnings, off-cadence flags. The user wants full control over when and how many posts happen, with real calendar navigation. The stale "week of 2026-08-03" dashboard bug is a symptom of the same rigid model.

## Decisions (from brainstorm)

- **Free-form scheduling** with a per-post date + **optional** time. Publishing on LinkedIn stays manual; the schedule is a plan/reminder, not an auto-publisher.
- **Optional weekly goal** ("aim for N posts this week") set in settings, plus **queue nudges** when a visible week is empty.
- **Only published posts count toward the goal** — the predicate is `publishedAt IS NOT NULL`, so `measured` posts keep counting after analytics ingest. Streak survives as "consecutive weeks meeting the goal".
- Planner layout: **hybrid** — mini-month navigator + selected-week detail lanes + unscheduled-queue rail.
- Assignment UX: **click-first** (day popover ← queue; queue card → pick day); drag-and-drop is an enhancement after click-first works.
- Cadence, week slots, publish window, off-cadence, and tier warnings are **removed**.

## 1. Data model

### The column being replaced

Scheduling is ALREADY stored: `posts.scheduled_slot` (`timestamp with time zone`, `schema.ts:43`), written by `posts.create`, `patchMeta`, `ideas.promote`, and the seed; read by `scheduledBetween`, the planner assembly, and rendered in `Workspace.tsx:98` and `PostsIndex.tsx:37`. This spec replaces that column and its whole write/read surface (enumerated in §5).

### New columns

`posts` gains two nullable columns, and one drizzle migration handles the swap:

- `scheduled_date` (`date`) — the planned day, interpreted in the settings timezone.
- `scheduled_time` (`time`) — optional; null means "sometime that day".
- Backfill: for rows where `published_at IS NULL`, set `scheduled_date`/`scheduled_time` from `scheduled_slot AT TIME ZONE 'America/Sao_Paulo'`. Published posts get NULL schedule — their plan is history and their record is `published_at` (this also keeps seed post #1, whose `scheduled_slot` doubles as its publish timestamp, off the calendar as "scheduled").
- Then `scheduled_slot` is **dropped**.
- Drizzle note: use `date()`/`time()` in their default `mode: 'string'` (matches the `YYYY-MM-DD`/`HH:mm` contract; `{ mode: 'date' }` would reintroduce the timezone drift this design avoids). Both need importing in `schema.ts`.

Rationale for date+time as separate columns instead of one timestamp: the day is the unit the calendar operates on; a date column avoids timezone day-boundary drift entirely.

- Scheduling does **not** change `status`. `publishedAt` remains the record of what actually happened.
- Only unpublished posts (`publishedAt IS NULL`) are schedulable. Any date is allowed, past included. Multiple posts per day allowed.

### Settings

`settings.cadence` is replaced by:

```ts
scheduling: {
  timezone: string,        // IANA zone; rejected unless IANAZone.isValidZone() (luxon)
  weeklyGoal: number | null // default null; 1..7 when set
}
```

- Settings live in one jsonb row shallow-merged over defaults (`settings.service.ts:19`), so the timezone does NOT carry over by schema change alone. `SettingsService.get()` performs a one-shot read-time normalization: if the stored row has `cadence` and no `scheduling`, lift `cadence.timezone` into `scheduling.timezone` (weeklyGoal null) and persist; the stale `cadence` key is dropped by the schema parse.
- Changing `weeklyGoal` restates all history (streak recomputes against the current goal) — same philosophy as the pricing panel repricing all history. No per-week goal snapshots.
- `weeklyGoal: null` hides goal progress and streak everywhere.
- Phase-1 scope: **timezone is not editable in the UI** (the web formatters hardcode São Paulo; an editable-but-ignored setting would lie). The settings panel exposes weekly goal only; timezone editing waits until the formatters read it.

The playbook rule category `'cadence'` (`RuleCategorySchema` in `shared/src/content.ts`) is an unrelated content-rules taxonomy and is **not** touched.

## 2. API

### Placement rule (shared by week AND month)

A post with `publishedAt` set appears **only** on its published day (published-over-scheduled precedence). Unpublished scheduled posts appear on their scheduled day. This governs week lanes, month summaries, and mini-month tinting identically — one post never counts on two days.

### Post label

Posts have no title column. Every DTO below carries `title` derived server-side exactly as the existing UI does: `hook ?? bodyLinkedin ?? 'post #<id>'`, truncated to 80 chars.

**`GET /planner?date=YYYY-MM-DD`** (default: today in settings timezone) — one payload for the hybrid view:

- `month`: for the month containing `date`, per-day summaries `{ date, scheduled: n, published: n }` under the placement rule — feeds the mini-month tinting.
- `week`: the week (mon-start, as today — luxon ISO weeks) containing `date`: per-day lanes `{ date, posts: [{ id, title, tier, status, scheduledTime, publishedAt }] }`.
- `queue`: unpublished posts with no `scheduled_date`, **oldest first** (`createdAt` asc — a deliberate flip from `posts.list()`'s desc), same item shape minus the date fields.
- `goal`: `{ target, publishedInWeek } | null` — progress **for the selected week** (the rail label follows the selection: "this week" only when the selected week contains today).
- `streakWeeks`: always relative to **today**, independent of `date`; `null` when no goal. Semantics: consecutive weeks with published count ≥ goal, counting the in-progress week when it already meets the goal (preserves current `computeStreak` behavior), otherwise ending with the last complete week.

**`PATCH /posts/:id/schedule`** — two request shapes, discriminated:

- Schedule/reschedule: `{ date: 'YYYY-MM-DD', time?: 'HH:mm' }`. The request states the FULL schedule: omitted `time` means "no time" — it does not preserve a previously set time.
- Unschedule: `{ date: null }` — `time` must be absent (400 otherwise).
- 400 on published posts (`publishedAt` set) or invalid date/time; 404 on unknown post.
- This becomes the ONLY scheduling write path (see §5 for the two removed ones).

**`GET /dashboard`** drops `week` (slots) and `tierWarnings`; returns:

- `upcoming`: unpublished posts with `scheduled_date` ≥ today, ordered `scheduled_date` asc then `scheduled_time` asc with null times last, capped at 5. Items: `{ id, title, tier, status, scheduledDate, scheduledTime }`.
- `goal`: `{ target, publishedInWeek }` for the current week, and `streakWeeks` — same semantics as `/planner`.
- `pendingActions`: the `undrafted` kind is **redefined** (its old source was empty cadence slots, which no longer exist): emitted for posts with `scheduled_date` ≥ today whose status is `queued`/`drafting`, labeled `"「title」 scheduled <date>, not drafted"`. The other kinds (`ingest`, `untriaged`, `expiring`, `retro`) are unchanged.

## 3. Planner UI (hybrid layout)

Left rail:

- **Mini-month**: ‹ › month navigation, "today" snap-back, day cells tinted when they hold scheduled (accent) or published (green) posts, click a day to select its week.
- **Queue**: cards (title, tier, status) with a "schedule…" action opening a day/time picker.
- **Goal progress** (`publishedInWeek/target` for the selected week) when a goal is set.

Main panel:

- Selected week as **day lanes**. Each lane: date header + post cards showing title, tier, status pill, time (when set); published cards marked distinctly. Inline actions: reschedule, unschedule.
- Clicking a day lane opens a popover: pick a queue post + optional time.
- **Nudge**: when the visible week has nothing scheduled/published and the queue is non-empty, an inline banner suggests scheduling the oldest queue post (one-click to the popover).
- Drag-from-queue onto a day lane or mini-month cell: enhancement, built only after click-first passes verification.

**Date rendering:** bare `YYYY-MM-DD` payload dates must go through a date-only formatter that parses calendar parts directly — never `new Date('YYYY-MM-DD')`, which is UTC midnight and renders a day early in São Paulo (`fmtDay` in `lib/format.ts` has exactly this trap; today's Planner works around it with a hand-patched `T12:00:00Z`). Acceptance: a post scheduled for the 1st renders on the 1st.

Built with current styling primitives (`ui/primitives.tsx`); phase 3/4 reskins it.

## 4. Dashboard (minimal phase-1 touch)

- Week-slot widget → "upcoming" list (from `/dashboard.upcoming`).
- Streak tile: recomputed meaning ("weeks meeting your goal"); hidden when no goal.
- "This week" tile → goal progress; hidden when no goal.
- Tier-warning banners removed.

The full Overview rebuild is phase 3; this phase only stops the page lying.

## 5. Removals — the complete `scheduled_slot`/cadence surface

API:

- `weekSlots()`, cadence-based `computeStreak()`, `plannerWeek()`'s slot assembly (replaced by the new planner payload); `offCadence`, `tierWarnings`, publish-window defaulting.
- `scheduledSlot` in `PatchMetaSchema` (`posts.controller.ts:11`) — generic PATCH loses scheduling entirely; the schedule endpoint is the only write path.
- `scheduledSlot` in `POST /ideas/:id/promote` (`ideas.controller.ts`, `ideas.service.ts promote()`, `posts.create()`) — promoted ideas land in the queue unscheduled; scheduling happens on the calendar. (Backlog's UI never passed a slot, so nothing visual is lost.)
- `posts.scheduledBetween()` (rewritten against `scheduled_date`), seed's `scheduledSlot` usage (`seed.ts:61`).

Shared/web:

- `SettingsSchema.cadence` (`postsPerWeek`, `weekdays`, `publishWindow`; `timezone` moves to `scheduling.timezone`).
- `scheduledSlot` in `PostDto` (`api/client.ts:11`), `usePromoteIdea`'s `scheduledSlot` param (`hooks.ts:113`), Planner's `patch.mutate({ scheduledSlot })` calls.
- Workspace's `slot · …` pill (`Workspace.tsx:98`) and PostsIndex's scheduled column (`PostsIndex.tsx:37`) → both show `scheduledDate` (+ time when set) via the date-only formatter instead.
- Settings page **gains** a scheduling panel (weekly goal; see §1 for why timezone stays out) alongside pricing — note: there is no existing cadence panel to convert; this is net-new UI following the pricing panel's draft/validate/dirty pattern.

## 6. Verification

Unit/integration (api):

- Goal/streak math: goal met/missed/unset weeks, in-progress-week counting, week boundaries in São Paulo time, year/month boundaries.
- Planner payload assembly: placement rule (published-elsewhere case appears once, on the published day, in BOTH week and month), queue ordering, goal scoped to selected week.
- Schedule endpoint: published post → 400, bad date/time → 400, `time` with `date: null` → 400, reschedule-without-time clears time, unschedule.
- Settings normalization: stored `cadence` row lifts timezone into `scheduling`; invalid IANA zone rejected on update.

Known-breaking tests, rewritten (not patched) in one batch before Task 1 per the baseline-verify rule: `planning.service.spec.ts`, `test/planning.spec.ts`, `test/settings.spec.ts` (asserts `cadence.postsPerWeek`), `test/e2e-happy-path.spec.ts` (promotes with `scheduledSlot`, asserts `planner.slots` and numeric `streakWeeks`), `test/seed.spec.ts` + seed script.

Gate commands: the root `typecheck`/`test` scripts EXCLUDE web — the gate must explicitly include `cd app/web && npm run typecheck && npm run lint` (that's where the DTO breakage lands: Dashboard, Planner, PostsIndex, Workspace, client.ts).

Browser smoke: headless route smoke on `/` and `/planner` (loads, root renders, zero console errors) via the established ad-hoc playwright approach (playwright is a dependency of app/api; there is no standing smoke harness — the plan must include the script, as prior sessions did).

Manual (risk-gated, user-visible surface): schedule a queue post via day popover, reschedule it, unschedule it, navigate months, set a weekly goal in settings, confirm goal progress updates after marking a post published. Slice ordering: the settings panel must land before this pass (goal UI is invisible until a goal exists). Use sacrificial post #5 only.

## Non-goals (this phase)

- No visual redesign (phase 3/4). No analytics changes (phase 2/4). No auto-publishing to LinkedIn. No per-week goal history/snapshots. No drag-and-drop in the first implementation pass. No timezone editing in the UI (setting exists, stays São Paulo).
