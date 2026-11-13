# R16. Queue and scheduler for Publish

Research note for the forge v2 brief (research contract R16). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable).

## Verdict

One Postgres-backed queue, pg-boss or graphile-worker (both MIT, both active), serves Publish, model
runs, embedding jobs, metrics pulls and imports with no new infrastructure. No queue, and no
orchestrator, can make a non-idempotent platform POST exactly-once; that guarantee lives in forge's own
`publish_attempts` row per (post, platform) and in reconciliation against the platform before any retry.
On LinkedIn, reconciliation needs a scope forge will not have, so a `needs_review` state is mandatory.

## Evidence

1. pg-boss: MIT, Node 22.12+, Postgres 13+, SKIP LOCKED; cron and RRULE schedules, `startAfter`,
   priorities, dead-letter queues with redrive, exponential backoff, rate limiting, debouncing, job
   dependencies [vendor]. [https://github.com/timgit/pg-boss, 2026-09-24]
2. pg-boss releases 12.33.6 (2026-09-22) and 12.33.7 and 12.34.0 (2026-09-23) fixed cron jobs landing
   in the wrong minute, duplicate cron sends, and dropped catch-up jobs, and added `redrive()`
   filtering. Active upkeep, and minute-precision cron had bugs this week: pin 12.33.7 or later.
   [https://github.com/timgit/pg-boss/releases]
3. graphile-worker: MIT, TypeScript, `run_at`, `job_key` dedup, exponential backoff (25 attempts over
   about 3 days), crontab with backfill, LISTEN/NOTIFY latency under 3 ms, SKIP LOCKED, crashed-worker
   lock recovery [vendor]. v0.18.0 is pure ESM, Node 22 minimum, pre-1.0; ESM-only may rub against a
   CommonJS NestJS build. [https://worker.graphile.org/docs; releases page]
4. At-least-once is the ceiling: a worker dying after the external call and before commit sees its lock
   expire and the job runs again; the docs frame this as recovery, not deduplication.
5. LinkedIn `POST /rest/posts` returns 201 with the URN in `x-restli-id`; no idempotency key or client
   reference in the schema; 409, 429, 500, 503 listed as retryable; the author finder needs
   `r_member_social`, restricted (R10).
   [https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api, 2026-05-07]
6. X `POST /2/tweets` has no idempotency key; identical text is rejected as duplicate (403), with
   community reports of both false positives and duplicates from simultaneous calls, so the check is an
   unreliable backstop. [https://docs.x.com/x-api/posts/create-post; devcommunity threads]
7. Not fetched: Temporal, Inngest, Trigger.dev, BullMQ (Redis), pg_cron (SQL only), node-cron (no
   persistence), @nestjs/schedule. None changes item 4.

## The pattern (general practice, not one primary source)

1. Insert `publish_attempts (post_id, platform)` UNIQUE, state `intent`, before anything.
2. Move to `in_flight` in its own committed transaction; make the POST outside any transaction.
3. On success write the platform id and URL, state `published`; on a classified pre-send failure (DNS,
   connect, 4xx before send) state `failed`, retryable.
4. Recovery finding `in_flight`: never blind-retry. On X, list the user's recent posts and match by text
   hash and time window; if matched, record it; if not and the failure was pre-send, retry; else
   `needs_review`. On LinkedIn, reconciliation is impossible without `r_member_social`, so `in_flight`
   after a crash goes straight to `needs_review` with the Failure strip and an email.
5. Retry only 429, 5xx, 409, with backoff; every attempt is a row.

## Reading

The sibling project's advisory-lock `Job` table is viable and would mean hand-building what pg-boss
ships; pg-boss's CJS friendliness and dead-letter redrive fit a NestJS api better than graphile's
ESM-only build. Scheduling Armed posts by polling `armed AND scheduled_at <= now()` every minute is
simpler than enqueueing at arm time, because an edited `scheduled_at` needs no job cancellation; the
queue job is then a trigger that is safe to run twice, and the `publish_attempts` row is the truth.
The existing `embedding_jobs` poller can move onto the same queue or stay.

## Decision fed

- Publish infrastructure (decisions 16, 18): pg-boss ≥ 12.33.7 as the one queue; `publish_attempts`
  with the states above; minute poll for Armed posts; `needs_review` surfaced on the Post and by email.
- Worker: the same queue for runs, embeddings, decaying metrics pulls (R10, R11) and history imports.

## Open items

- Whether forge's LinkedIn app can ever get `r_member_social` (R10 says no under CM).
- pg-boss v12 CJS/ESM status and a NestJS wrapper (community packages unverified); job expiration and
  heartbeat defaults.
- Orchestrators' pricing and self-host status if they must be ruled out on paper.

## Confidence

High on LinkedIn and X facts and on pg-boss and graphile activity and licences. Medium on crash
semantics and the pattern (sound reasoning, not one primary document). Low on the orchestrators.
