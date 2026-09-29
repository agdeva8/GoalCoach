-- Conversations table + backfill.
--
-- Each pre-existing user gets exactly one `general` conversation so the new
-- NOT NULL `messages.conversation_id` / `proposals.conversation_id` columns
-- can be enforced without orphaning any rows.
--
-- Order matters:
--   1. CREATE TABLE conversations (no FK yet, so we can insert freely)
--   2. Backfill: insert one row per user_id that has at least one message or
--      proposal. The id is deterministic ('conv_general_<user_id>') so the
--      script in scripts/reset-dev-data.ts and any future manual reseed can
--      reuse it.
--   3. ADD COLUMN conversation_id (NULLABLE) to messages and proposals.
--   4. UPDATE rows to point at their user's general conversation.
--   5. ALTER COLUMN ... SET NOT NULL (now safe).
--   6. ADD FK constraints + indexes.

--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"goal_id" text,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_open_idx" ON "conversations" USING btree ("user_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "conversations_user_recent_idx" ON "conversations" USING btree ("user_id","last_message_at" DESC NULLS LAST);
--> statement-breakpoint

-- Backfill: one general conversation per user that has any messages or
-- proposals. Use the user's earliest created_at as the conversation's
-- created_at so the backfill matches the data we already have.
INSERT INTO conversations (id, user_id, kind, title, status, created_at, last_message_at)
SELECT
  'conv_general_' || u.id,
  u.id,
  'general',
  '',
  'open',
  COALESCE(
    (SELECT MIN(m.created_at) FROM messages m WHERE m.user_id = u.id),
    (SELECT MIN(p.created_at) FROM proposals p WHERE p.user_id = u.id),
    u.created_at
  ),
  COALESCE(
    (SELECT MAX(m.created_at) FROM messages m WHERE m.user_id = u.id),
    (SELECT MAX(p.created_at) FROM proposals p WHERE p.user_id = u.id),
    u.created_at
  )
FROM users u
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id)
   OR EXISTS (SELECT 1 FROM proposals p WHERE p.user_id = u.id)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- Also seed a `general` conversation for every user that has no messages or
-- proposals yet — the FK from messages.conversation_id expects this row to
-- exist the moment the user posts their first message.
INSERT INTO conversations (id, user_id, kind, title, status, created_at, last_message_at)
SELECT
  'conv_general_' || u.id,
  u.id,
  'general',
  '',
  'open',
  u.created_at,
  u.created_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM conversations c WHERE c.id = 'conv_general_' || u.id
)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE "messages" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "conversation_id" text;--> statement-breakpoint
UPDATE "messages" SET "conversation_id" = 'conv_general_' || "user_id" WHERE "conversation_id" IS NULL;--> statement-breakpoint
UPDATE "proposals" SET "conversation_id" = 'conv_general_' || "user_id" WHERE "conversation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_conversation_created_idx" ON "proposals" USING btree ("conversation_id","created_at");
