ALTER TABLE "posts" ADD COLUMN "sources" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "post_revisions" ADD COLUMN "sources" jsonb;
