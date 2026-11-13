# forge v2: architecture

**Written 2026-09-24** by the main session (fable) from the S4 grill, two rounds, 27 questions, every one
answered with the recommended option; Kevin approved the tree at the close of round 2. **Rewritten the
same day** after the S4 review wave: two `reviewer` legs (opus and fable, xhigh, fresh contexts), 60
findings, every code claim verified against the tree before acceptance; the record is in the memo's
"S4 consolidation" section. Built on the product brief (`2026-09-24-forge-v2-product-brief.md`), the
research memo (`docs/research/2026-09-24-forge-v2-research-memo.md`) and ADRs 0019 to 0027. Starts from
`docs/forge-v2-brief-and-research` at `399b0c5`.

**Status**: spec reviewed and amended. Five amendments change answers Kevin gave in the S4 rounds;
he ratified all five on 2026-09-24 (memo, "S4 consolidation", ratification list). S5 writes one plan per
slice from the graph in the last section.

This document says what the system is and how its parts fit. The decisions and their reasons live in
the ADRs; the vocabulary in `CONTEXT.md`. Where this spec and an ADR disagree, the ADR wins and this
spec is wrong.

## What was verified before writing

- Code claims from both review waves, checked against the tree: Inputs reach the model only as a
  listing of staged paths (`drafting/research-prompt.ts:61-66`); the codex engine reports one session
  token total (`engines/codex.engine.ts:6-7`); the export parser reads pt-BR labels only
  (`analytics/xlsx-parser.ts:114-116`); `tells.ts:65` builds `\b` with `gi` and no `u`;
  `inputs/url-article.ts` pins DNS and refuses private ranges; approve and publish write no Revision
  and `updateBody` gates only on `measured` (`posts/posts.service.ts:203, 273-287`); the api and the
  migrator connect as `forge`, the table-owner role (`db/migrate.ts:19`); `ideas.promoted_post_id` is
  one FK and Post delete flips the Idea on it (`schema.ts:35`, `posts.service.ts:336`); the renderer
  launches Chromium in-process with `--no-sandbox` and renders client-supplied HTML
  (`images/render.service.ts:22`, `images.controller.ts:129`); no Dockerfile exists; `dim_post` is keyed
  on a LinkedIn URN with NOT NULL `linkedin_url` and first-seen file (`schema.ts:137-145`); the schedule
  is a zone-less `date` and `time` (`schema.ts:51-52`); `EngineRequest.prompt` is a string
  (`engines/engine.interface.ts:7`); `RunEventsHub` is an in-process map (`runner/run-events.hub.ts:7`);
  the global HNSW index survives every filter (`schema.ts:282`); the api is transpiled file by file with
  swc, no bundler (`nest-cli.json`).
- Live data on 2026-09-24: 4 posts, 51 revisions, 107 runs, 15 embeddings, 29 manual-edit revisions.
- Platform facts from primary docs: LinkedIn's Community Management grant, caps and application
  requirements (`r10`); X's prices, scopes, 2h tokens and single-use refresh tokens (`r11`).

## The system on one page

A NestJS api and a worker share one codebase and one Postgres database (Supabase, São Paulo) on Fly in
`gru`; a React SPA is served by the api; objects live on R2; the HTML renderer is its own Fly app with no
secrets. A Tenant signs in (Better Auth: email magic link, Google), owns one Voice in v1, connects the
Voice's X account (and LinkedIn once approval lands), and imports history (X through the API in minutes;
LinkedIn through the member's own export, 24-72 hours later) into a corpus. A Voice profile run drafts
the persona and first Playbook rules as proposals. From then on the content spine is the one forge has
today: Idea → Triage → Promote (with a Platform) → Post → draft, refine, Inputs, Research → Revisions →
images → approve → Armed → Publish → outcomes → Retro. Every model call is a Run through one `Engine`
seam with three backends (`fake`, `api`, `cli`), audited with its rendered prompt, a context row, usage
and cost, reserved against the Tenant's Budget. Model runs execute in the api process; the worker runs
queue jobs only. Signals (`edit`, `instruction`, `verdict`, `outcome`) steer Exemplar selection silently
and become Playbook proposals explicitly; nothing rewrites the Constitution unasked. The Draft score is
shown on every draft and gates nothing. Publishing is a `publish_attempts` state machine on pg-boss: at
most one automatic post per Post, retry only before the request was sent, reconciliation on X,
`needs_review` on LinkedIn. Outcomes are polled on days 1, 3, 7 and 28. A Tenant deletes whole.

