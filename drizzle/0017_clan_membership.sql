CREATE TABLE "clan_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"inviter" uuid NOT NULL,
	"target" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "clan_invites_status_check" CHECK ("clan_invites"."status" in ('pending','accepted','declined','expired'))
);
--> statement-breakpoint
CREATE TABLE "clan_members" (
	"clan_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clan_members_pk" PRIMARY KEY("clan_id","player_id"),
	CONSTRAINT "clan_members_role_check" CHECK ("clan_members"."role" in ('owner','officer','member'))
);
--> statement-breakpoint
CREATE TABLE "clans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"tag_key" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clans_status_check" CHECK ("clans"."status" in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "active_clan_id" uuid;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_inviter_players_id_fk" FOREIGN KEY ("inviter") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_target_players_id_fk" FOREIGN KEY ("target") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clans" ADD CONSTRAINT "clans_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_invites_pending_unique" ON "clan_invites" USING btree ("clan_id","target") WHERE "clan_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "clan_invites_target_idx" ON "clan_invites" USING btree ("target");--> statement-breakpoint
CREATE INDEX "clan_members_player_idx" ON "clan_members" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clans_tag_key_unique" ON "clans" USING btree ("tag_key");--> statement-breakpoint
CREATE INDEX "clans_owner_idx" ON "clans" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_active_clan_id_clans_id_fk" FOREIGN KEY ("active_clan_id") REFERENCES "public"."clans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_active_clan_unique" ON "players" USING btree ("active_clan_id");