CREATE TABLE "match_evidence" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"format_version" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_sha256" text NOT NULL,
	CONSTRAINT "match_evidence_format_check" CHECK ("match_evidence"."format_version" = 1)
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"match_id" uuid NOT NULL,
	"seat" smallint NOT NULL,
	"player_id" uuid NOT NULL,
	"result" text NOT NULL,
	"crowns" smallint NOT NULL,
	"deck" text[] NOT NULL,
	"commander_kind" text NOT NULL,
	"commander_class" text NOT NULL,
	"nft_token_id" text,
	"commander_identity" jsonb NOT NULL,
	CONSTRAINT "match_participants_pk" PRIMARY KEY("match_id","seat"),
	CONSTRAINT "match_participants_seat_check" CHECK ("match_participants"."seat" in (0,1)),
	CONSTRAINT "match_participants_result_check" CHECK ("match_participants"."result" in ('win','loss','draw')),
	CONSTRAINT "match_participants_deck_check" CHECK (cardinality("match_participants"."deck") = 8),
	CONSTRAINT "match_participants_commander_kind_check" CHECK ("match_participants"."commander_kind" in ('free','nft'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"match_type" text NOT NULL,
	"ruleset_version" text,
	"protocol_version" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"winner_seat" smallint,
	"end_reason" text NOT NULL,
	"crowns_0" smallint NOT NULL,
	"crowns_1" smallint NOT NULL,
	"ticks" integer NOT NULL,
	"live_hash" text NOT NULL,
	"replay_hash" text NOT NULL,
	"evidence_sha256" text NOT NULL,
	"verification" text NOT NULL,
	CONSTRAINT "matches_match_type_check" CHECK ("matches"."match_type" in ('private','matchmaking')),
	CONSTRAINT "matches_outcome_check" CHECK ("matches"."outcome" in ('win','draw')),
	CONSTRAINT "matches_winner_check" CHECK (("matches"."outcome" = 'win' and "matches"."winner_seat" in (0,1)) or ("matches"."outcome" = 'draw' and "matches"."winner_seat" is null)),
	CONSTRAINT "matches_crowns_check" CHECK ("matches"."crowns_0" between 0 and 3 and "matches"."crowns_1" between 0 and 3),
	CONSTRAINT "matches_hash_equal_check" CHECK ("matches"."live_hash" = "matches"."replay_hash"),
	CONSTRAINT "matches_verification_check" CHECK ("matches"."verification" = 'replay-verified')
);
--> statement-breakpoint
ALTER TABLE "match_evidence" ADD CONSTRAINT "match_evidence_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_player_unique" ON "match_participants" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE INDEX "match_participants_player_match_idx" ON "match_participants" USING btree ("player_id","match_id");--> statement-breakpoint
CREATE INDEX "matches_settled_at_idx" ON "matches" USING btree ("settled_at","id");