## Components

### api

NestJS, two or more Fly machines. Modules as today plus `tenancy` (request transaction with the tenant
setting, roles, invite check), `auth` (Better Auth mount), `connections` (platform OAuth, token
encryption, single-flight refresh), `publish` (attempts, segments, reconciliation), `outcomes` (pulls,
Signals from facts), `signals`, `budget` (ledger, reservation and settlement), `score` (Draft score:
post-checks, judge calls, floors), `voice` (Voice, language, time zone, profile run), `corpus`
(imported history), `onboarding` (imports, per-locale export parsing). Body limit 1 MB; uploads go to R2
by presigned URL with signed size and content-type conditions and a pending-upload row. Model runs
execute here (ADR 0027): a Run records the machine that holds it, and the SSE console route replays to
that machine with `fly-replay`; a 15-30 s heartbeat keeps the proxy open. Deploys drain with a kill
timeout at least as long as the run timeout; auto-stop is off.

### worker

The same codebase, a worker entrypoint, pg-boss consumers only: Publish, outcome pulls, history
imports, embedding jobs, the orphan sweep (nightly, age threshold), the stuck-run reaper, the X
compliance sweep (every 12 hours). Cross-tenant scanners run as the system role; every per-tenant job
payload carries `tenant_id` and the consumer opens its transaction with it. Model-run jobs do not exist
in v1.

### renderer

A separate Fly app running Playwright with the sandbox on, no secrets, `page.route` aborting every
request that is not `data:` or an allowlisted font host, taking HTML in and PNG out over an internal
endpoint. Today's `render.service.ts` becomes its client. Chromium's footprint is measured with the ONNX
spike, since the api machine no longer carries it.

### engines (`app/api/src/engines` and `@forge/engine-cli`)

`Engine` v2 (ADR 0019): `EngineRequest` carries system blocks with cache hints, user content, image
references by storage key, the schema, a timeout and a tool cap; `EngineResult` carries the output,
usage with cache fields, cost, the provider request id and any image output as bytes or a storage key.
`runs.engine` becomes a provider text column. Backends: `fake` (tests), `api` (Anthropic, OpenAI and
Google SDKs; `maxRetries: 0`, one recorded retry; two cache breakpoints, after the Constitution and after
the Inputs and Research block, because a refine re-sends both), and `cli` in `@forge/engine-cli`,
imported by the dev entrypoint only, kept out of the api's production dependencies, with a
node-file-trace test from `dist/main.js` failing on any edge into it. The staging service and the fences
of ADRs 0015 and 0017 are deleted, not moved: `cli` never serves a run with Inputs or Research. A model
registry (one row per task: provider, model, backend pin, price, effort) replaces `engineForKind` and
the model fields in the settings row; image generators are rows (Nano Banana 2 default on a paid tier,
gpt-image-2.5 premium, codex gpt-image-2 on `cli` only). On `cli` the Draft score's judges do not run
(they are `api` models), so a dev run shows no score, by design.

### web

React, Vite, react-query, react-router, the design system untouched. Every slice ships its own surface
and keeps the route smoke green; Kevin's working app never sits broken. Surfaces: Promote takes a
Platform; the Workspace shows Platform, Form, the platform's rendering before approve, the Draft score,
Discard with a reason, the publish attempt and its `needs_review` resolution ("it posted" with the URL,
"it did not" to arm again); the Planner shows Platform and Armed state; the Sources panel renders the
claims list with verified and paraphrased marks; `/onboarding` (connect, import, Voice profile
proposals); `/settings/voice`, `/settings/connections`, `/settings/budget`. Overview stays at `/`.

