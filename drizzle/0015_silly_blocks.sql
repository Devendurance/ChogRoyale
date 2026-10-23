CREATE TABLE "player_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker" uuid NOT NULL,
	"blocked" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_blocks_no_self_check" CHECK ("player_blocks"."blocker" != "player_blocks"."blocked")
);
--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocker_players_id_fk" FOREIGN KEY ("blocker") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_blocks" ADD CONSTRAINT "player_blocks_blocked_players_id_fk" FOREIGN KEY ("blocked") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_blocks_pair_unique" ON "player_blocks" USING btree ("blocker","blocked");--> statement-breakpoint
CREATE INDEX "player_blocks_blocked_idx" ON "player_blocks" USING btree ("blocked");