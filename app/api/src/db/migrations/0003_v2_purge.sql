DELETE FROM "runs" WHERE "kind"::text = 'image_brief';--> statement-breakpoint
ALTER TYPE "public"."run_kind" RENAME TO "run_kind_old";--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('draft', 'triage', 'image_html', 'image_gen', 'image_review', 'retro', 'image_hybrid', 'image_plan');--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "kind" SET DATA TYPE "public"."run_kind" USING "kind"::text::"public"."run_kind";--> statement-breakpoint
DROP TYPE "public"."run_kind_old";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "image_brief";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "verification";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "image_prompt" text;
