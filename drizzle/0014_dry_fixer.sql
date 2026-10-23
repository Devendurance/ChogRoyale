CREATE TABLE "gold_earn_ledger" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"result" text NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_earn_ledger_pk" PRIMARY KEY("match_id","player_id"),
	CONSTRAINT "gold_earn_ledger_amount_check" CHECK ("gold_earn_ledger"."amount" >= 0),
	CONSTRAINT "gold_earn_ledger_result_check" CHECK ("gold_earn_ledger"."result" in ('win','loss','draw'))
);
--> statement-breakpoint
CREATE TABLE "gold_spend_ledger" (
	"idempotency_key" uuid PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"from_level" smallint NOT NULL,
	"to_level" smallint NOT NULL,
	"cost" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_spend_ledger_levels_check" CHECK ("gold_spend_ledger"."from_level" >= 1 and "gold_spend_ledger"."to_level" = "gold_spend_ledger"."from_level" + 1 and "gold_spend_ledger"."to_level" <= 10),
	CONSTRAINT "gold_spend_ledger_cost_check" CHECK ("gold_spend_ledger"."cost" > 0)
);
--> statement-breakpoint
ALTER TABLE "card_xp_progress" ADD COLUMN "purchased_level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gold_earn_ledger" ADD CONSTRAINT "gold_earn_ledger_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_earn_ledger" ADD CONSTRAINT "gold_earn_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_spend_ledger" ADD CONSTRAINT "gold_spend_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gold_earn_ledger_player_idx" ON "gold_earn_ledger" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "gold_spend_ledger_player_idx" ON "gold_spend_ledger" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "card_xp_progress" ADD CONSTRAINT "card_xp_progress_purchased_check" CHECK ("card_xp_progress"."purchased_level" >= 1 and "card_xp_progress"."purchased_level" <= 10);