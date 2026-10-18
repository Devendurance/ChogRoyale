// Commander persistence: versioned, idempotent, re-derivable.
//
// One row per (NFT, ruleset version). Re-derivation with identical metadata
// content is a no-op returning the existing row. Re-derivation after a
// metadata change revises the row in place but preserves the previous
// content hash and bumps derivationCount, so history is never silently
// overwritten. Ownership is NOT stored here; nft_ownership_observations
// remains the single source of truth.

import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { commanderRulesets, commanders, type Commander } from "@/db/schema";
import { COMMANDER_RULESET_VERSION, rulesetSummary } from "@/lib/commanders";
import type { CommanderDefinition } from "@/lib/commanders";

export function currentRulesetVersion(): string {
  return COMMANDER_RULESET_VERSION;
}

export async function ensureCurrentRuleset() {
  const db = getDb();
  const rows = await db
    .insert(commanderRulesets)
    .values({ version: COMMANDER_RULESET_VERSION, definition: rulesetSummary() })
    .onConflictDoUpdate({
      target: [commanderRulesets.version],
      set: { definition: rulesetSummary() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Commander ruleset upsert failed");
  return row;
}

export async function upsertCommander(input: {
  nftId: string;
  tokenId: string | bigint;
  definition: CommanderDefinition;
}): Promise<{ commander: Commander; revised: boolean }> {
  const db = getDb();
  const def = input.definition;
  const existing = await db
    .select()
    .from(commanders)
    .where(
      and(
        eq(commanders.nftId, input.nftId),
        eq(commanders.rulesetVersion, def.rulesetVersion)
      )
    )
    .limit(1);
  const current = existing[0];
  if (current && current.contentHash === def.derivationHash) {
    return { commander: current, revised: false };
  }
  const values = {
    nftId: input.nftId,
    rulesetVersion: def.rulesetVersion,
    tokenId: input.tokenId.toString(),
    class: def.class,
    affinity: def.affinity,
    stats: def.stats,
    abilities: def.abilities,
    variant: def.variant,
    prestige: def.prestige,
    sourceTraits: def.signals,
    unmatchedTraits: def.unmatchedTraits,
    scores: def.scores,
    powerScore: Math.round(def.powerScore),
    contentHash: def.derivationHash,
    derivedAt: new Date(),
  };
  if (!current) {
    const rows = await db.insert(commanders).values(values).returning();
    const row = rows[0];
    if (!row) throw new Error("Commander insert failed");
    return { commander: row, revised: false };
  }
  const rows = await db
    .update(commanders)
    .set({
      ...values,
      previousContentHash: current.contentHash,
      derivationCount: current.derivationCount + 1,
      updatedAt: sql`now()`,
    })
    .where(eq(commanders.id, current.id))
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Commander revision failed");
  return { commander: row, revised: true };
}

export async function getCommanderByTokenId(
  tokenId: string | bigint,
  rulesetVersion: string = COMMANDER_RULESET_VERSION
): Promise<Commander | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(commanders)
    .where(
      and(
        eq(commanders.tokenId, tokenId.toString()),
        eq(commanders.rulesetVersion, rulesetVersion)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getCommandersByTokenIds(
  tokenIds: Array<string | bigint>,
  rulesetVersion: string = COMMANDER_RULESET_VERSION
): Promise<Commander[]> {
  if (tokenIds.length === 0) return [];
  const db = getDb();
  const ids = tokenIds.map((t) => t.toString());
  const rows = await db
    .select()
    .from(commanders)
    .where(and(eq(commanders.rulesetVersion, rulesetVersion), inArray(commanders.tokenId, ids)));
  return rows;
}

export interface CommanderEligibilityRow {
  tokenId: string;
  commander: Commander | null;
  metadataStatus: "resolved" | "failed" | null;
}

// Single-query batch view for eligibility screens: persisted commander (if
// derived under this ruleset) plus metadata availability per token.
// A null commander with non-resolved metadata means pending, never failure.
export async function getCommanderEligibility(
  tokenIds: Array<string | bigint>,
  rulesetVersion: string = COMMANDER_RULESET_VERSION
): Promise<CommanderEligibilityRow[]> {
  if (tokenIds.length === 0) return [];
  const db = getDb();
  const { nftTokens, nftMetadata } = await import("@/db/schema");
  const ids = tokenIds.map((t) => t.toString());
  const rows = await db
    .select({
      tokenId: nftTokens.tokenId,
      commander: commanders,
      metadataStatus: nftMetadata.status,
    })
    .from(nftTokens)
    .leftJoin(
      commanders,
      and(eq(commanders.nftId, nftTokens.id), eq(commanders.rulesetVersion, rulesetVersion))
    )
    .leftJoin(nftMetadata, eq(nftMetadata.nftId, nftTokens.id))
    .where(inArray(nftTokens.tokenId, ids));
  return rows.map((r) => ({
    tokenId: r.tokenId,
    commander: r.commander,
    metadataStatus: (r.metadataStatus as CommanderEligibilityRow["metadataStatus"]) ?? null,
  }));
}

export async function countCommanders(
  rulesetVersion: string = COMMANDER_RULESET_VERSION
): Promise<{ total: number; byClass: Record<string, number>; revisions: number }> {
  const db = getDb();
  const rows = (await db.execute(
    sql`select class, count(*)::int as n, count(*) filter (where derivation_count > 1)::int as r from commanders where ruleset_version = ${rulesetVersion} group by class`
  )) as unknown as { rows: Array<{ class: string; n: number; r: number }> };
  const byClass: Record<string, number> = {};
  let total = 0;
  let revisions = 0;
  for (const r of rows.rows) {
    byClass[r.class] = r.n;
    total += r.n;
    revisions += r.r;
  }
  return { total, byClass, revisions };
}