### data (Postgres on Supabase, `sa-east-1`)

Shared schema; `tenant_id` on every tenant-owned table and `voice_id` on every Voice-owned one;
hand-written SQL migrations applied by the release command, **expand then contract** so a rolling deploy
never runs old code against a dropped column (ADR 0020).

**Roles** (ADR 0020): `forge_migrate` owns the tables; `forge_app` (NOBYPASSRLS) serves the api and the
per-tenant jobs, with `FORCE ROW LEVEL SECURITY` on every tenant table; `forge_system` (BYPASSRLS) serves
only the cross-tenant scanners. Every api request runs inside one transaction opened with
`set_config('app.tenant_id', $1, true)`; session-level `SET` is forbidden; long model runs hold no
transaction (the runner writes each row in its own short transaction with the setting). postgres.js
runs with `prepare: false` under Supabase's transaction pooler. Local docker and CI use the same three
roles, so an isolation test can go red. Tables exempt from `tenant_id`: pg-boss's schema, `model_registry`,
`invites` (global; it gates a sign-in before any Tenant exists), Better Auth's `user`, `session`,
`verification`. Supabase's Data API is disabled. Composite foreign keys that must survive a delete use
`ON DELETE SET NULL (post_id)` with a column list, so the tenant column is never nulled.

**New tables**: `tenants`; `tenant_members` (user → tenant); `invites` (global allowlist);
`voices` (language, time zone, persona doc); `style_docs` (voice, language, kind, body, enabled per run
kind); `rule_proposals` (voice, source: retro run | edit pair | instruction, payload, status);
`platform_connections` (voice, platform, encrypted tokens with key version, `locked_until` for refresh);
`corpus_items` (voice, platform, platform post id, text, published_at, provenance, embedding source
type `corpus`); `publish_attempts` (post, attempt number, state, error class, platform id, URL; partial
unique index on `state IN ('intent','in_flight','published')`); `publish_segments` (attempt, index,
platform id; a thread resumes from the last confirmed segment); `signals` (tenant, voice, kind,
subject type and id, revision refs, payload); `run_contexts` (run, exemplar Revision ids and their
stats, constitution snapshot hash, inputs' text, fetched text); `ledger` (per call and per platform
call: run, tokens with cache fields, reserved and settled cost, category text | image | platform |
compliance); `budgets` (tenant, month, ceiling, reserved, settled); `model_registry`;
`pull_provenance` (voice, platform, kind, at).

**Changed tables**: `posts` (`voice_id`, `platform`, `form`, `idea_id` FK set null, `body` renamed from
`body_linkedin`, `platform_post_id`, `platform_url` renamed from `linkedin_url`, `segments` jsonb for
threads, `scheduled_date` and `scheduled_time` kept as local wall-clock; `body_x` dropped);
`ideas` (`voice_id`, suggested platform; `promoted_post_id` dropped, siblings are `posts WHERE idea_id`);
`post_revisions` (a `source: 'approve'` row on approval); `runs` (`tenant_id`, `voice_id`, `machine_id`,
`engine` as provider text, cache token columns, `cost`, `prompt` kept as the rendered audit);
`run_steps` (`tenant_id`); `playbook_rules` (`voice_id`); `assets` (`tenant_id`, `voice_id`,
`storage_key` replacing `png_path`); `source_files` (`tenant_id`, `voice_id`, `storage_key`, unique
`(tenant_id, sha256)`); `dim_post` (keyed `(voice_id, platform, platform_post_id)`; `platform_url` and
first-seen file nullable); every fact table (`voice_id` in the key; `source_file_id` nullable with
`CHECK ((source_file_id IS NULL) <> (pull_provenance_id IS NULL))`; `fact_profile_metric` keyed
`(voice_id, metric, date)`); `embeddings` (`tenant_id`, `voice_id`, source types `post | idea | corpus |
retro_note`; the global HNSW index dropped, exact scan under a B-tree on `(tenant_id, voice_id)`);
`post_inputs` (`text`, parser version, `storage_key`; `path` kind dropped); `run_kind` gains `adapt`,
`voice_profile`, `research_plan`, `judge_rubric`, `judge_pairwise`, `edit_classify`; `failure_kind`
gains `budget`; `settings` becomes per Tenant. Dropped: `inspirations`.

