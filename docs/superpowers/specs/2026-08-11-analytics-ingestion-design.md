# Analytics ingestion — canonical model for LinkedIn xlsx exports (phase 2 of 4)

**Date:** 2026-08-11. **Status:** reviewed — three-leg wave (opus + fable + codex) applied as one consolidated fix pass, 2026-08-11. No second wave.
**Standing context:** `2026-08-10-overhaul-roadmap.md` — carries the verbatim ingestion design notes and the row-by-row anatomy of the real export files. This spec assumes that doc; anatomy is not restated here except where a decision hangs on it.

## Goal

Replace the flat per-post `analyticsSnapshots` store with a canonical, grain-safe model fed by **both** real LinkedIn export types (AggregateAnalytics + SinglePostAnalytics, pt-BR locale), so that phase 4's data-viz rebuild has every number the exports contain. Backend-first: the web keeps working via compat reads plus one scoped web change (import response handling, below).

## Decisions (landed interactively 2026-08-11; amended by the review wave)

1. **Ingestion entry: upload-only.** `POST /analytics/import` stays the single entry point for both export types; the API classifies by sheet-name signature. No Downloads watcher in this phase (a later watcher would feed the same endpoint).
2. **Old table: migrate + compat reads.** Backfill `analyticsSnapshots` into the canonical tables, drop it, and keep existing read-endpoint response shapes by pivoting canonical rows. One source of truth, no dual writes.
3. **Post identity: typed `post_urn` key + URL-first linking.** (Amended — see "Post identity", the wave's central finding.) `dim_post` is keyed on the full typed URN derived from the export URL; linking to app posts is by **exact `linkedinUrl` equality first** (today's proven `findByUrl`), URN comparison second. Ingestion never fails for lack of an app post.
4. **Capture everything, at the correct grain.** The user's explicit direction: all data on all sheets is potentially useful; proper UX comes in phase 4. Window-scoped numbers get a window-grain table rather than being dropped or mixed into daily/lifetime grains. The metric registry below is a **floor, not a ceiling** — every labeled numeric row found in the fixtures must either map to a canonical metric or appear on the explicit skip-list; silently dropping a metric violates this decision.
5. **Manual snapshot HTTP surface dies.** `POST /analytics/snapshots`, `AnalyticsService.addManual`, and `ManualSnapshotSchema` are deleted. Tests that need programmatic snapshots get an internal test helper that writes canonical rows directly (no HTTP surface).

## Post identity (rewritten after review)

**The facts, verified against the real files and live DB:** every URL in the real exports and in `posts.linkedin_url` uses the slug form `…/posts/<slug>-share-<N>-<suffix>` or `…-ugcPost-<N>-<suffix>`. None use `activity`. UI-pasted URLs *may* use `/feed/update/urn:li:activity:N`. The numeric id **differs across URN types for the same post** (observed: export filename activity-id `9990000000000000106` vs URL share-id `9990000000000000101` for the same post) — the roadmap's "store all three, key on one canonical" gotcha.

