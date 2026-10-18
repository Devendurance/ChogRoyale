// Arena Patron persistence: versioned ruleset + immutable match assignments.
//
// One row per matchKey, never updated. A repeat call with the same matchKey
// returns the existing row (idempotent); a different token under the same
// matchKey is rejected by the unique constraint, so history cannot be
// rewritten or cross-contaminated. Ownership is never stored here;
// nft_ownership_observations remains the single source of truth.

import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { arenaPatronRulesets, patronAssignments, type PatronAssignment } from "@/db/schema";
import { CHOG_GENESIS_ADDRESS } from "@/lib/chain";
import { COMMANDER_RULESET_VERSION } from "@/lib/commanders";
import { getNftByTokenId } from "@/db/nfts";
import {
  PATRON_RULESET_VERSION,
  derivePatronConfig,
  snapshotTraits,
  patronRulesetSummary,
} from "@/lib/patrons";
import { AppError } from "@/lib/errors";

export function currentPatronRulesetVersion(): string {
  return PATRON_RULESET_VERSION;
}

export async function ensurePatronRuleset() {
  const db = getDb();
  const rows = await db
    .insert(arenaPatronRulesets)
    .values({ version: PATRON_RULESET_VERSION, definition: patronRulesetSummary() })
    .onConflictDoUpdate({
      target: [arenaPatronRulesets.version],
      set: { definition: patronRulesetSummary() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Patron ruleset upsert failed");
  return row;
}

export interface PatronAssignmentInput {
  matchKey: string;
  tokenId: string | bigint;
  serverSeed: string;
}

export async function createPatronAssignment(
  input: PatronAssignmentInput
): Promise<{ assignment: PatronAssignment; created: boolean }> {
  if (!input.matchKey || input.matchKey.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Patron assignment requires a match key");
  }
  if (!input.serverSeed || input.serverSeed.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Patron assignment requires a server-generated seed");
  }
  const tokenId = input.tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tokenId)) {
    throw new AppError("BAD_REQUEST", `Invalid patron token ID: ${tokenId}`);
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(patronAssignments)
    .where(eq(patronAssignments.matchKey, input.matchKey))
    .limit(1);
  if (existing[0]) return { assignment: existing[0], created: false };

  const nft = await getNftByTokenId(tokenId);
  if (!nft || nft.token.contractAddress.toLowerCase() !== CHOG_GENESIS_ADDRESS.toLowerCase()) {
    throw new AppError("NOT_FOUND", `Genesis NFT ${tokenId} not found`);
  }
  if (!nft.metadata || nft.metadata.status !== "resolved") {
    throw new AppError("UNPROCESSABLE", `Genesis NFT ${tokenId} has no resolved metadata`);
  }
  const attributes = (nft.metadata.attributesOriginal ?? null) as Array<{
    trait_type: string;
    value: string | number;
  }> | null;
  const config = derivePatronConfig({
    tokenId,
    attributes,
    metadataContentHash: nft.metadata.contentHash,
    name: nft.metadata.name,
  });
  const snapshot = snapshotTraits(tokenId, attributes, nft.metadata.name);
  await ensurePatronRuleset();
  const rows = await db
    .insert(patronAssignments)
    .values({
      matchKey: input.matchKey,
      nftId: nft.token.id,
      tokenId,
      rulesetVersion: PATRON_RULESET_VERSION,
      commanderRulesetVersion: COMMANDER_RULESET_VERSION,
      serverSeed: input.serverSeed,
      patronConfig: config,
      configHash: config.configHash,
      traitSnapshot: snapshot,
      metadataContentHash: nft.metadata.contentHash,
    })
    .onConflictDoNothing({ target: [patronAssignments.matchKey] })
    .returning();
  const row = rows[0];
  if (row) return { assignment: row, created: true };
  const raced = await db
    .select()
    .from(patronAssignments)
    .where(eq(patronAssignments.matchKey, input.matchKey))
    .limit(1);
  const winner = raced[0];
  if (!winner) throw new Error("Patron assignment insert failed");
  return { assignment: winner, created: false };
}

export async function getPatronAssignment(matchKey: string): Promise<PatronAssignment | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(patronAssignments)
    .where(eq(patronAssignments.matchKey, matchKey))
    .limit(1);
  return rows[0] ?? null;
}

export async function countPatronAssignments(): Promise<{ total: number; byRuleset: Record<string, number> }> {
  const db = getDb();
  const rows = (await db.execute(
    sql`select ruleset_version, count(*)::int as n from patron_assignments group by ruleset_version`
  )) as unknown as { rows: Array<{ ruleset_version: string; n: number }> };
  const byRuleset: Record<string, number> = {};
  let total = 0;
  for (const r of rows.rows) {
    byRuleset[r.ruleset_version] = r.n;
    total += r.n;
  }
  return { total, byRuleset };
}

export async function getPatronAssignmentsByToken(tokenId: string | bigint): Promise<PatronAssignment[]> {
  const db = getDb();
  const tid = tokenId.toString();
  if (!/^[0-9]{1,78}$/.test(tid)) {
    throw new AppError("BAD_REQUEST", `Invalid patron token ID: ${tid}`);
  }
  return db.select().from(patronAssignments).where(eq(patronAssignments.tokenId, tid));
}
