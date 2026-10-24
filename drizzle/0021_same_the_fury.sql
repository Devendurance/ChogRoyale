CREATE TABLE "commander_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer DEFAULT 143 NOT NULL,
	"contract" text NOT NULL,
	"token_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"terminated_at" timestamp with time zone,
	"termination_reason" text,
	"auth_proof" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commander_loans_chain_check" CHECK ("commander_loans"."chain_id" = 143),
	CONSTRAINT "commander_loans_contract_check" CHECK ("commander_loans"."contract" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "commander_loans_token_id_check" CHECK ("commander_loans"."token_id" ~ '^[1-9][0-9]{0,77}$'),
	CONSTRAINT "commander_loans_no_self_check" CHECK ("commander_loans"."owner_id" != "commander_loans"."borrower_id"),
	CONSTRAINT "commander_loans_status_check" CHECK ("commander_loans"."status" in ('active','expired','revoked','returned')),
	CONSTRAINT "commander_loans_window_check" CHECK ("commander_loans"."ends_at" > "commander_loans"."starts_at"),
	CONSTRAINT "commander_loans_termination_check" CHECK (("commander_loans"."status" = 'active' and "commander_loans"."terminated_at" is null) or ("commander_loans"."status" != 'active' and "commander_loans"."terminated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "commander_loans" ADD CONSTRAINT "commander_loans_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commander_loans" ADD CONSTRAINT "commander_loans_borrower_id_players_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commander_loans_idempotency_unique" ON "commander_loans" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commander_loans_active_token_unique" ON "commander_loans" USING btree ("chain_id","contract","token_id") WHERE "commander_loans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "commander_loans_owner_idx" ON "commander_loans" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "commander_loans_borrower_idx" ON "commander_loans" USING btree ("borrower_id");