CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."asset_lane" AS ENUM('html', 'raster', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."embedding_source" AS ENUM('post', 'idea', 'inspiration', 'retro_note');--> statement-breakpoint
CREATE TYPE "public"."failure_kind" AS ENUM('timeout', 'quota', 'spawn_error', 'nonzero_exit', 'invalid_output', 'other');--> statement-breakpoint
CREATE TYPE "public"."idea_source" AS ENUM('work', 'news', 'evergreen', 'braindump');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'triaged', 'promoted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('queued', 'drafting', 'draft_ready', 'approved', 'published', 'measured');--> statement-breakpoint
CREATE TYPE "public"."post_tier" AS ENUM('T1', 'T2', 'T3');--> statement-breakpoint
CREATE TYPE "public"."rule_category" AS ENUM('voice', 'structure', 'visual', 'timing', 'cadence', 'platform');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."run_engine" AS ENUM('claude', 'codex');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('draft', 'triage', 'image_html', 'image_gen', 'image_review', 'retro');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed', 'timeout');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"impressions" integer NOT NULL,
	"members_reached" integer,
	"reactions" integer NOT NULL,
	"comments" integer NOT NULL,
	"shares" integer NOT NULL,
	"saves" integer NOT NULL,
	"follows_gained" integer,
	"profile_views" integer,
	"demographics" jsonb,
	"raw_file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"lane" "asset_lane" NOT NULL,
	"html_source" text,
	"generation_prompt" text,
	"png_path" text,
	"width" integer,
	"height" integer,
	"candidate_group_id" text,
	"is_selected" boolean DEFAULT false NOT NULL,
	"review_score" integer,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embedding_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" "embedding_source" NOT NULL,
	"source_id" integer NOT NULL,
	"chunks" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" "embedding_source" NOT NULL,
	"source_id" integer NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"source" "idea_source" NOT NULL,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"suggested_tier" "post_tier",
	"news_expiry" timestamp with time zone,
	"notes" text,
	"promoted_post_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspirations" (
	"id" serial PRIMARY KEY NOT NULL,
	"author" text NOT NULL,
	"url" text,
	"body" text NOT NULL,
	"image_path" text,
	"why_it_works" text,
	"approx_metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbook_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "rule_category" NOT NULL,
	"rule" text NOT NULL,
	"rationale" text,
	"provenance" text NOT NULL,
	"status" "rule_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier" "post_tier" NOT NULL,
	"status" "post_status" DEFAULT 'queued' NOT NULL,
	"hook" text,
	"body_linkedin" text,
	"body_x" text,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"topic_tags" text[] DEFAULT '{}' NOT NULL,
	"scheduled_slot" timestamp with time zone,
	"published_at" timestamp with time zone,
	"linkedin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"engine" "run_engine" NOT NULL,
	"kind" "run_kind" NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"output" text,
	"parsed_ok" boolean,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"failure_kind" "failure_kind",
	"error" text,
	"post_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_source_chunk_uq" ON "embeddings" USING btree ("source_type","source_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_cosine_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);