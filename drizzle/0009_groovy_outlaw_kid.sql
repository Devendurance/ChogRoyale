CREATE TABLE "match_legacy_runs" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"events_created" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "match_legacy_runs_status_check" CHECK ("match_legacy_runs"."status" in ('done','no-eligible'))
);
--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "entitlement_owner" text;--> statement-breakpoint
ALTER TABLE "match_legacy_runs" ADD CONSTRAINT "match_legacy_runs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_owner_check" CHECK ("match_participants"."entitlement_owner" is null or "match_participants"."entitlement_owner" ~ '^0x[0-9a-f]{40}$');