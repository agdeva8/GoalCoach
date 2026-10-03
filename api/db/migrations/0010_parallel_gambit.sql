-- Iteration 10 (Goal Planner) — schema for the headroom-aware plan pipeline.
--
-- HAND-RECONCILED. `drizzle-kit generate` diffed against the stale
-- `0009_snapshot.json`, which predated the hand-written 0006/0007/0009
-- migrations and omitted the motivation tables. It therefore re-emitted
-- objects already applied to the live DB. Those are stripped below; the
-- generated `meta/0010_snapshot.json` is the correct full-schema baseline,
-- so future `db:generate` runs are clean.
--
-- Removed from the raw generated output (already live):
--   * CREATE TABLE motivation_cache / motivation_rejects / motivation_served_log  (0008)
--   * ALTER TABLE commitments ADD COLUMN note                                     (0007)
--   * ALTER TABLE conversations ADD COLUMN closed_at                              (0009)
--   * the DROP INDEX statements for the seven hand-created indexes (they never
--     actually existed on the live DB — see the CREATE INDEX IF NOT EXISTS block
--     at the end, which brings the DB in line with schema.ts)
--
-- New in this migration: daily_log + plan_rejects; weekly_hours /
-- phase_objectives / drift_status / life_area on goals; phase on milestones
-- and commitments; available_weekly_hours on users; conversations.kind's
-- default aligned to `schema.ts`; and the seven missing indexes.
--
-- NOTE: this file has NOT been applied to the shared DB. See the Slice 0
-- report for how to apply it.

CREATE TABLE "daily_log" (
	"user_id" text NOT NULL,
	"log_date" date NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_user_id_log_date_pk" PRIMARY KEY("user_id","log_date")
);
--> statement-breakpoint
CREATE TABLE "plan_rejects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"intent" text NOT NULL,
	"stage" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"raw_input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recovered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "kind" SET DEFAULT 'general';--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "phase" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "weekly_hours" integer;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "phase_objectives" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "drift_status" text DEFAULT 'on_track' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "life_area" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "phase" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "available_weekly_hours" integer;--> statement-breakpoint
ALTER TABLE "daily_log" ADD CONSTRAINT "daily_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rejects" ADD CONSTRAINT "plan_rejects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The seven indexes below are declared in schema.ts and captured in the
-- 0009/0010 snapshots, but the live DB never actually had them (the snapshot
-- came from a different dump). Create them so DB == schema. IF NOT EXISTS
-- keeps this safe on any environment that already has them.
CREATE INDEX IF NOT EXISTS "conversations_user_open_idx" ON "conversations" USING btree ("user_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_recent_idx" ON "conversations" USING btree ("user_id","last_message_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_user_date_idx" ON "memories" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_conversation_created_idx" ON "proposals" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timetable_blocks_user_date_idx" ON "timetable_blocks" USING btree ("user_id","block_date","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_persona_key_unique" ON "users" USING btree ("persona_key") WHERE "users"."persona_key" is not null;
