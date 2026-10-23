CREATE TABLE "dm_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_conversations_canonical_order_check" CHECK ("dm_conversations"."user_a" < "dm_conversations"."user_b")
);
--> statement-breakpoint
CREATE TABLE "dm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "dm_messages_content_length_check" CHECK (char_length("dm_messages"."content") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_user_a_players_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_user_b_players_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_sender_players_id_fk" FOREIGN KEY ("sender") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_conversations_pair_unique" ON "dm_conversations" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE UNIQUE INDEX "dm_messages_sender_key_unique" ON "dm_messages" USING btree ("sender","idempotency_key");--> statement-breakpoint
CREATE INDEX "dm_messages_conversation_created_idx" ON "dm_messages" USING btree ("conversation_id","created_at","id");