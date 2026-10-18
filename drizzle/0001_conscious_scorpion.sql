CREATE TABLE "nft_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nft_id" uuid NOT NULL,
	"document_original" jsonb NOT NULL,
	"name" text,
	"description" text,
	"image_original" text,
	"attributes_original" jsonb,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'resolved' NOT NULL,
	"error" text,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nft_metadata_status_check" CHECK ("nft_metadata"."status" in ('resolved','failed'))
);
--> statement-breakpoint
CREATE TABLE "nft_ownership_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nft_id" uuid NOT NULL,
	"owner_address" text NOT NULL,
	"owner_normalized" text NOT NULL,
	"block_number" text,
	"block_hash" text,
	"source" text DEFAULT 'live' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nft_ownership_source_check" CHECK ("nft_ownership_observations"."source" in ('live')),
	CONSTRAINT "nft_ownership_address_check" CHECK ("nft_ownership_observations"."owner_normalized" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "nft_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer DEFAULT 143 NOT NULL,
	"contract_address" text NOT NULL,
	"token_id" text NOT NULL,
	"token_uri_original" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nft_tokens_chain_check" CHECK ("nft_tokens"."chain_id" = 143),
	CONSTRAINT "nft_tokens_contract_check" CHECK ("nft_tokens"."contract_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "nft_tokens_token_id_check" CHECK ("nft_tokens"."token_id" ~ '^[0-9]{1,78}$')
);
--> statement-breakpoint
ALTER TABLE "nft_metadata" ADD CONSTRAINT "nft_metadata_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_ownership_observations" ADD CONSTRAINT "nft_ownership_observations_nft_id_nft_tokens_id_fk" FOREIGN KEY ("nft_id") REFERENCES "public"."nft_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nft_metadata_nft_unique" ON "nft_metadata" USING btree ("nft_id");--> statement-breakpoint
CREATE INDEX "nft_metadata_hash_idx" ON "nft_metadata" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "nft_ownership_nft_observed_idx" ON "nft_ownership_observations" USING btree ("nft_id","observed_at");--> statement-breakpoint
CREATE INDEX "nft_ownership_owner_idx" ON "nft_ownership_observations" USING btree ("owner_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "nft_tokens_chain_contract_token_unique" ON "nft_tokens" USING btree ("chain_id","contract_address","token_id");--> statement-breakpoint
CREATE INDEX "nft_tokens_contract_token_idx" ON "nft_tokens" USING btree ("contract_address","token_id");