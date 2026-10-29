CREATE TABLE "account_xp_award_claims" (
	"player_id" uuid NOT NULL,
	"source" text NOT NULL,
	"match_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_xp_award_claims_pk" PRIMARY KEY("player_id","source","match_id"),
	CONSTRAINT "account_xp_award_claims_source_check" CHECK ("account_xp_award_claims"."source" in ('matchmaking','unranked-fallback'))
);
--> statement-breakpoint
ALTER TABLE "account_xp_award_claims" ADD CONSTRAINT "account_xp_award_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;