-- Engine v2 (ADR 0019, 0026). The model registry replaces settings.models and settings.pricing,
-- one row per task and backend. The ledger takes one row per model call and attempt, and outlives
-- the run it describes. runs.engine and run_steps.engine become text, because on the api backend
-- the engine name is the provider. Cost is stored from here on: the backfill below prices the rows
-- that predate the ledger with the settings row's rates, the one read of settings.pricing left.
CREATE TABLE "model_registry" (
  "id" serial PRIMARY KEY,
  "task" text NOT NULL,
  "backend" text NOT NULL,
  "engine" text NOT NULL,
  "model" text NOT NULL,
  "effort" text,
  "max_output_tokens" integer NOT NULL DEFAULT 8192,
  "input_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "cache_write_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "cache_read_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "output_per_mtok" numeric(12,6) NOT NULL DEFAULT 0,
  "image_per_unit" numeric(12,6) NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "model_registry_task_backend_uq" UNIQUE ("task", "backend"),
  CONSTRAINT "model_registry_backend_ck" CHECK ("backend" IN ('api', 'cli'))
);--> statement-breakpoint
CREATE TABLE "ledger" (
  "id" serial PRIMARY KEY,
  "run_id" integer REFERENCES "runs"("id") ON DELETE SET NULL,
  "step_seq" integer,
  "attempt" integer NOT NULL DEFAULT 1,
  "backend" text NOT NULL,
  "engine" text NOT NULL,
  "model" text NOT NULL,
  "category" text NOT NULL,
  "exit" text NOT NULL,
  "tokens_input" integer,
  "tokens_cache_write" integer,
  "tokens_cache_read" integer,
  "tokens_output" integer,
  "images" integer,
  "cost_usd" numeric(12,6),
  "provider_request_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "ledger_run_idx" ON "ledger" ("run_id");--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "engine" TYPE text USING "engine"::text;--> statement-breakpoint
ALTER TABLE "run_steps" ALTER COLUMN "engine" TYPE text USING "engine"::text;--> statement-breakpoint
DROP TYPE "run_engine";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tokens_cache_write" integer, ADD COLUMN "tokens_cache_read" integer, ADD COLUMN "cost_usd" numeric(12,6);--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "tokens_cache_write" integer, ADD COLUMN "tokens_cache_read" integer, ADD COLUMN "cost_usd" numeric(12,6);--> statement-breakpoint
-- The read-time estimate, made permanent: a step or a single-call run prices when its model has a
-- perModel rate and it has a token count, or when it generated images. No settings row, no price.
WITH "p" AS (SELECT "data"->'pricing' AS "pricing" FROM "settings" ORDER BY "id" LIMIT 1)
UPDATE "run_steps" AS "s" SET "cost_usd" =
  CASE WHEN "p"."pricing"->'perModel'->"s"."model" IS NOT NULL
        AND ("s"."tokens_input" IS NOT NULL OR "s"."tokens_output" IS NOT NULL)
    THEN coalesce("s"."tokens_input", 0) / 1e6 * ("p"."pricing"->'perModel'->"s"."model"->>'inputPerMTok')::numeric
       + coalesce("s"."tokens_output", 0) / 1e6 * ("p"."pricing"->'perModel'->"s"."model"->>'outputPerMTok')::numeric
    ELSE 0 END
  + coalesce("s"."images_generated", 0) * coalesce(("p"."pricing"->>'imagePerUnit')::numeric, 0)
FROM "p"
WHERE ("p"."pricing"->'perModel'->"s"."model" IS NOT NULL
       AND ("s"."tokens_input" IS NOT NULL OR "s"."tokens_output" IS NOT NULL))
   OR "s"."images_generated" IS NOT NULL;--> statement-breakpoint
WITH "p" AS (SELECT "data"->'pricing' AS "pricing" FROM "settings" ORDER BY "id" LIMIT 1)
UPDATE "runs" AS "r" SET "cost_usd" =
  CASE WHEN "p"."pricing"->'perModel'->"r"."model" IS NOT NULL
        AND ("r"."tokens_input" IS NOT NULL OR "r"."tokens_output" IS NOT NULL)
    THEN coalesce("r"."tokens_input", 0) / 1e6 * ("p"."pricing"->'perModel'->"r"."model"->>'inputPerMTok')::numeric
       + coalesce("r"."tokens_output", 0) / 1e6 * ("p"."pricing"->'perModel'->"r"."model"->>'outputPerMTok')::numeric
    ELSE 0 END
  + coalesce("r"."images_generated", 0) * coalesce(("p"."pricing"->>'imagePerUnit')::numeric, 0)
FROM "p"
WHERE NOT EXISTS (SELECT 1 FROM "run_steps" WHERE "run_steps"."run_id" = "r"."id")
  AND (("p"."pricing"->'perModel'->"r"."model" IS NOT NULL
        AND ("r"."tokens_input" IS NOT NULL OR "r"."tokens_output" IS NOT NULL))
       OR "r"."images_generated" IS NOT NULL);--> statement-breakpoint
-- A managed run costs the sum of its steps, never its own totals; all steps unpriced stays null.
UPDATE "runs" AS "r" SET "cost_usd" = (SELECT sum("cost_usd") FROM "run_steps" WHERE "run_steps"."run_id" = "r"."id")
WHERE EXISTS (SELECT 1 FROM "run_steps" WHERE "run_steps"."run_id" = "r"."id");--> statement-breakpoint
-- The cli rows take their model from the settings row, else today's default. Every row, cli
-- included, carries the provider's list price for its model (2026-09-24); an unlisted model is 0.
WITH "list" ("model", "input", "cache_write", "cache_read", "output") AS (VALUES
  ('claude-opus-4-8', 5::numeric, 6.25::numeric, 0.5::numeric, 25::numeric),
  ('claude-sonnet-5', 2, 2.5, 0.2, 10),
  ('claude-haiku-4-5', 1, 1.25, 0.1, 5)
), "task" ("task", "default_model") AS (VALUES
  ('draft_t1', 'claude-opus-4-8'), ('draft_t2', 'claude-opus-4-8'), ('draft_t3', 'claude-sonnet-5'),
  ('triage', 'claude-sonnet-5'), ('image_html', 'claude-opus-4-8'), ('image_gen', 'gpt-image-2'),
  ('image_review', 'claude-opus-4-8'), ('retro', 'claude-opus-4-8')
), "chosen" AS (
  SELECT "t"."task",
         coalesce((SELECT "data"->'models'->>"t"."task" FROM "settings" ORDER BY "id" LIMIT 1), "t"."default_model") AS "model"
  FROM "task" AS "t"
)
INSERT INTO "model_registry" ("task", "backend", "engine", "model", "effort", "max_output_tokens",
  "input_per_mtok", "cache_write_per_mtok", "cache_read_per_mtok", "output_per_mtok", "image_per_unit")
SELECT "c"."task", 'cli', CASE WHEN "c"."task" = 'image_gen' THEN 'codex' ELSE 'claude' END, "c"."model", NULL,
       CASE WHEN "c"."task" LIKE 'draft\_%' THEN 16384 ELSE 8192 END,
       coalesce("l"."input", 0), coalesce("l"."cache_write", 0), coalesce("l"."cache_read", 0), coalesce("l"."output", 0),
       CASE WHEN "c"."task" = 'image_gen' THEN 0.25 ELSE 0 END
FROM "chosen" AS "c" LEFT JOIN "list" AS "l" ON "l"."model" = "c"."model";--> statement-breakpoint
-- The api rows: Sonnet 5 on every tier (the brief's working default), Haiku for triage with no
-- effort (the parameter errors on it). No image rows on api until slice 10.
INSERT INTO "model_registry" ("task", "backend", "engine", "model", "effort", "max_output_tokens",
  "input_per_mtok", "cache_write_per_mtok", "cache_read_per_mtok", "output_per_mtok", "image_per_unit") VALUES
  ('draft_t1', 'api', 'anthropic', 'claude-sonnet-5', 'high', 16384, 2, 2.5, 0.2, 10, 0),
  ('draft_t2', 'api', 'anthropic', 'claude-sonnet-5', 'high', 16384, 2, 2.5, 0.2, 10, 0),
  ('draft_t3', 'api', 'anthropic', 'claude-sonnet-5', 'medium', 16384, 2, 2.5, 0.2, 10, 0),
  ('triage', 'api', 'anthropic', 'claude-haiku-4-5', NULL, 2048, 1, 1.25, 0.1, 5, 0),
  ('retro', 'api', 'anthropic', 'claude-sonnet-5', 'high', 16384, 2, 2.5, 0.2, 10, 0);
