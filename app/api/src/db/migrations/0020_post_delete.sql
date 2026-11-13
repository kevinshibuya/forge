-- Post deletion. What a post owns goes with it; the run log and the analytics dimension keep
-- their rows and lose the pointer. 0019 wrote post_inputs' FK inline, so it carries Postgres's
-- default name; it is re-added under drizzle's so the four read alike.
ALTER TABLE "post_revisions" DROP CONSTRAINT "post_revisions_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_inputs" DROP CONSTRAINT "post_inputs_post_id_fkey";--> statement-breakpoint
ALTER TABLE "post_inputs" ADD CONSTRAINT "post_inputs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_post_id_posts_id_fk";--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "ideas" SET "promoted_post_id" = NULL WHERE "promoted_post_id" IS NOT NULL AND "promoted_post_id" NOT IN (SELECT "id" FROM "posts");--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_promoted_post_id_posts_id_fk" FOREIGN KEY ("promoted_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
