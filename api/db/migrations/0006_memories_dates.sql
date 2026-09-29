-- Add date/time columns to memories for planner placement.
--
-- `occurred_on` is NOT NULL going forward, but the live DB already has
-- memories rows (from earlier seed runs). The `coalesce` backfills any
-- rows that have a NULL or unparseable `created_at` to `current_date`
-- so one bad row can't fail the migration. After the UPDATE we can
-- safely ALTER COLUMN ... SET NOT NULL.

--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "occurred_on" date;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "end_time" time;--> statement-breakpoint
UPDATE "memories" SET "occurred_on" = COALESCE("occurred_on", "created_at"::date, CURRENT_DATE) WHERE "occurred_on" IS NULL;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "occurred_on" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "memories_user_date_idx" ON "memories" USING btree ("user_id","occurred_on");
