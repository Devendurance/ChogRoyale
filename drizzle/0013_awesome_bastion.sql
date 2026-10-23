CREATE TABLE "card_xp_awards" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"deployments" integer NOT NULL,
	"xp" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_xp_awards_pk" PRIMARY KEY("match_id","player_id","card_id"),
	CONSTRAINT "card_xp_awards_counts_check" CHECK ("card_xp_awards"."deployments" > 0 and "card_xp_awards"."xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "card_xp_progress" (
	"player_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_xp_progress_pk" PRIMARY KEY("player_id","card_id"),
	CONSTRAINT "card_xp_progress_xp_check" CHECK ("card_xp_progress"."xp" >= 0),
	CONSTRAINT "card_xp_progress_level_check" CHECK ("card_xp_progress"."level" >= 1 and "card_xp_progress"."level" <= 10)
);
--> statement-breakpoint
CREATE TABLE "card_xp_runs" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"awards_created" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "card_xp_runs_status_check" CHECK ("card_xp_runs"."status" in ('done','no-eligible'))
);
--> statement-breakpoint
ALTER TABLE "card_xp_awards" ADD CONSTRAINT "card_xp_awards_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_xp_awards" ADD CONSTRAINT "card_xp_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_xp_progress" ADD CONSTRAINT "card_xp_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_xp_runs" ADD CONSTRAINT "card_xp_runs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_xp_awards_player_card_idx" ON "card_xp_awards" USING btree ("player_id","card_id");--> statement-breakpoint
CREATE INDEX "card_xp_progress_player_idx" ON "card_xp_progress" USING btree ("player_id");