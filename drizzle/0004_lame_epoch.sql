CREATE TABLE "arena_patron_rulesets" (
	"version" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patron_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_key" text NOT NULL,
	"nft_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"ruleset_version" text NOT NULL,
	"commander_ruleset_version" text NOT NULL,
	"server_seed" text NOT NULL,
	"patron_config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"trait_snapshot" jsonb NOT NULL,
	"metadata_content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patron_assignments_token_id_check" CHECK ("patron_assignments"."token_id" ~ '^[0-9]{1,78}$')
);
--> statement-breakpoint
ALTER TABLE "patron_assignments" ADD CONSTRAINT "patron_assignments_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patron_assignments_match_key_unique" ON "patron_assignments" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "patron_assignments_token_idx" ON "patron_assignments" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "patron_assignments_nft_idx" ON "patron_assignments" USING btree ("nft_id");