CREATE TABLE "chaos_rulesets" (
	"version" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_key" text NOT NULL,
	"chaos_ruleset_version" text NOT NULL,
	"patron_ruleset_version" text NOT NULL,
	"patron_config_hash" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"schedule_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pulse_schedules" ADD CONSTRAINT "pulse_schedules_match_key_patron_assignments_match_key_fk" FOREIGN KEY ("match_key") REFERENCES "public"."patron_assignments"("match_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pulse_schedules_match_key_unique" ON "pulse_schedules" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "pulse_schedules_hash_idx" ON "pulse_schedules" USING btree ("schedule_hash");