ALTER TYPE "public"."run_kind" ADD VALUE 'image_brief';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "image_brief" jsonb;