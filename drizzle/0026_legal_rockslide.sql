CREATE TABLE "account_xp_awards" (
	"player_id" uuid NOT NULL,
	"source" text NOT NULL,
	"match_id" text NOT NULL,
	"pvp_match_id" uuid,
	"bot_match_id" text,
	"result" text NOT NULL,
	"amount" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_xp_awards_pk" PRIMARY KEY("player_id","source","match_id"),
	CONSTRAINT "account_xp_awards_source_check" CHECK ("account_xp_awards"."source" in ('matchmaking','unranked-fallback')),
	CONSTRAINT "account_xp_awards_result_check" CHECK ("account_xp_awards"."result" in ('win','loss','draw')),
	CONSTRAINT "account_xp_awards_amount_check" CHECK ("account_xp_awards"."amount" >= 0),
	CONSTRAINT "account_xp_awards_source_fk_check" CHECK (("account_xp_awards"."source" = 'matchmaking' and "account_xp_awards"."pvp_match_id" is not null and "account_xp_awards"."bot_match_id" is null) or ("account_xp_awards"."source" = 'unranked-fallback' and "account_xp_awards"."bot_match_id" is not null and "account_xp_awards"."pvp_match_id" is null))
);
--> statement-breakpoint
CREATE TABLE "account_xp_release" (
	"id" smallint PRIMARY KEY NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_xp_release_singleton_check" CHECK ("account_xp_release"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "account_xp_runs" (
	"player_id" uuid NOT NULL,
	"source" text NOT NULL,
	"match_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"awards_created" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_xp_runs_pk" PRIMARY KEY("player_id","source","match_id"),
	CONSTRAINT "account_xp_runs_source_check" CHECK ("account_xp_runs"."source" in ('matchmaking','unranked-fallback')),
	CONSTRAINT "account_xp_runs_status_check" CHECK ("account_xp_runs"."status" in ('pending','done','refused','capped'))
);
--> statement-breakpoint
ALTER TABLE "account_xp_awards" ADD CONSTRAINT "account_xp_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_xp_awards" ADD CONSTRAINT "account_xp_awards_pvp_match_id_matches_id_fk" FOREIGN KEY ("pvp_match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_xp_awards" ADD CONSTRAINT "account_xp_awards_bot_match_id_bot_matches_match_id_fk" FOREIGN KEY ("bot_match_id") REFERENCES "public"."bot_matches"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_xp_runs" ADD CONSTRAINT "account_xp_runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_xp_awards_player_idx" ON "account_xp_awards" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "account_xp_runs_pending_idx" ON "account_xp_runs" USING btree ("status","created_at");