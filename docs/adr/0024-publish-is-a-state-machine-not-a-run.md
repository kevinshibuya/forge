# Publish is a state machine, not a Run, and it posts at most once on its own

Publishing makes no model call and has no payload for an Output contract, so it is not a Run kind. It
is a `publish_attempts` row per attempt, numbered, with states `intent → in_flight → published | failed
| needs_review` and a partial unique index over the live states (`intent`, `in_flight`, `published`) so
one Post has at most one live attempt and a Post is one Platform (ADR 0021). The row is written before
anything, claimed by compare-and-set (`UPDATE … SET state = 'in_flight' WHERE state = 'intent'
RETURNING`, which is what makes the queue job safe to run twice), the platform POST made outside any
transaction, and the platform id and URL written on success. No queue can make a non-idempotent POST
exactly-once and neither platform offers an idempotency key, so the guarantee is **at most one
automatic post per Post**, which rests on one classification: a failure **before the request was sent**
(DNS, connect, TLS, a 4xx received before the body was accepted, a 429 with `retry-after`) is retried
with backoff as a new attempt row; any error or timeout **after the request was sent**, including a
5xx, is treated as a crash, because the platform may have created the post. On X a crash is reconciled
by listing the user's recent posts and matching by text hash and time window; on LinkedIn the scope
that lists a member's posts is unavailable, so the attempt goes to `needs_review`, with the Failure strip
on the Post and an email to the Tenant. Threads are `publish_segments` rows under the attempt, one per
segment with its platform id, and a thread resumes from the last confirmed segment.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decisions 16, 17, 18;
`docs/research/2026-09-24-r16-queue-and-publish.md`, `r10-linkedin.md`, `r11-x.md`; the S4 review
(both legs).

## The queue and the clock

pg-boss, pinned at or above 12.33.7 (minute-precision cron had duplicate and minute-edge bugs fixed that
week), is the one queue for Publish, outcome pulls, history imports, embedding jobs, the orphan sweep,
the stuck-run reaper and the X compliance sweep. Model runs are not on it in v1 (ADR 0027). Armed is a
derived predicate, not a column: `approved`, a date, a time, and a live connection. The minute poll,
running as the system role, computes `(scheduled_date + scheduled_time) AT TIME ZONE voice.time_zone
<= now()` over local wall-clock columns (storing a future appointment as UTC breaks when the zone or
DST changes between scheduling and publishing) and enqueues one job per Post with its tenant; the
consumer opens its transaction with that tenant. Polling beats enqueueing at arm time because an edited
`scheduled_at` needs no job cancellation. pg-boss's schema is created by the migration role. The
existing `embedding_jobs` poller moves onto the queue.

## Outcomes

Each published Post is polled on days 1, 3, 7 and 28 for five metrics on LinkedIn (IMPRESSION,
MEMBERS_REACHED, REACTION, COMMENT, RESHARE; one metric per call, no batch on the Development tier) and
for `public_metrics` plus `non_public_metrics` on X (readable for 30 days, hence day 28); the
member-level `me` aggregate on LinkedIn weekly. For twenty members at five posts a week that is about
286 metric calls a day plus 14 for the aggregate plus 15-45 for publishing, about 315-345 against a
per-app cap of 500: **15-17 calls per member per day, so the Development tier serves about thirty
members**, with unknown headroom for `dms-uploads` PUTs, and the rest on the export upload. The first
draft of this ADR and the brief said seventeen, which was 350 divided by 20 read as a member count; the
memo records the correction. X reads cost $0.005 per connected-user post, about $8 a month at four
polls. An `outcome` Signal is written whenever a fact lands, by pull or by export link.

## Compliance

X's Developer Policy requires stored content to be kept current and removed within 24 hours of a
deletion. A naive daily read of every stored X post costs up to $9,600 a month at the 3,200-post import
cap for twenty users, which no cost model had counted. The sweep runs every 12 hours (a daily one misses
the 24-hour term with any jitter) and its mechanism is fixed in the Publish slice by measurement: X's
batch compliance jobs endpoint if pay-per-use offers it, else reads scoped to items used as Exemplars in
the last 30 days plus a weekly full pass. Compliance reads and outcome pulls are billed to the app in
the ledger, never refused by a Budget.

## Considered

graphile-worker: equivalent guarantees, lower latency, ESM-only and pre-1.0; pg-boss's dead-letter
redrive and cron decided it, and Node 22.12's `require(esm)` makes the module-format point moot either
way. A hand-rolled advisory-lock `Job` table: viable, and it would rebuild backoff, dead-lettering,
delayed claim and crash recovery that pg-boss ships. BullMQ, Temporal, Inngest, Trigger.dev: each adds
infrastructure or a hosted dependency and none changes the at-least-once ceiling. Enqueueing a Publish
job at arm time: every schedule edit becomes a cancel-and-requeue. Retrying 5xx: the first draft of this
ADR did, and it is a blind retry of an ambiguous outcome, which double-posts on LinkedIn.

## Consequences

X credits are a per-app pool, so an app-level credit floor pauses Publish and alarms Kevin before the
pool empties; a per-Tenant Budget alone cannot see that failure coming.

A publish in `needs_review` is the user's to resolve: the Workspace shows the attempt, a link to the
platform, and two buttons, "it posted" (record the URL) and "it did not" (a new attempt is armed).

A scheduled time already past at approval asks "publish now or reschedule"; it never fires within the
minute. An approved Post that changes is disarmed (ADR 0022).

The Failure strip's definition widens: it reads from the Post's last Run or its last publish attempt,
whichever is newer.
