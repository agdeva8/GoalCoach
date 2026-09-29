CREATE TABLE "timetable_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"block_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'commitment' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"goal_id" text,
	"goal_title" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timetable_blocks" ADD CONSTRAINT "timetable_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_blocks" ADD CONSTRAINT "timetable_blocks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timetable_blocks_user_date_idx" ON "timetable_blocks" USING btree ("user_id","block_date","start_time");
