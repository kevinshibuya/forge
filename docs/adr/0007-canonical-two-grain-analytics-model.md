# Analytics use a canonical grain-safe model, and there is no per-post daily table

The flat `analytics_snapshots` table could not hold what the real LinkedIn exports contain, because the same label means different things on different sheets: "Impressões" is lifetime on a single-post export, daily on the Engajamento sheet, and window-scoped on Descoberta. We replaced it with four fact tables split by grain — `fact_profile_metric` (daily, account), `fact_post_lifetime` (lifetime-to-date per post), `fact_window_metric` (carrying its window bounds), `fact_audience_segment` (snapshot demographics) — plus `source_files` and `dim_post` dimensions. Daily facts never receive window totals, lifetime facts never receive windowed numbers, and window facts always carry their bounds.

Source: `docs/superpowers/specs/2026-08-11-analytics-ingestion-design.md` (§Decisions 2 and 4, §Schema, §Grain rules). Tables in `app/api/src/db/schema.ts`.

## Considered options

- **Keep `analytics_snapshots` and dual-write.** Rejected: one source of truth, no dual writes. The old table was backfilled into the canonical tables and dropped, with the existing read-endpoint response shapes preserved by pivoting canonical rows.
- **Add `fact_post_metric` for per-post daily data.** Deliberately absent. No export contains that grain — it exists only in the official API — so the table would be dead on arrival. If API access ever opens, the adapter adds it.

## Consequences

- Every labelled numeric row in the fixtures must either map to a canonical metric or sit on an explicit skip-list. Silently dropping a metric violates the decision.
- `source_files.sha256` is the whole-file idempotency key: re-importing the same export is a no-op, with `?force` and `?postId` as the deliberate overrides. `?force` deletes that file's prior fact rows inside the transaction before re-upserting, so a fixed parser leaves no orphans.
- Upserts are last-write-wins by design, because LinkedIn backfills and corrects its own numbers.

## Amended for v2 (2026-09-24)

API pulls join the exports as a source, and the grain discipline holds unchanged: a day-N pull of a post's metric is a lifetime-to-date fact at `as_of_date`, so `fact_post_lifetime` takes it and the per-post daily table this ADR refused stays absent; LinkedIn's `me` aggregate and X's `non_public_metrics` land in the account-level and lifetime tables under their own metric names. What changes is provenance and keys. Every fact points at either a Source file or a `pull_provenance` row, never both and never neither (`CHECK ((source_file_id IS NULL) <> (pull_provenance_id IS NULL))`), and `source_file_id` becomes nullable. `dim_post` is keyed `(voice_id, platform, platform_post_id)` with a nullable platform URL and a nullable first-seen file, because an X post has no URN and a pulled post has no file. `voice_id` joins every fact key, since two Tenants' account metrics for the same day would otherwise collide and the last-write-wins upsert would overwrite one Tenant's number with another's on a row RLS hides. Idempotency: a re-imported export is a no-op by `(tenant_id, sha256)`; a re-pulled outcome by `(voice_id, post, metric, as_of)`. The export parser reads pt-BR labels only today and gains a per-locale label map (en, pt-BR) with a fixture per locale. Last-write-wins stays, for the same reason.
