CREATE TABLE "index_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"last_block" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_trait_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trait_type" text NOT NULL,
	"trait_value" text NOT NULL,
	"nft_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nft_trait_stats_type_value_unique" ON "nft_trait_stats" USING btree ("trait_type","trait_value");