- **Extraction:** `(activity|share|ugcPost)[:-](\d+)` (case-sensitive, matching both URN and slug forms) → canonical key `urn:li:<type>:<N>` as found. The plan must verify the regex against every URL in the committed fixtures before the migration is written.
- **`dim_post` PK is `post_urn`** — the full typed URN. Columns `activity_urn`, `share_urn`, `ugc_urn` additionally store each id as it becomes known (all nullable).
- **Dedupe/linking order** on every dim_post upsert: (1) exact `linkedin_url` equality against existing `dim_post` rows → reuse that row, fill the newly-learned typed-urn column; (2) `post_urn` match; (3) insert new. URL equality is the strong key in practice — the same post carries the same slug URL across export types.
- **App-post linking:** (1) exact `posts.linkedinUrl` string equality (today's `findByUrl` — proven to work for post #1); (2) URN comparison when both sides parse. **Known limitation, accepted:** a post whose app URL is activity-form while its export URL is share-form, with no exact-URL match, will not auto-link — `?postId=` is the escape hatch. Cross-type identity cannot be resolved from exports alone.

## Data model

Six new tables (drizzle `schema.ts` + one generated migration, next number 0010). Postgres is 16.x — `NULLS NOT DISTINCT` is available (note: in drizzle it lives on the `unique()` constraint builder, not `uniqueIndex()`). Fact `value` columns are `doublePrecision` (JS `number` round-trip; holds counts, seconds, and percents alike).

```
source_files
  id            serial PK
  sha256        text NOT NULL UNIQUE          -- idempotency key for whole files
  kind          enum('aggregate','single_post') NOT NULL
  original_name text NOT NULL
  window_start  date        -- aggregate: parsed from the Descoberta period row; null for single_post
  window_end    date
  imported_at   timestamptz NOT NULL          -- semantic capture instant; backfill sets legacy captured_at
  created_at    timestamptz NOT NULL default now()  -- row insert instant; backfill sets legacy created_at
  raw_path      text NULL                     -- uploads/analytics/<sha256>.xlsx; null for legacy rows w/o file

dim_post
  post_urn      text PK                       -- full typed urn, e.g. 'urn:li:share:<N>'
  activity_urn  text NULL                     -- each stored as learned; see Post identity
  share_urn     text NULL
  ugc_urn       text NULL
  post_id       integer NULL references posts(id) on delete set null
  linkedin_url  text NOT NULL                 -- as seen in the export
  published_at  timestamptz NULL              -- precision rule: full timestamp (single-post header or app post)
                                              -- never downgraded by the aggregate sheet's date-only value
  first_seen_source_file_id integer NOT NULL references source_files(id)

fact_profile_metric                            -- account level, date-stamped
  metric        text NOT NULL                 -- 'impressions' | 'engagements' | 'followers_new' | 'followers_total'
  date          date NOT NULL
  value         double precision NOT NULL
  source_file_id integer NOT NULL references source_files(id)
  PK (metric, date)                           -- upsert = last-write-wins

fact_post_lifetime                             -- per post, snapshot grain
  post_urn      text NOT NULL references dim_post(post_urn)
  metric        text NOT NULL                 -- registry below
  as_of_date    date NOT NULL                 -- capture date (America/Sao_Paulo); exports carry no as-of
  value         double precision NOT NULL
  source_file_id integer NOT NULL references source_files(id)
  PK (post_urn, metric, as_of_date)           -- upsert = last-write-wins

fact_window_metric                             -- account OR post, window grain
  id            serial PK
  post_urn      text NULL references dim_post(post_urn)       -- null = account level
  metric        text NOT NULL                 -- 'impressions' | 'members_reached' | 'engagements'
  window_start  date NOT NULL
  window_end    date NOT NULL
  value         double precision NOT NULL
  source_file_id integer NOT NULL references source_files(id)
  UNIQUE NULLS NOT DISTINCT (post_urn, metric, window_start, window_end)

fact_audience_segment                          -- account OR post, snapshot grain
  id            serial PK
  post_urn      text NULL references dim_post(post_urn)       -- null = account level
  dimension     text NOT NULL                 -- 'company'|'location'|'company_size'|'seniority'|'industry'|'job_title'
  segment       text NOT NULL                 -- the label, e.g. 'Engenheiro de software'
  value         double precision NOT NULL     -- raw number as exported; 'menos de 1%' → 0.5 (existing convention)
  unit          text NOT NULL                 -- 'percent' (all current sheets) | 'count' (future-proofing per design notes)
  as_of_date    date NOT NULL
  source_file_id integer NOT NULL references source_files(id)
  UNIQUE NULLS NOT DISTINCT (post_urn, dimension, segment, as_of_date)
```

**Deliberately absent:** `fact_post_metric` (per-post **daily**). No export contains per-post daily data — that grain exists only in the official API. Creating it now would be a dead table; the API adapter adds it if access ever opens.

**Grain rules (restated because they are the whole point):** daily facts never receive window totals; lifetime facts never receive windowed numbers; window facts always carry their window bounds. "Impressões" on a single-post export is lifetime; on the Engajamento sheet it is daily; on Descoberta/top-posts it is windowed — three different rows in three different tables, never coerced.

### Metric name registry (canonical snake_case ← pt-BR label)

Single-post lifetime: `impressions` ← Impressões · `members_reached` ← Usuários alcançados · `reactions` ← Reações (first occurrence wins, existing convention) · `comments` ← Comentários · `reposts` ← the reposts label (verify against fixture; compat maps it back to the `shares` DTO field) · `saves` ← Salvamentos · `profile_views` ← Visualizações do perfil · `follows_gained` ← Seguidores obtidos · video posts only: `video_views` ← Visualizações de vídeo · `video_watch_time_seconds` ← Tempo de visualização (parse "20 min15 seg" → 1215) · `video_avg_watch_time_seconds` ← Tempo médio de visualização.

Aggregate: Engajamento sheet → `impressions`, `engagements` daily rows. Seguidores sheet → `followers_total` (the snapshot header row, dated by its own "em <date>") + `followers_new` daily rows. Descoberta → account-level `impressions` + `members_reached` window rows. Top-posts sheet → per-post `engagements` and `impressions` window rows (both sub-tables), plus `dim_post` upserts from URL + publish date.

**Registry is a floor (decision 4).** At implementation time, every labeled numeric row in the committed fixtures must be enumerated; anything not in the registry gets added (snake_case translation) or placed on the **explicit skip-list**, which starts as: repeated sub-breakdown occurrences of an already-captured label (the first-occurrence rule), and section-header rows with empty values. Exact pt-BR label strings are taken from the committed fixtures, not from memory (design-notes Step 0). The existing parser's label map, `CATEGORY_MAP`, and `parsePercent` are reused/extended, not rewritten.

**Parser output invariant:** parsers emit row sets already deduplicated on their target PK (first-occurrence-wins applied at parse time) — a single upsert batch must never touch the same PK twice (Postgres error 21000 otherwise).

## Parsers & classification

- **Classify by sheet-name signature, never filename:** sheet set ⊇ {Engajamento, Seguidores, Dados demográficos} → aggregate; single sheet "Análise da publicação" → single_post; anything else → 400 listing the sheet names found. pt-BR only, matching the account locale (same assumption the current parser already makes — recorded, not silently baked).
- **Parse by label, never row position** (row counts differ between video and non-video posts; top-posts sub-tables pad with blanks).
- Two parser modules under `app/api/src/analytics/`: the existing `xlsx-parser.ts` refactored to emit canonical rows for single-post, plus a new aggregate parser. Both output plain row objects for the service to upsert — parsers never touch the DB.
- Dates: dd/mm/yyyy cell strings parsed as calendar parts (the `new Date('YYYY-MM-DD')` São Paulo trap from the roadmap applies); the Descoberta period row "11/05/2026 - 08/08/2026" yields window bounds, with the filename range as fallback.
- URN extraction: per "Post identity" above.

## Ingestion flow

`POST /analytics/import` (route unchanged; multipart `file`; Nest's default 201 status kept):

1. `sha256(buffer)` → if a `source_files` row exists and neither `?force` nor `?postId` is present → `201 { alreadyImported: true, sourceFileId, … }`, no writes. **With `?force` or `?postId`, a duplicate hash proceeds through the full parse/upsert/link path anyway** (upserts are idempotent; this is both the reparse-after-parser-fix path and the link-healing path — re-upload the file once the app post has its URL). `?force` additionally **deletes this file's previously-written fact rows** (`WHERE source_file_id = …`, all four fact tables) inside the transaction before re-upserting, so a fixed parser that stops emitting a wrong metric leaves no orphans.
2. Classify → parse → **write the raw file first**: save the buffer to the content-addressed path `uploads/analytics/<sha256>.xlsx` *before* the DB transaction. A transaction failure leaves an orphaned raw file, which is harmless and self-heals on retry (same path, same content); a committed `source_files` row therefore always has its file on disk.
3. **One transaction**: insert/lookup `source_files`, upsert `dim_post` rows (dedupe order per "Post identity"), upsert facts (`ON CONFLICT … DO UPDATE` — last-write-wins per the design notes; LinkedIn backfills and corrects).
4. **Post linking (single_post):** match per "Post identity" (exact URL first, URN second). Match → set `dim_post.post_id`; call `markMeasured` **only when the matched post's status is `published`** (already-`measured` posts no-op as today; any other status links but skips the transition and appends a warning — never throws). No match → **ingest anyway**, respond with `linkedPostId: null` plus a warning string; `?postId=` remains the manual override. Aggregate top-posts rows create/keep unlinked `dim_post`s the same way. The service keeps an internal `capturedAt` option (not exposed over HTTP) that drives `as_of_date` and `imported_at` — used by tests and the backfill.
5. Response: `{ sourceFileId, kind, linkedPostId, factCounts: { profile, lifetime, window, audience }, warnings: string[], alreadyImported?: true }`.

**Scoped web change (the one exception to "web untouched"):** the import response no longer carries `snapshotId`/`postId`, and `linkedPostId` may be null. `app/web/src/api/hooks.ts` (upload mutation response type) and `app/web/src/pages/Analytics.tsx` (success message; must present the unlinked-with-warning case) are updated accordingly. This falls under the out-of-scope clause's own carve-out ("beyond keeping current pages working"). No other web file changes.

## Backfill migration (0010)

Single SQL migration, in order:

1. DDL for the six tables.
2. For every `analytics_snapshots` row: extract the typed URN from the post's `linkedin_url` with the widened regex (post #1's `-share-…` URL yields `urn:li:share:9990000000000000101` — verified passing). **Any measured post whose URL yields no URN under the widened regex aborts the migration with an error naming the post** — fix the data, not the migration.
3. Synthesize `source_files` rows: `sha256` = file hash when `raw_file_path` exists on disk, else the sentinel `'legacy:'||id` (never collides with real sha256 hex); **identical content hashes collide on the UNIQUE constraint — on conflict, reuse the existing row** (two snapshots imported from the same file share one source_files row); `kind` = 'single_post'; `imported_at` = `captured_at`; `created_at` = legacy `created_at`; `raw_path` = existing path, or NULL.
4. Upsert `dim_post` per post (typed URN key; `linkedin_url`, `post_id`, `published_at` from the posts row); insert `fact_post_lifetime` rows for each non-null metric column (column→metric: `shares`→`reposts`, rest 1:1 snake_case) with `as_of_date = (captured_at AT TIME ZONE 'America/Sao_Paulo')::date`; explode the `demographics` jsonb (`{jobTitles|locations|seniority|companies|industries|companySizes: [{value, percent}]}`) into `fact_audience_segment` rows (unit 'percent', camelCase keys mapped to the dimension names above).
   - Two legacy snapshots of the same post on the same day collide on the lifetime PK; last-write-wins by `captured_at` order (matches the model's semantics). The raw files remain if history is ever wanted.
5. `DROP TABLE analytics_snapshots`.

File-hash and disk access don't exist in SQL: step 3's sha256-from-disk therefore runs as a **pre-migration script** (`app/api/scripts/` pattern) **or** the migration uses the `'legacy:'||id` sentinel unconditionally. The plan decides; the invariant is that migration 0010 leaves no `analytics_snapshots` table and loses no values.

## Compat read layer

`AnalyticsService` methods reimplemented over canonical tables, same DTO shapes:

- `forPost(postId)` → one `SnapshotRow` **per `as_of_date`** (the canonical model stores one lifetime value per metric per day — grouping by day, not by source file, avoids fragmentary rows when two same-day files carry different metric sets). Field synthesis: metrics pivoted from `fact_post_lifetime` (`reposts`→`shares`; absent metrics → null); `demographics` reassembled from post-level `fact_audience_segment` rows; per row, the **newest contributing source file** supplies `id` (= source_file id), `capturedAt` (= `imported_at`), `createdAt` (= `created_at`), `rawFilePath`; `postId` = the app post id. Ordered by `capturedAt` desc.
- `latestByPost()` / `trends()` → same pivot, newest day per post.
- `countMeasuredSince(t)` → compares `source_files.created_at` (row-insert instant — preserves today's `snap.createdAt` semantics exactly; `imported_at` would be wrong because the backfill backdates it and retro eligibility must not flip).
- `engagementRate` in `@forge/shared` is unchanged (fed by the pivoted shape).
- Deleted: `addManual`, `POST /analytics/snapshots`, `ManualSnapshotSchema`/`ManualSnapshot`. `GET /analytics/posts/:postId` and `GET /analytics/trends` keep their contracts.

Phase 4 queries the canonical tables natively and retires the pivot.

## Error handling

- Unknown sheet signature → 400 with the sheet names found. Missing expected labels → 400 `XlsxShapeError` naming the missing labels (existing class). A single-post export whose `URL da publicação` yields no URN under the widened regex → 400 (malformed file); aggregate top-posts rows with unparseable URLs are skipped with a warning instead (one bad row shouldn't kill 49 good ones).
- Ingest DB writes are transactional — a failed parse or upsert leaves zero rows. Raw-file archival precedes the transaction (step 2 above), so no committed row ever lacks its file.
- Duplicate upload is a success (`alreadyImported: true`), not an error.

## Testing & verification

- **Fixtures:** redacted copies of the real exports committed under `app/api/test/fixtures/analytics/` — one AggregateAnalytics, one video SinglePost and one non-video SinglePost (both exist among the discovered files — 41-row vs 56-row variants), the twin pair (same post, impressions 1200 vs 1205) for the last-write-wins test, and **one synthetic single-post fixture whose URL matches no app post** (for the unlinked path and the smoke probe). Redaction = replace demographic segment labels/URLs' personal remnants; structure and numbers stay real (Step 0 of the design notes). Note: the twin pair is post #1's own post — it links to a real post, so tests using it must run against test-DB seeds only.
- **Test-suite reality (the wave killed the "208 stays green" gate):** the plan must **enumerate every existing test that encodes behavior this spec deletes or inverts** — at minimum: addManual/`POST /analytics/snapshots` tests, the 404-on-unlinked import test, and import-response-shape assertions in `analytics.spec` / `seed.spec` / `e2e-happy-path` — and specify each one's new assertion. These are batch-fixed at the baseline step, per pipeline rules. `retro.spec`-style programmatic snapshot needs are served by the internal canonical-rows test helper (decision 5). The compat proof is: **tests against `GET /analytics/posts/:postId` and `GET /analytics/trends` pass unchanged**; the measured baseline test count is recorded at plan-authoring time (the "208" figure is stale).
- **Unit/integration:** classification per fixture; each sheet lands in the right table with the right grain; label-driven parsing survives the video/non-video row-count difference; parser-output PK-dedup invariant; re-import of the same file is a no-op; twin pair: second import overwrites (1200 → 1205) at the same PK; unlinked ingest then link-healing via re-upload with `?postId`; `?force` removes obsolete rows; backfill migration against a seeded old-shape table (values, dates, demographics all survive; same-day collapse rule; sha256-collision reuse; table dropped).
- **Gates:** root scripts exclude web — gate explicitly with `cd app/web && npm run typecheck && npm run lint`.
- **Browser truth:** extend `app/api/scripts/route-smoke.mjs` with an import probe that exercises the **unlinked path**: upload the synthetic fixture with **no `?postId`**, assert `linkedPostId: null` + a warning + non-zero `factCounts`, then restore by deleting the created fact rows, `dim_post` row, and `source_files` row (the script gains a `pg` client via `DATABASE_URL`, same source as `migrate.ts`) so re-runs re-ingest. The probe never touches `markMeasured`, any real post, post #5's status, or the settings row.

## Out of scope (named so nobody "helpfully" adds them)

Downloads watcher; any web/UI change beyond the scoped import-response handling above; analytics data viz (phase 4); the audience-page and dashboard-page export types (not in hand — unknown signatures 400 cleanly and the raw file can be retried after a parser lands); API adapter; `PostsService.allPublished()` cleanup (carried-forward issue, separate).

## Process next

The one review wave has run and been consolidated into this revision — **no second wave**. Next: plan (`writing-plans`, fable) → fresh **opus** session executes. The verifier gate and the test suite cover what a second wave would.
