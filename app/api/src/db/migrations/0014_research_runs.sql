ALTER TABLE "runs" ADD COLUMN "research" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "staged_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "staged_dir" text;
