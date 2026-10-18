CREATE TABLE "legacy_achievements" (
	"code" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"eligibility" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_achievement_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nft_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"achievement_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_legacy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authority_key" text NOT NULL,
	"nft_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"category" text NOT NULL,
	"match_id" text,
	"match_status" text,
	"payload" jsonb NOT NULL,
	"ruleset_refs" jsonb NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"supersedes_event_id" uuid,
	"status" text DEFAULT 'recorded' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nft_legacy_events_category_check" CHECK ("nft_legacy_events"."category" in ('patron_appearance','commander_appearance','commander_outcome','achievement')),
	CONSTRAINT "nft_legacy_events_status_check" CHECK ("nft_legacy_events"."status" in ('recorded','corrected')),
	CONSTRAINT "nft_legacy_events_token_id_check" CHECK ("nft_legacy_events"."token_id" ~ '^[0-9]{1,78}$')
);
--> statement-breakpoint
ALTER TABLE "nft_achievement_awards" ADD CONSTRAINT "nft_achievement_awards_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_achievement_awards" ADD CONSTRAINT "nft_achievement_awards_achievement_code_legacy_achievements_code_fk" FOREIGN KEY ("achievement_code") REFERENCES "public"."legacy_achievements"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_legacy_events" ADD CONSTRAINT "nft_legacy_events_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nft_achievement_awards_nft_code_unique" ON "nft_achievement_awards" USING btree ("nft_id","achievement_code");--> statement-breakpoint
CREATE INDEX "nft_achievement_awards_nft_idx" ON "nft_achievement_awards" USING btree ("nft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nft_legacy_events_authority_key_unique" ON "nft_legacy_events" USING btree ("authority_key");--> statement-breakpoint
CREATE INDEX "nft_legacy_events_nft_created_idx" ON "nft_legacy_events" USING btree ("nft_id","created_at");--> statement-breakpoint
CREATE INDEX "nft_legacy_events_match_idx" ON "nft_legacy_events" USING btree ("match_id");