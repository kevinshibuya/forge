CREATE TYPE "input_kind" AS ENUM ('file', 'url', 'path');--> statement-breakpoint
CREATE TABLE "post_inputs" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL REFERENCES "posts"("id"),
  "kind" "input_kind" NOT NULL,
  "ref" text NOT NULL,
  "bytes" integer NOT NULL,
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "post_inputs_post_id_ref_unique" UNIQUE ("post_id", "ref")
);--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "staged_inputs" jsonb;
