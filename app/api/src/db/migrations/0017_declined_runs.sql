ALTER TYPE "public"."failure_kind" ADD VALUE 'declined';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "declined" jsonb;