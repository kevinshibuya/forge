ALTER TABLE "posts" ADD COLUMN "scheduled_date" date;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_time" time;--> statement-breakpoint
UPDATE "posts" SET
  "scheduled_date" = ("scheduled_slot" AT TIME ZONE 'America/Sao_Paulo')::date,
  "scheduled_time" = ("scheduled_slot" AT TIME ZONE 'America/Sao_Paulo')::time
WHERE "scheduled_slot" IS NOT NULL AND "published_at" IS NULL;