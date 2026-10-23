CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_canonical_order_check" CHECK ("friendships"."user_a" < "friendships"."user_b"),
	CONSTRAINT "friendships_status_check" CHECK ("friendships"."status" in ('pending','accepted')),
	CONSTRAINT "friendships_requester_check" CHECK ("friendships"."requested_by" = "friendships"."user_a" or "friendships"."requested_by" = "friendships"."user_b")
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_players_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_players_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_unique" ON "friendships" USING btree ("user_a","user_b");