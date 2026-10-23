CREATE TABLE "ranked_trophy_awards" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"result" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_trophy_awards_pk" PRIMARY KEY("match_id","player_id"),
	CONSTRAINT "ranked_trophy_awards_result_check" CHECK ("ranked_trophy_awards"."result" in ('win','loss','draw'))
);
--> statement-breakpoint
CREATE TABLE "ranked_trophy_balances" (
	"player_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"trophies" integer DEFAULT 0 NOT NULL,
	"ranked_matches" integer DEFAULT 0 NOT NULL,
	"ranked_wins" integer DEFAULT 0 NOT NULL,
	"ranked_losses" integer DEFAULT 0 NOT NULL,
	"ranked_draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_trophy_balances_pk" PRIMARY KEY("player_id","season"),
	CONSTRAINT "ranked_trophy_balances_trophies_check" CHECK ("ranked_trophy_balances"."trophies" >= 0),
	CONSTRAINT "ranked_trophy_balances_counters_check" CHECK ("ranked_trophy_balances"."ranked_matches" >= 0 and "ranked_trophy_balances"."ranked_wins" >= 0 and "ranked_trophy_balances"."ranked_losses" >= 0 and "ranked_trophy_balances"."ranked_draws" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ranked_trophy_awards" ADD CONSTRAINT "ranked_trophy_awards_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_trophy_awards" ADD CONSTRAINT "ranked_trophy_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_trophy_balances" ADD CONSTRAINT "ranked_trophy_balances_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ranked_trophy_awards_player_season_idx" ON "ranked_trophy_awards" USING btree ("player_id","season");--> statement-breakpoint
CREATE INDEX "ranked_trophy_balances_season_trophies_idx" ON "ranked_trophy_balances" USING btree ("season","trophies");