CREATE TYPE "public"."asset_origin" AS ENUM('generated', 'bg_refined', 'canvas_edited');--> statement-breakpoint
ALTER TYPE "public"."run_kind" ADD VALUE 'refine_selection';--> statement-breakpoint
ALTER TYPE "public"."run_kind" ADD VALUE 'image_refine';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"engine" "run_engine" NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"output" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"images_generated" integer,
	"failure_kind" "failure_kind",
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "run_id" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_asset_id" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "origin" "asset_origin" DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tokens_input" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tokens_output" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "images_generated" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
