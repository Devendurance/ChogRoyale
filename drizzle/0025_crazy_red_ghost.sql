CREATE TABLE "bot_card_xp_awards" (
	"match_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"deployments" integer NOT NULL,
	"xp" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_card_xp_awards_pk" PRIMARY KEY("match_id","player_id","card_id"),
	CONSTRAINT "bot_card_xp_awards_deployments_check" CHECK ("bot_card_xp_awards"."deployments" >= 0),
	CONSTRAINT "bot_card_xp_awards_xp_check" CHECK ("bot_card_xp_awards"."xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bot_card_xp_runs" (
	"match_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"awards_created" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_card_xp_runs_pk" PRIMARY KEY("match_id","player_id"),
	CONSTRAINT "bot_card_xp_runs_status_check" CHECK ("bot_card_xp_runs"."status" in ('pending','done','refused','capped'))
);
--> statement-breakpoint
ALTER TABLE "bot_matches" ADD COLUMN "xp_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_card_xp_awards" ADD CONSTRAINT "bot_card_xp_awards_match_id_bot_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."bot_matches"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_card_xp_awards" ADD CONSTRAINT "bot_card_xp_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_card_xp_runs" ADD CONSTRAINT "bot_card_xp_runs_match_id_bot_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."bot_matches"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_card_xp_runs" ADD CONSTRAINT "bot_card_xp_runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_card_xp_awards_player_idx" ON "bot_card_xp_awards" USING btree ("player_id");