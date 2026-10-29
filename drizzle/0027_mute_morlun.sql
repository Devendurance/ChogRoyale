CREATE TABLE "account_xp_daily_counts" (
	"player_id" uuid NOT NULL,
	"day" date NOT NULL,
	"n" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "account_xp_daily_counts_pk" PRIMARY KEY("player_id","day"),
	CONSTRAINT "account_xp_daily_counts_n_check" CHECK ("account_xp_daily_counts"."n" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_xp_heads" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_xp_heads_total_check" CHECK ("account_xp_heads"."total_xp" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_xp_awards" ADD COLUMN "xp_before" integer;--> statement-breakpoint
ALTER TABLE "account_xp_awards" ADD COLUMN "xp_after" integer;--> statement-breakpoint
ALTER TABLE "account_xp_daily_counts" ADD CONSTRAINT "account_xp_daily_counts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_xp_heads" ADD CONSTRAINT "account_xp_heads_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "account_xp_heads"("player_id","total_xp") SELECT "player_id", COALESCE(SUM("amount"),0)::int FROM "account_xp_awards" GROUP BY "player_id" ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "account_xp_daily_counts"("player_id","day","n") SELECT "player_id", ("created_at" AT TIME ZONE 'utc')::date, COUNT(*)::int FROM "account_xp_awards" WHERE "source" = 'matchmaking' GROUP BY 1,2 ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "account_xp_heads"("player_id","total_xp") SELECT "player_id", COALESCE(SUM("amount"),0)::int FROM "account_xp_awards" GROUP BY "player_id" ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "account_xp_daily_counts"("player_id","day","n") SELECT "player_id", ("created_at" AT TIME ZONE 'utc')::date, COUNT(*)::int FROM "account_xp_awards" WHERE "source" = 'matchmaking' GROUP BY 1,2 ON CONFLICT DO NOTHING;
