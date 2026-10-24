DROP INDEX "players_active_clan_unique";--> statement-breakpoint
CREATE INDEX "players_active_clan_idx" ON "players" USING btree ("active_clan_id");