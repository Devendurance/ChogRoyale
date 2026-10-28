CREATE TABLE "bot_gold_awards" (
	"match_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"result" text NOT NULL,
	"difficulty" text NOT NULL,
	"policy_version" integer NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_gold_awards_pk" PRIMARY KEY("match_id","player_id"),
	CONSTRAINT "bot_gold_awards_amount_check" CHECK ("bot_gold_awards"."amount" >= 0),
	CONSTRAINT "bot_gold_awards_result_check" CHECK ("bot_gold_awards"."result" in ('win','loss','draw'))
);
--> statement-breakpoint
CREATE TABLE "bot_matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"difficulty" text NOT NULL,
	"source" text DEFAULT 'unranked-fallback' NOT NULL,
	"policy_version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"commands" jsonb NOT NULL,
	"human_seat" smallint NOT NULL,
	"live_hash" text NOT NULL,
	"replay_hash" text NOT NULL,
	"replay_identical" boolean NOT NULL,
	"winner_seat" smallint,
	"ticks" integer NOT NULL,
	"human_deploys" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_matches_difficulty_check" CHECK ("bot_matches"."difficulty" in ('medium','hard')),
	CONSTRAINT "bot_matches_source_check" CHECK ("bot_matches"."source" = 'unranked-fallback'),
	CONSTRAINT "bot_matches_status_check" CHECK ("bot_matches"."status" in ('pending','awarded','refused','capped'))
);
--> statement-breakpoint
ALTER TABLE "bot_gold_awards" ADD CONSTRAINT "bot_gold_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_matches" ADD CONSTRAINT "bot_matches_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_gold_awards_player_idx" ON "bot_gold_awards" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "bot_matches_player_idx" ON "bot_matches" USING btree ("player_id");