ALTER TABLE "users" ADD COLUMN "persona_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "persona_weight" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_persona_key_unique" ON "users" USING btree ("persona_key") WHERE "users"."persona_key" is not null;