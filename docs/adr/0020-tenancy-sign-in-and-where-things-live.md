# One schema, a tenant on every row, three database roles, and a Voice that owns the content

forge becomes multi-tenant on a shared Postgres schema: every tenant-owned table carries `tenant_id`,
every Voice-owned one `voice_id`, composite foreign keys carry them through, and row-level security is
the backstop that turns a missing `WHERE tenant_id` into an empty result instead of a leak.
Schema-per-tenant was rejected because the migrations are hand-written SQL and would multiply by N for
no gain at a beta of twenty. Vector search is an exact scan per Voice under a B-tree on
`(tenant_id, voice_id)`, and the global HNSW index is dropped: with a filter the planner may use it and
return fewer than k rows for a small Voice, silently.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decisions 1, 3, 13, 24;
`docs/research/2026-09-24-r15-tenancy-auth-hosting.md`; the S4 review (both legs, findings on RLS
roles, composite SET NULL, key collisions).

## RLS that can go red

Postgres skips row-level security for the table owner unless `FORCE ROW LEVEL SECURITY` is set, and
today the api and the migrator both connect as `forge`, the owner (`db/migrate.ts:19`), so a policy
would be a no-op. Three roles, in docker, CI and Supabase alike: `forge_migrate` owns the tables and
runs migrations and pg-boss's schema creation; `forge_app` (NOBYPASSRLS) serves the api and every
per-tenant job, with `ENABLE` and `FORCE ROW LEVEL SECURITY` on every tenant table and a policy on
`current_setting('app.tenant_id', true)`; `forge_system` (BYPASSRLS) serves only the cross-tenant
scanners (the minute poll, the reaper, the sweeps, the outcome scheduler), which enqueue per-tenant jobs
whose payload carries `tenant_id`. Every api request runs inside one transaction opened with
`set_config('app.tenant_id', $1, true)`; session-level `SET` is forbidden, because under Supabase's
transaction pooler it lands on whichever backend the next tenant's transaction gets. A model run that
lasts ten minutes holds no transaction: the runner writes each row in its own short transaction with the
setting. postgres.js runs with `prepare: false` under the pooler. Tables exempt from `tenant_id`:
pg-boss's schema, `model_registry`, `invites` (a global allowlist, because it gates a sign-in that
happens before any Tenant exists), Better Auth's `user`, `session` and `verification`. Supabase's Data
API is disabled so no table is reachable with the anon key. Two tests ship with the tenancy slice: a
query with no setting returns zero rows, and a sabotage test drops a policy and watches the suite go red.

## Keys and deletes

Foreign keys that survive a delete today with `ON DELETE SET NULL` (`runs.post_id`, `ideas` to posts,
`dim_post.post_id`, `posts.reference_asset_id`, `assets.run_id`, `assets.source_asset_id`) become
composite with a column list, `ON DELETE SET NULL (post_id)`, so the tenant column is never nulled and a
tenant-less row can never hide from `DELETE … WHERE tenant_id`. Every primary key or unique that would
collide across tenants gains `tenant_id` or `voice_id`: `fact_profile_metric (voice_id, metric, date)`,
the account-level rows of `fact_window_metric` and `fact_audience_segment`, `source_files (tenant_id,
sha256)`, `dim_post (voice_id, platform, platform_post_id)`. A test deletes a Post with Runs, then its
Tenant, and asserts no row remains with that tenant or with a null tenant.

## Ownership

The **Tenant** owns its members, its Budget and its billing identity. The **Voice** owns everything
content-bearing: Ideas, Posts, Revisions, Runs, Candidates, Inputs, Playbook rules, Style docs (their
own table now, not the settings blob), the persona, rule proposals, Signals, the imported corpus and
its embeddings, the analytics facts, its language, its time zone and its Connected accounts. With one
Voice per Tenant in v1 the split is invisible in the UI and total in the schema; it is the only split
under which "a ghostwriter's clients are Voices" is true later without a migration.

## Sign-in and connecting

Better Auth, self-hosted inside the api, signs a person in by email magic link or Google; `tenant_members`
maps the person to a Tenant. Platform accounts never enter Better Auth's `account` table: LinkedIn and X
connections live in `platform_connections`, one per Platform per Voice, because Better Auth links social
accounts into sign-in by default, including implicit linking on a matching email, and that would make a
revocable platform token a way into the Tenant. Tokens are envelope-encrypted (AES-256-GCM, a
key-encryption key in the host's secrets, a key version on every row; KMS when a second operator
exists). Refresh is single-flight per connection under a `locked_until` timestamp, the new refresh token
stored before the access token is used, because X refresh tokens are single-use. A crash between X's
token response and the commit loses that token: the connection is marked dead, its Armed posts fall
back to reminders, and the Tenant is emailed to reconnect.

## Hosting

Postgres on Supabase Pro in `sa-east-1` (daily backups included; point-in-time restore is a paid
add-on, taken when the beta has data worth it). The api, the worker and the SPA on Fly, region `gru` if
available (unverified; `gig` or `scl` otherwise), one Docker deploy, migrations applied by the release
command and written **expand then contract** so old machines never run against a dropped column during
a rolling deploy. The renderer is a separate Fly app with no secrets (ADR 0027). Objects on Cloudflare
R2 through presigned URLs with signed size and content-type conditions, one prefix per Tenant, api
bodies capped at 1 MB. The marketing site and the privacy policy on Cloudflare Pages at the apex, the
app at `app.<domain>`. Transactional email through Resend, errors to Sentry with prompt text scrubbed,
CI on GitHub Actions with a Postgres service container running the same three roles.

## Considered

Clerk or WorkOS for sign-in: free at this scale, a user store beside the Tenant's Postgres, not needed
for email plus Google. Neon instead of Supabase: equivalent; Supabase's included backups decided it.
Sign in with LinkedIn or X: rejected in the brief.

## Consequences

Tenant deletion is `DELETE … WHERE tenant_id` through the cascades, a storage prefix purge, pg-boss job
and archive rows purged, X token revocation, a link to LinkedIn's own revocation page, deletion
requests to sub-processors, and the ledger kept anonymised as the accounting record. Backups are the
named exception on the data page. Timelines per source: LinkedIn API data within 10 days (a redaction
job nulls the stats fields in `run_contexts` and the stats block in rendered prompts), X content within
24 hours of a removal, everything else within 30 days.

Every model API is abroad, so the sub-processor list carries a transfer mechanism per vendor (EU: DPF or
SCCs; Brazil: ANPD standard clauses) and a no-training column; Google's unpaid tier trains on inputs, so
the default image generator runs on a paid tier.

The invite refusal uses the same message as an unknown address, so the allowlist is not an oracle.
