-- published ⇒ no schedule.
-- 0007 established this invariant for the rows that existed at the time, but publish() kept
-- writing published rows that retained their old plan. Re-assert it for anything written since.
UPDATE "posts" SET "scheduled_date" = NULL, "scheduled_time" = NULL
WHERE "published_at" IS NOT NULL AND ("scheduled_date" IS NOT NULL OR "scheduled_time" IS NOT NULL);
