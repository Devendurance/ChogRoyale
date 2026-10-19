CREATE TABLE "player_loadouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"slot" smallint DEFAULT 0 NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"cards" text[] NOT NULL,
	"commander_kind" text NOT NULL,
	"commander_class" text,
	"nft_chain_id" integer,
	"nft_contract" text,
	"nft_token_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_loadouts_slot_check" CHECK ("player_loadouts"."slot" = 0),
	CONSTRAINT "player_loadouts_schema_version_check" CHECK ("player_loadouts"."schema_version" = 1),
	CONSTRAINT "player_loadouts_cards_count_check" CHECK (cardinality("player_loadouts"."cards") = 7),
	CONSTRAINT "player_loadouts_commander_kind_check" CHECK ("player_loadouts"."commander_kind" in ('free','nft')),
	CONSTRAINT "player_loadouts_commander_shape_check" CHECK ((("player_loadouts"."commander_kind" = 'free'
          and "player_loadouts"."commander_class" in ('bulwark','reaver','deadeye','scout','warden')
          and "player_loadouts"."nft_chain_id" is null and "player_loadouts"."nft_contract" is null and "player_loadouts"."nft_token_id" is null)
        or ("player_loadouts"."commander_kind" = 'nft'
          and "player_loadouts"."commander_class" is null
          and "player_loadouts"."nft_chain_id" = 143
          and "player_loadouts"."nft_contract" = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763'
          and "player_loadouts"."nft_token_id" ~ '^[1-9][0-9]{0,77}$')))
);
--> statement-breakpoint
ALTER TABLE "player_loadouts" ADD CONSTRAINT "player_loadouts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_loadouts_player_slot_unique" ON "player_loadouts" USING btree ("player_id","slot");