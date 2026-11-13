CREATE TYPE "public"."source_file_kind" AS ENUM('aggregate', 'single_post');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dim_post" (
	"post_urn" text PRIMARY KEY NOT NULL,
	"activity_urn" text,
	"share_urn" text,
	"ugc_urn" text,
	"post_id" integer,
	"linkedin_url" text NOT NULL,
	"published_at" timestamp with time zone,
	"first_seen_source_file_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact_audience_segment" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_urn" text,
	"dimension" text NOT NULL,
	"segment" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"as_of_date" date NOT NULL,
	"source_file_id" integer NOT NULL,
	CONSTRAINT "fact_audience_segment_grain_uq" UNIQUE NULLS NOT DISTINCT("post_urn","dimension","segment","as_of_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact_post_lifetime" (
	"post_urn" text NOT NULL,
	"metric" text NOT NULL,
	"as_of_date" date NOT NULL,
	"value" double precision NOT NULL,
	"source_file_id" integer NOT NULL,
	CONSTRAINT "fact_post_lifetime_post_urn_metric_as_of_date_pk" PRIMARY KEY("post_urn","metric","as_of_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact_profile_metric" (
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"value" double precision NOT NULL,
	"source_file_id" integer NOT NULL,
	CONSTRAINT "fact_profile_metric_metric_date_pk" PRIMARY KEY("metric","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact_window_metric" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_urn" text,
	"metric" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"value" double precision NOT NULL,
	"source_file_id" integer NOT NULL,
	CONSTRAINT "fact_window_metric_grain_uq" UNIQUE NULLS NOT DISTINCT("post_urn","metric","window_start","window_end")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"kind" "source_file_kind" NOT NULL,
	"original_name" text NOT NULL,
	"window_start" date,
	"window_end" date,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_path" text,
	CONSTRAINT "source_files_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dim_post" ADD CONSTRAINT "dim_post_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dim_post" ADD CONSTRAINT "dim_post_first_seen_source_file_id_source_files_id_fk" FOREIGN KEY ("first_seen_source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_audience_segment" ADD CONSTRAINT "fact_audience_segment_post_urn_dim_post_post_urn_fk" FOREIGN KEY ("post_urn") REFERENCES "public"."dim_post"("post_urn") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_audience_segment" ADD CONSTRAINT "fact_audience_segment_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_post_lifetime" ADD CONSTRAINT "fact_post_lifetime_post_urn_dim_post_post_urn_fk" FOREIGN KEY ("post_urn") REFERENCES "public"."dim_post"("post_urn") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_post_lifetime" ADD CONSTRAINT "fact_post_lifetime_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_profile_metric" ADD CONSTRAINT "fact_profile_metric_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_window_metric" ADD CONSTRAINT "fact_window_metric_post_urn_dim_post_post_urn_fk" FOREIGN KEY ("post_urn") REFERENCES "public"."dim_post"("post_urn") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_window_metric" ADD CONSTRAINT "fact_window_metric_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ===========================================================================
-- Backfill: analytics_snapshots -> canonical model, then drop the old table.
-- Hand-written below this line; the DDL above is drizzle-kit generated.
--
-- Ordering rule used throughout: later `captured_at` wins on every PK/unique
-- collision, which is the model's last-write-wins semantics. Because a single
-- INSERT ... ON CONFLICT cannot touch the same key twice (SQLSTATE 21000),
-- the winner is picked with DISTINCT ON *inside* each statement rather than
-- being left to the conflict clause.
-- ===========================================================================

-- Guard: every snapshot-bearing post must yield a typed URN, or we would lose
-- its numbers. Scoped to posts that actually carry snapshots — those are the
-- only rows this migration must preserve (a measured post with no snapshot has
-- nothing to migrate), and it is the scope the "TRUNCATE analytics_snapshots"
-- remedy on a disposable test database can actually clear.
DO $$
DECLARE offender record;
BEGIN
  SELECT p.id AS post_id, p.status, p.linkedin_url
    INTO offender
    FROM posts p
   WHERE EXISTS (SELECT 1 FROM analytics_snapshots s WHERE s.post_id = p.id)
     AND (p.linkedin_url IS NULL
          OR substring(p.linkedin_url from '(?:activity|share|ugcPost)[:-](\d+)') IS NULL)
   ORDER BY p.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'migration 0010: post % (status %) has analytics snapshots but its linkedin_url yields no post URN: % — fix the data, not the migration',
      offender.post_id, offender.status, coalesce(offender.linkedin_url, '(null)');
  END IF;
END $$;
--> statement-breakpoint
-- One source_files row per legacy snapshot. sha256 is the sentinel 'legacy:<id>',
-- unconditionally: hashing the archived file would need disk access SQL does not
-- have. The ON CONFLICT clause honours the "reuse the existing row" rule even
-- though the sentinel cannot collide with a real hex digest.
INSERT INTO "source_files" ("sha256", "kind", "original_name", "imported_at", "created_at", "raw_path")
SELECT 'legacy:' || s."id",
       'single_post',
       coalesce(split_part(s."raw_file_path", '/', -1), 'legacy-snapshot-' || s."id" || '.xlsx'),
       s."captured_at",
       s."created_at",
       s."raw_file_path"
  FROM "analytics_snapshots" s
 ORDER BY s."captured_at" ASC, s."id" ASC
ON CONFLICT ("sha256") DO NOTHING;
--> statement-breakpoint
-- One dim_post per typed URN; the earliest capture is the "first seen" file.
INSERT INTO "dim_post" (
  "post_urn", "activity_urn", "share_urn", "ugc_urn",
  "post_id", "linkedin_url", "published_at", "first_seen_source_file_id"
)
SELECT DISTINCT ON (l.urn)
       l.urn,
       CASE WHEN l.urn_type = 'activity' THEN l.urn END,
       CASE WHEN l.urn_type = 'share'    THEN l.urn END,
       CASE WHEN l.urn_type = 'ugcPost'  THEN l.urn END,
       l.post_id,
       l.linkedin_url,
       l.post_published_at,
       l.source_file_id
  FROM (
    SELECT s."id" AS snap_id, s."captured_at", s."post_id",
           p."linkedin_url", p."published_at" AS post_published_at,
           sf."id" AS source_file_id,
           'urn:li:'
             || substring(p."linkedin_url" from '(activity|share|ugcPost)[:-]\d+')
             || ':'
             || substring(p."linkedin_url" from '(?:activity|share|ugcPost)[:-](\d+)') AS urn,
           substring(p."linkedin_url" from '(activity|share|ugcPost)[:-]\d+') AS urn_type
      FROM "analytics_snapshots" s
      JOIN "posts" p ON p."id" = s."post_id"
      JOIN "source_files" sf ON sf."sha256" = 'legacy:' || s."id"
  ) l
 ORDER BY l.urn, l."captured_at" ASC, l.snap_id ASC
ON CONFLICT ("post_urn") DO NOTHING;
--> statement-breakpoint
-- Lifetime facts: one row per non-null legacy metric column. `shares` -> `reposts`;
-- as_of is the capture date in the account's zone, so two same-day snapshots collapse
-- onto one PK and the later capture wins.
INSERT INTO "fact_post_lifetime" ("post_urn", "metric", "as_of_date", "value", "source_file_id")
SELECT DISTINCT ON (e.urn, e.metric, e.as_of_date)
       e.urn, e.metric, e.as_of_date, e.value, e.source_file_id
  FROM (
    SELECT l.urn, m.metric, m.value::double precision AS value,
           (s."captured_at" AT TIME ZONE 'America/Sao_Paulo')::date AS as_of_date,
           sf."id" AS source_file_id, s."captured_at", s."id" AS snap_id
      FROM "analytics_snapshots" s
      JOIN "posts" p ON p."id" = s."post_id"
      JOIN "source_files" sf ON sf."sha256" = 'legacy:' || s."id"
      JOIN LATERAL (
        SELECT 'urn:li:'
                 || substring(p."linkedin_url" from '(activity|share|ugcPost)[:-]\d+')
                 || ':'
                 || substring(p."linkedin_url" from '(?:activity|share|ugcPost)[:-](\d+)') AS urn
      ) l ON true
      CROSS JOIN LATERAL (VALUES
        ('impressions',     s."impressions"),
        ('members_reached', s."members_reached"),
        ('reactions',       s."reactions"),
        ('comments',        s."comments"),
        ('reposts',         s."shares"),
        ('saves',           s."saves"),
        ('follows_gained',  s."follows_gained"),
        ('profile_views',   s."profile_views")
      ) AS m(metric, value)
     WHERE m.value IS NOT NULL
  ) e
 ORDER BY e.urn, e.metric, e.as_of_date, e."captured_at" DESC, e.snap_id DESC
ON CONFLICT ("post_urn", "metric", "as_of_date")
DO UPDATE SET "value" = EXCLUDED."value", "source_file_id" = EXCLUDED."source_file_id";
--> statement-breakpoint
-- Demographics jsonb -> audience segments. The six camelCase keys map onto the
-- canonical dimension vocabulary; every legacy percent is a 'percent' unit.
INSERT INTO "fact_audience_segment" (
  "post_urn", "dimension", "segment", "value", "unit", "as_of_date", "source_file_id"
)
SELECT DISTINCT ON (e.urn, e.dimension, e.segment, e.as_of_date)
       e.urn, e.dimension, e.segment, e.value, 'percent', e.as_of_date, e.source_file_id
  FROM (
    SELECT l.urn, d.dimension,
           el.value ->> 'value' AS segment,
           (el.value ->> 'percent')::double precision AS value,
           (s."captured_at" AT TIME ZONE 'America/Sao_Paulo')::date AS as_of_date,
           sf."id" AS source_file_id, s."captured_at", s."id" AS snap_id
      FROM "analytics_snapshots" s
      JOIN "posts" p ON p."id" = s."post_id"
      JOIN "source_files" sf ON sf."sha256" = 'legacy:' || s."id"
      JOIN LATERAL (
        SELECT 'urn:li:'
                 || substring(p."linkedin_url" from '(activity|share|ugcPost)[:-]\d+')
                 || ':'
                 || substring(p."linkedin_url" from '(?:activity|share|ugcPost)[:-](\d+)') AS urn
      ) l ON true
      CROSS JOIN (VALUES
        ('jobTitles',    'job_title'),
        ('locations',    'location'),
        ('seniority',    'seniority'),
        ('companies',    'company'),
        ('industries',   'industry'),
        ('companySizes', 'company_size')
      ) AS d(key, dimension)
      CROSS JOIN LATERAL jsonb_array_elements(s."demographics" -> d.key) AS el(value)
     WHERE jsonb_typeof(s."demographics" -> d.key) = 'array'
       AND el.value ->> 'value' IS NOT NULL
       AND el.value ->> 'percent' IS NOT NULL
  ) e
 ORDER BY e.urn, e.dimension, e.segment, e.as_of_date, e."captured_at" DESC, e.snap_id DESC
ON CONFLICT ("post_urn", "dimension", "segment", "as_of_date")
DO UPDATE SET "value" = EXCLUDED."value", "unit" = EXCLUDED."unit",
              "source_file_id" = EXCLUDED."source_file_id";
--> statement-breakpoint
DROP TABLE "analytics_snapshots";
