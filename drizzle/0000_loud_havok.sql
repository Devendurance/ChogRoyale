CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "player_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_roles_role_check" CHECK ("player_roles"."role" in ('PLAYER','MODERATOR','ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "player_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"address" text NOT NULL,
	"address_normalized" text NOT NULL,
	"chain_id" integer DEFAULT 143 NOT NULL,
	"wallet_type" text DEFAULT 'external' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"link_source" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wallets_type_check" CHECK ("player_wallets"."wallet_type" in ('embedded','external')),
	CONSTRAINT "player_wallets_address_format_check" CHECK ("player_wallets"."address_normalized" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_did" text NOT NULL,
	"username" varchar(32),
	"username_key" varchar(32),
	"display_name" varchar(64),
	"avatar_id" varchar(64),
	"account_status" text DEFAULT 'active' NOT NULL,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_account_status_check" CHECK ("players"."account_status" in ('active','suspended','banned')),
	CONSTRAINT "players_onboarding_status_check" CHECK ("players"."onboarding_status" in ('pending','complete')),
	CONSTRAINT "players_username_key_format_check" CHECK ("players"."username_key" is null or "players"."username_key" ~ '^[a-z0-9_]{3,20}$')
);
--> statement-breakpoint
ALTER TABLE "player_roles" ADD CONSTRAINT "player_roles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallets" ADD CONSTRAINT "player_wallets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_roles_player_role_unique" ON "player_roles" USING btree ("player_id","role");--> statement-breakpoint
CREATE INDEX "player_roles_player_id_idx" ON "player_roles" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_wallets_address_normalized_unique" ON "player_wallets" USING btree ("address_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "player_wallets_one_primary_per_player" ON "player_wallets" USING btree ("player_id") WHERE "player_wallets"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "player_wallets_player_id_idx" ON "player_wallets" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_privy_did_unique" ON "players" USING btree ("privy_did");--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_key_unique" ON "players" USING btree ("username_key");--> statement-breakpoint
CREATE INDEX "players_account_status_idx" ON "players" USING btree ("account_status");