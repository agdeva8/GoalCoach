-- Motivation pipeline tables (Iteration 6, Motivation Pipeline v1).
--
-- Adds three tables that back the recommendation pipeline at
-- api/lib/motivation/recommend.ts:
--
--   motivation_cache       — per-(user, bucket, state_hash) cache of
--                            the last-served items. 60m TTL.
--   motivation_rejects     — per-rejected-candidate log so we can tune
--                            weights and prompt over time. 30d retention
--                            via a follow-up cron (deferred).
--   motivation_served_log  — per-(user, date) served count, enforces
--                            DAILY_USER_CAP on cache misses.
--
-- Idempotent: every CREATE/INDEX uses IF NOT EXISTS so re-running the
-- migration (e.g. against a partially-applied DB) is a no-op.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motivation_cache" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bucket" text NOT NULL,
  "state_hash" text NOT NULL,
  "items" jsonb NOT NULL,
  "generated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "motivation_cache_pk" PRIMARY KEY ("user_id", "bucket", "state_hash")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motivation_cache_expires_idx"
  ON "motivation_cache" USING btree ("expires_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motivation_rejects" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bucket" text NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "score_breakdown" jsonb NOT NULL,
  "weighted_total" double precision NOT NULL,
  "top_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "gates_failed" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motivation_rejects_user_bucket_idx"
  ON "motivation_rejects" USING btree ("user_id", "bucket", "created_at" DESC);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motivation_served_log" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "served_on" date NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "motivation_served_log_pk" PRIMARY KEY ("user_id", "served_on")
);
