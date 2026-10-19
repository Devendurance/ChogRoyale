import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { playerLoadouts, type PlayerLoadout } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { CommanderChoice } from "@/lib/battle-protocol";

export interface LoadoutInput {
  cards: string[];
  commander: CommanderChoice;
}

function pgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ("code" in cur && typeof (cur as { code?: unknown }).code === "string") {
      return (cur as { code: string }).code;
    }
    cur = "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

const isCheckViolation = (err: unknown) => pgCode(err) === "23514";

function commanderColumns(commander: CommanderChoice) {
  return commander.kind === "free"
    ? { commanderKind: "free" as const, commanderClass: commander.class, nftChainId: null, nftContract: null, nftTokenId: null }
    : {
        commanderKind: "nft" as const,
        commanderClass: null,
        nftChainId: commander.chainId,
        nftContract: commander.contract.toLowerCase(),
        nftTokenId: commander.tokenId,
      };
}

export function commanderFromRow(row: PlayerLoadout): CommanderChoice {
  return row.commanderKind === "free"
    ? ({ kind: "free", class: row.commanderClass } as CommanderChoice)
    : { kind: "nft", chainId: row.nftChainId!, contract: row.nftContract!, tokenId: row.nftTokenId! };
}

export async function getLoadout(playerId: string): Promise<PlayerLoadout | null> {
  const db = getDb();
  const rows = await db.select().from(playerLoadouts).where(and(eq(playerLoadouts.playerId, playerId), eq(playerLoadouts.slot, 0))).limit(1);
  return rows[0] ?? null;
}

/**
 * Saves the slot-0 loadout as a single statement so a failure can't partially
 * replace a deck. expectedRevision null means "first save" (insert, fail if a
 * row exists); a number means "overwrite only if the server is still at that
 * revision". Conflicts throw CONFLICT with the current row in details.
 */
export async function saveLoadout(playerId: string, input: LoadoutInput, expectedRevision: number | null): Promise<PlayerLoadout> {
  const db = getDb();
  const cols = commanderColumns(input.commander);
  try {
    if (expectedRevision === null) {
      const rows = await db
        .insert(playerLoadouts)
        .values({ playerId, slot: 0, schemaVersion: 1, cards: input.cards, ...cols })
        .onConflictDoNothing({ target: [playerLoadouts.playerId, playerLoadouts.slot] })
        .returning();
      if (rows.length > 0) return rows[0]!;
    } else {
      const rows = await db
        .update(playerLoadouts)
        .set({ cards: input.cards, ...cols, revision: sql`${playerLoadouts.revision} + 1`, updatedAt: sql`now()` })
        .where(and(eq(playerLoadouts.playerId, playerId), eq(playerLoadouts.slot, 0), eq(playerLoadouts.revision, expectedRevision)))
        .returning();
      if (rows.length > 0) return rows[0]!;
    }
  } catch (err) {
    if (isCheckViolation(err)) throw new AppError("BAD_REQUEST", "Loadout violates storage constraints");
    throw err;
  }
  const current = await getLoadout(playerId);
  throw new AppError("CONFLICT", current ? "A newer deck was saved elsewhere" : "No saved deck for this revision", {
    retryable: true,
    details: { current },
  });
}