Every primary key and unique that gains `tenant_id` or `voice_id` is listed in the tenancy migration;
the reviewers named `fact_profile_metric (metric, date)`, the account-level rows of `fact_window_metric`
and `fact_audience_segment`, `source_files.sha256` and `dim_post.post_urn` as the ones that collide
across tenants today.

Embedding model: decided by the paired eval among text-embedding-3-small, gemini-embedding-001 at
1536 and voyage-4; the column dimension is fixed after it, in the re-embed.

### storage (R2)

One prefix per Tenant: `t/<tenant>/inputs/…`, `t/<tenant>/assets/…`, `t/<tenant>/exports/…`.
Presigned PUT with size and content-type conditions; a pending-upload row written before the PUT; the
nightly sweep deletes objects older than 24 hours with no owning row.

### vendors, behind interfaces

`Search` (Perplexity Search, fast tier); `Fetcher` (forge's own, through `url-article.ts`'s guard, with
a local readability extractor; no third-party reader in the path, ADR 0023); `Ocr` (Mistral OCR or
LlamaParse Fast by a 20-document spot check); `ImageGenerator` (registry rows); `Renderer` (the
renderer app); `Mailer` (Resend); errors to Sentry with prompt text scrubbed. Each vendor's terms are
read at its slice's start; the sub-processor list carries region, transfer mechanism and no-training
terms per vendor; Sentry and backups are lines on it.

## Flows

