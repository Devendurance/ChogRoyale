CREATE TABLE "gift_sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"from_level" smallint NOT NULL,
	"to_level" smallint NOT NULL,
	"cost" integer NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_sponsorships_no_self_check" CHECK ("gift_sponsorships"."sponsor_id" != "gift_sponsorships"."recipient_id"),
	CONSTRAINT "gift_sponsorships_levels_check" CHECK ("gift_sponsorships"."from_level" >= 1 and "gift_sponsorships"."to_level" = "gift_sponsorships"."from_level" + 1 and "gift_sponsorships"."to_level" <= 10),
	CONSTRAINT "gift_sponsorships_cost_check" CHECK ("gift_sponsorships"."cost" > 0)
);
--> statement-breakpoint
ALTER TABLE "gift_sponsorships" ADD CONSTRAINT "gift_sponsorships_sponsor_id_players_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_sponsorships" ADD CONSTRAINT "gift_sponsorships_recipient_id_players_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_sponsorships_idempotency_unique" ON "gift_sponsorships" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "gift_sponsorships_sponsor_idx" ON "gift_sponsorships" USING btree ("sponsor_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_sponsorships_recipient_idx" ON "gift_sponsorships" USING btree ("recipient_id","created_at");