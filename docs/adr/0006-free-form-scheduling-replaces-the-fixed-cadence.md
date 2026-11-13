# Free-form per-post scheduling replaces the fixed weekly cadence

The app originally hardcoded "3 posts per week on Mon/Wed/Fri", and every planning surface derived from it: week slots, streak, tier-mix warnings, off-cadence flags. A stale week pointer on the dashboard exposed the model rather than a bug in it, so instead of fixing the pointer we replaced the model. Posts now carry a `scheduled_date` plus an optional `scheduled_time`; cadence, week slots, the publish window, off-cadence and tier warnings were removed outright.

Source: `docs/superpowers/specs/2026-08-10-scheduling-model-design.md` (§Problem, §Decisions, §1 Data model); direction recorded verbatim in `docs/superpowers/specs/2026-08-10-overhaul-roadmap.md` (§The user's original directions, item 1).

## Consequences

- `posts.scheduled_slot` was dropped after backfilling the two new columns. Published posts got a null schedule on purpose — their plan is history and their record is `published_at`, which also keeps the seeded first post off the calendar.
- The weekly goal became optional and its predicate is `published_at IS NOT NULL`, so a post keeps counting toward the goal after analytics ingest promotes it to `measured`. Streak survives as "consecutive weeks meeting the goal".
- The schedule is a plan and a reminder. Publishing to LinkedIn stays a manual act.
- `cadence` still exists as a *playbook rule category*. That is a different concept and was not removed.

## Amended for v2 (2026-09-24)

The schedule stops being only a reminder. An `approved` Post with a date, a time and a live Connected account on its Platform is **Armed**, and forge publishes it at that time through ADR 0024's `publish_attempts`; a date without a time, or no live account, keeps the reminder meaning this ADR gave it, and the Workspace says which. Publishing by hand stays possible on any Post. A scheduled time is read in the Voice's time zone (a ghostwriter's clients live in different zones); stored times are UTC with the zone name beside them. Nothing else here moves: no cadence, no slots, the weekly goal counts `published_at`.