**Draft.** The runner reserves the call's cost against the Budget under a row lock, creates the Run row
and its context row (Constitution snapshot hash, Exemplar Revision ids and stats from the Voice's corpus
and approved bodies by exact scan with `verdict` and `outcome` weights, the Inputs' text up to the cap);
the `api` engine sends system blocks (the Constitution under the first cache breakpoint), the Inputs and
Research block under the second, the user turn and the Output contract; the payload is validated with
Zod; the body is written as a Revision `run:<id>`; usage and cost are settled on every exit path; the
cheap parts of the Draft score run (fit post-check, Tells, rubric judge) and the score shows as
provisional. A Research draft is a managed Run: step 1 `research_plan` (a cheap model, contract
`{queries[]}`, queries capped at 200 characters), forge searches and fetches only the returned URLs
through the guard, extracts text locally, caps it at 200,000 characters, and step 2 drafts with that
text in the context; the `claims` list is verified by substring after the run.

**Refine and Selection refine.** As today; the instruction is stored as an `instruction` Signal; the
Inputs and Research block is re-sent under its cache breakpoint.

**Approve.** Writes a Revision `source: 'approve'`; records a positive `verdict`, which is the
human-review record (who, when, which Revision); computes the `edit` Signal against the last Run's
Revision; runs the strong pairwise voice judge (cross-vendor, order swapped, cached) and finalises the
Draft score. With a date, a time and a live Connected account the Post is Armed (a derived predicate,
not a column). A scheduled time already past at approval asks "publish now or reschedule"; it never
fires within the minute. **Any content change to an approved Post** (body, hook, hashtags, a selection
refine accepted, a Revision restored, the selected Candidate changed) returns it to `draft_ready` and
disarms it, and the Workspace says so.

**Discard.** Records a negative `verdict` with the optional reason; the Post's status is unchanged.

**Publish.** The minute poll (system role) finds Armed posts by computing `(scheduled_date +
scheduled_time) AT TIME ZONE voice.time_zone <= now()`, enqueues one job per Post with its tenant, and
the consumer claims the attempt by compare-and-set (`UPDATE … WHERE state = 'intent' RETURNING`); the
token is refreshed single-flight under `locked_until`; the POST is made outside any transaction
(LinkedIn Posts, Images or Documents API; X `POST /2/tweets` with media, threads by reply chaining, one
`publish_segments` row per segment); on success the platform id and URL land on the Post and the status
moves to `published`. A failure classified **pre-send** (DNS, connect, TLS, a 4xx before the body was
accepted, a 429 with `retry-after`) is retried with backoff as a new attempt row. Any error or timeout
**after the request was sent** is a crash: reconcile on X by listing the user's recent posts and
matching by text hash and time window (a thread resumes from the last confirmed segment); on LinkedIn
go to `needs_review` with the Failure strip and an email. A refresh that crashes between X's token
response and the commit loses the single-use refresh token: the connection is marked dead, its Armed
posts fall back to reminders, and the Tenant is emailed to reconnect.

**Outcomes.** A pull per published Post on days 1, 3, 7 and 28 (LinkedIn: five metrics, one call each;
X: `public_metrics` and `non_public_metrics`), the LinkedIn `me` aggregate weekly, each pull a
`pull_provenance` row; **an `outcome` Signal is written whenever a fact lands, by pull or by export
link**, so LinkedIn Voices on the export path learn too. Retro's trigger becomes "N new measured Posts
or a week, whichever first", set per Voice. Compliance and outcome calls are billed to the app in the
ledger (category `compliance` or `platform`), never refused by a Budget.

**X compliance.** Every 12 hours the stored X content (published Posts' platform ids and `corpus_items`)
is checked against X's batch compliance jobs endpoint if pay-per-use offers it, else by reads scoped
to items used as Exemplars in the last 30 days plus a weekly full pass; the mechanism and its monthly
cost are fixed in the Publish slice and recorded in ADR 0024, since a naive daily read of every
imported post costs up to $9,600 a month at the import cap. Deletions on X delete forge's copy within
the term.

**Onboarding.** Sign in (allowlist; the refusal message is the same as for an unknown address) → create
Tenant and Voice (language, time zone) → connect X (LinkedIn when its scopes exist) → import history
into `corpus_items` (X: timeline API, depth shown with its cost; LinkedIn: upload Shares.csv, and
optionally the xlsx analytics export in en or pt-BR for outcomes) → embed the corpus → Voice profile run
→ the user edits and approves the persona and the first rules from `rule_proposals` → first Idea.

**Tenant deletion.** `DELETE … WHERE tenant_id` through the cascades; storage prefix purge; pg-boss job
and archive rows for the tenant purged; X token revocation; a link to LinkedIn's revocation page;
deletion requests to sub-processors (model APIs, Sentry); the ledger survives anonymised (tenant id, no
content) as the accounting record; backups are named as the exception on the data page, with their
retention window, confirmed against X's terms. Timelines per source: LinkedIn API data 10 days (a
redaction job nulls the stats fields in `run_contexts` and the stats block in rendered prompts), X
content 24 hours after removal, the rest 30 days.

## Invariants, v2

1. On the `cli` backend, `OPENAI_API_KEY` never reaches a codex child. In production, every model call
   reserves its cost against the Tenant's Budget before it runs and settles on every exit path; a
   reservation that would cross the ceiling is refused with failure kind `budget`. Compliance reads,
   outcome pulls and already-Armed publishes are billed to the app and never refused.
2. Image bytes never enter prompt text as base64 (vision input travels as a reference; unchanged in
   purpose).
3. At most one selected Candidate per Post (unchanged).
4. Grain is never coerced (unchanged; a day-N pull is a lifetime-to-date fact, ADR 0007 amended).
5. A Run's row, not its stream, decides completion (unchanged).
6. Every model call is an audited Run with its rendered prompt, its output, its context row, usage with
   cache tokens, and cost, on every exit path.
7. Re-importing the same export is a no-op by `(tenant, sha256)`; re-pulling the same outcome is a
   no-op by `(voice, post, metric, as_of)`.
8. Ingestion never fails for lack of an app Post (unchanged).
9. No CLI code in the production api: `@forge/engine-cli` is absent from its dependencies and from the
   file trace of `dist/main.js`.
10. Nothing a Tenant owns is readable by another: the tenant column is the rule, RLS under a non-owner
    role is the backstop, and a sabotage test proves the backstop can go red.
11. At most one automatic post per Post; a retry happens only for a failure classified before the
    request was sent; an ambiguous outcome is `needs_review`.
12. Research fetches only search-returned URLs through forge's own guard; a run with Inputs or Research
    never runs on `cli`.
13. Token refresh is single-flight per Connected account with a lock that expires.
14. Tells never block; the Draft score never gates.
15. Signals never rewrite the Constitution; every rule change is a proposal a human decides.
16. An approved Post that changes is no longer approved.
17. The renderer holds no secrets and reaches no network.

## Spikes and measurements the slices owe

- The ONNX spike (mStyleDistance and a multilingual NLI model in transformers.js on the Fly machine:
  latency, memory, pt-BR coverage); its failure triggers the Python ADR (ADR 0025).
- Real input token counts, including a draft that carries 120,000 characters of Inputs and 200,000 of
  fetched text (about 80k input tokens), and the gpt-image-2 per-image grid; R12 is re-run on them and
  on one volume assumption before a price is set. Cache hit rates measured in the ledger before the
  breakpoint TTLs are tuned (5m default; 1h only while a Workspace session is open).
- The paired embedding eval on tenant 1's imported corpus before the embedding row is fixed.
- The eval harness's own variance before any retrieval experiment.
- The CIPHER validation on tenant 1's 29 manual edits before the proposal path is built for others.
- A 20-document OCR spot check before the `Ocr` row is fixed.
- The X compliance mechanism and its cost; Perplexity Search's terms; Fly `gru` availability; pg-boss
  under `require(esm)` on Node 22.12.
- Background refine on Nano Banana 2; C2PA signing with `c2pa-node` (the composite is a screenshot,
  which keeps no manifest, so forge signs its own with the generator's image as an ingredient, which
  needs a certificate and a key custodian; if that cost is too high for the beta, the disclosure is the
  optional label and claim 14 stays pending).
- The negative corpus for the voice floor: a fixed public or licensed set per language shipped with
  the eval slice, never another Tenant's rows.

## The slice graph

Ordered by shortest path to an X-first beta, each slice one plan in `docs/plans/`, executed on Opus,
shipping its own web surface, verified by typecheck, lint, focused tests and the route smoke, so the
app Kevin drafts in stays green throughout. Each schema slice carries its own tenant 1 backfill in its
migration; migrations expand first and contract in a later slice.

1. **LinkedIn application pack** (Kevin, in parallel; **parked 2026-09-26**: no CNPJ for now, so the
   beta runs plan B, research memo question 1): entity, domain, the Cloudflare Pages site with
   the privacy policy and a provisional sub-processor list, LinkedIn Page, the Development-tier
   application.
2. **Engine v2, registry and ledger core** (ADR 0019): `EngineRequest`/`EngineResult` v2, the `api`
   engine with three provider SDKs, the model registry, usage with cache fields and cost on every exit
   path, `@forge/engine-cli` split with the file-trace test, staging and fences deleted, R12 re-run.
   No Budget yet (it needs Tenants).
3. **Tenancy schema and roles** (ADR 0020, first half): `tenants`, `tenant_members`, `voices`,
   `tenant_id` and `voice_id` on every table with the tenant 1 backfill, every collided key rekeyed,
   the three roles in docker, CI and Supabase, RLS with `FORCE`, the request transaction, the test
   fixture that runs every spec as a Tenant, the sabotage test, the HNSW index dropped, `style_docs`
   and `playbook_rules.voice_id`, `budgets` and the reservation path, the localhost audit's fixes.
4. **Corpus and eval** (ADR 0025): `corpus_items`, a one-off import of Kevin's Shares.csv and X history
   so a golden set exists, evalite, the cross-vendor judges, the cache, the variance measurement, the
   ONNX spike, the paired embedding eval, the negative corpus.
5. **Platform model** (ADR 0021): `platform`, `form`, `idea_id` and siblings, Promote with a Platform
   (web), Adapt with its rule, Form contracts, the Workspace's platform rendering (web), `body` and
   `platform_url` renames as expand steps.
6. **Signals and the Draft score** (ADR 0022, 0026): the `approve` Revision, disarm on change,
   `instruction` storage, Discard (web), `signals`, `run_contexts`, `rule_proposals`, the fit
   post-check, the rubric judge per draft, the pairwise judge at approve, the floors, per-language
   Tells with the Unicode fix, the CIPHER validation, the score on the Workspace (web). Before the beta
   because the beta's edits are the data.
7. **Auth, connections, storage, renderer** (ADR 0020, second half): Better Auth, `invites`,
   `platform_connections` with encryption and `locked_until`, X OAuth, R2 with presigned uploads and the
   pending-upload row, the renderer app, `/onboarding` connect step and `/settings/connections` (web).
8. **Queue, Publish, outcomes, compliance** (ADR 0024, 0027): pg-boss, `publish_attempts` and
   `publish_segments`, the minute poll, X publishing with media and threads, the outcome schedule and
   `outcome` Signals from facts and from export links, the compliance mechanism and its cost, the
   credit floor, the reaper and the sweeps, the attempt strip and `needs_review` resolution (web);
   LinkedIn publishing and pulls behind the same interfaces, enabled when approval lands (S4-Q3 is
   answered here by LinkedIn's reply on the self-serve product).
9. **Input and Research delivery** (ADR 0023): parsing at attach, the inline cap, `Search` and
   `Fetcher`, the `research_plan` step, the `claims` list and its verification, the Sources panel (web).
10. **Image lane on the registry**: generator rows, two Candidates, the renderer client, C2PA signing or
    its documented fallback, Background refine routing, Candidate storage on R2 and the canvas save path.
11. **Onboarding and the Voice profile**: X history import into the corpus, Shares.csv and per-locale
    xlsx parsing (en, pt-BR), the profile run and `rule_proposals`, the onboarding route (web).
12. **The physical move**: local database to Supabase (dump and restore under the three roles),
    `uploads/` and `post-assets/` to R2 with path rewrites, re-embedding with the chosen model, old Runs
    flagged `pre_v2` and kept, `path` Inputs converted where they resolve, `seed-content.spec.ts`
    updated for the persona's new home.
13. **Deploy and beta**: Fly (api, worker, renderer), Resend, Sentry with scrubbing, GitHub Actions,
    migrations in the release command with the expand/contract rule, the SSE heartbeat and
    `fly-replay`, per-tenant concurrency limits, the `Linkedin-Version` bump alarm. The beta invite list
    opens after this slice's smoke passes, and every surface the beta needs shipped in 5 to 11.
14. **Web polish**: `/settings/voice`, `/settings/budget`, Planner Platform and Armed marks, and
    whatever the beta's first week asks for.

Dependencies that bind the order: 2 before everything metered; 3 before every new table; 4 needs 3
(corpus is Voice-owned) and precedes 6 (the score needs judges and floors); 5 before 8 (a Publish needs
a Platform); 7 before 8 (a connection belongs to a Voice under a Tenant); 6 before 13 (Signals from beta
users); 12 needs 4 (the embedding model), 10 (Candidates on R2) and 7 (R2 exists); 13 after 8 and 12.
Slices 9 and 10 can run in parallel with 8.

## Risks the beta carries, named

One X app and one Anthropic rate limit are shared by every Tenant: a Research burst by one Tenant slows
the rest (per-tenant concurrency limits, slice 13), and a policy strike suspends publishing for everyone
(the credit floor alarms; a suspension is a Kevin-level incident with no automatic recovery). LinkedIn
sunsets API versions yearly and its Development tier expires after twelve months; without Standard tier
the paid product is X in full and LinkedIn on reminders and export upload. X counts length with weighted
characters and t.co URLs, and Premium accounts have a 25k limit, so the fit check reads the account tier
from the connection. Backups hold removed X content past 24 hours and are named as the exception.

## What this spec does not decide

The price and the tiers (after a month of ledger data). The Standard-tier application (after the beta).
Reddit. Seats and roles. Cross-tenant learning of any kind. Passage retrieval over long Inputs. Jev.
Model runs on the worker (ADR 0027 keeps them in the api until the console has a cross-process bus).
The public name.
