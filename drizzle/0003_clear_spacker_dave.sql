CREATE TABLE "commander_rulesets" (
	"version" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commanders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nft_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"token_id" text NOT NULL,
	"class" text NOT NULL,
	"affinity" text,
	"stats" jsonb NOT NULL,
	"abilities" jsonb NOT NULL,
	"variant" text NOT NULL,
	"prestige" text,
	"source_traits" jsonb NOT NULL,
	"unmatched_traits" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"power_score" integer,
	"content_hash" text NOT NULL,
	"previous_content_hash" text,
	"derivation_count" integer DEFAULT 1 NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commanders_class_check" CHECK ("commanders"."class" in ('bulwark','reaver','deadeye','scout','warden'))
);
--> statement-breakpoint
ALTER TABLE "commanders" ADD CONSTRAINT "commanders_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commanders" ADD CONSTRAINT "commanders_ruleset_version_commander_rulesets_version_fk" FOREIGN KEY ("ruleset_version") REFERENCES "public"."commander_rulesets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commanders_nft_ruleset_unique" ON "commanders" USING btree ("nft_id","ruleset_version");--> statement-breakpoint
CREATE INDEX "commanders_token_idx" ON "commanders" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "commanders_class_idx" ON "commanders" USING btree ("class");