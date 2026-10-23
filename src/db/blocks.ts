import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { friendships, playerBlocks, players } from "@/db/schema";
import { AppError } from "@/lib/errors";

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface BlockedPlayer {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
}

export interface BlockedView {
  player: BlockedPlayer;
  since: string;
}

export type SocialVerdict = { allowed: true } | { allowed: false; reason: "blocked" };

function toBlocked(row: { id: string; username: string | null; displayName: string | null; avatarId: string | null }): BlockedPlayer {
  return { id: row.id, username: row.username, displayName: row.displayName, avatarId: row.avatarId };
}

/** Rows in either direction between two players. Used by the shared guard. */
export async function blockBetween(a: string, b: string): Promise<{ aBlocksB: boolean; bBlocksA: boolean }> {
  if (a === b) return { aBlocksB: false, bBlocksA: false };
  const rows = await getDb()
    .select({ blocker: playerBlocks.blocker, blocked: playerBlocks.blocked })
    .from(playerBlocks)
    .where(
      or(
        and(eq(playerBlocks.blocker, a), eq(playerBlocks.blocked, b)),
        and(eq(playerBlocks.blocker, b), eq(playerBlocks.blocked, a))
      )
    )
    .limit(2);
  return {
    aBlocksB: rows.some((r) => r.blocker === a),
    bBlocksA: rows.some((r) => r.blocker === b),
  };
}

/**
 * Shared social permission guard. Checks blocks in BOTH directions so future
 * systems (messaging, clan invites, gifting, lending) can reuse one check.
 * Never reveals who blocked whom: callers must map denial to a neutral
 * unavailable response.
 */
export async function canSociallyInteract(a: string, b: string): Promise<SocialVerdict> {
  if (a === b) return { allowed: false, reason: "blocked" };
  const { aBlocksB, bBlocksA } = await blockBetween(a, b);
  if (aBlocksB || bBlocksA) return { allowed: false, reason: "blocked" };
  return { allowed: true };
}

/** All player ids with a block edge touching playerId, either direction. */
export async function blockedIdsFor(playerId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ blocker: playerBlocks.blocker, blocked: playerBlocks.blocked })
    .from(playerBlocks)
    .where(or(eq(playerBlocks.blocker, playerId), eq(playerBlocks.blocked, playerId)))
    .limit(500);
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.blocker === playerId ? r.blocked : r.blocker);
  return ids;
}

/** The caller's own blocked list, newest first (insertion order by row id). */
export async function listBlocks(playerId: string): Promise<BlockedView[]> {
  const db = getDb();
  const rows = await db
    .select({ blocked: playerBlocks.blocked, since: playerBlocks.createdAt })
    .from(playerBlocks)
    .where(eq(playerBlocks.blocker, playerId));
  if (rows.length === 0) return [];
  const profiles = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(inArray(players.id, rows.map((r) => r.blocked)));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const views: BlockedView[] = [];
  for (const r of rows) {
    const p = byId.get(r.blocked);
    if (!p) continue;
    views.push({ player: toBlocked(p), since: r.since.toISOString() });
  }
  return views;
}

/**
 * Blocks targetId for playerId. Idempotent: a repeat block returns the
 * current row. Ends any friendship or pending request between the pair
 * first, so no actionable relationship survives. Unblock never restores.
 *
 * neon-http has no interactive transactions, so the equivalent guarantee is
 * an ordered delete-then-insert plus the unique pair constraint: a
 * concurrent accept/send either lands before the delete (then removed) or
 * after the insert (then refused by the guard on its block re-check).
 */
export async function blockPlayer(playerId: string, targetId: string): Promise<BlockedView> {
  if (playerId === targetId) throw new AppError("BAD_REQUEST", "You cannot block yourself");
  const db = getDb();
  const target = await db.select({ id: players.id }).from(players).where(eq(players.id, targetId)).limit(1);
  if (!target[0]) throw new AppError("NOT_FOUND", "Player not found");
  const [userA, userB] = pairKey(playerId, targetId);
  await db.delete(friendships).where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)));
  await db.insert(playerBlocks).values({ blocker: playerId, blocked: targetId }).onConflictDoNothing();
  const rows = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId, since: playerBlocks.createdAt })
    .from(playerBlocks)
    .innerJoin(players, eq(players.id, playerBlocks.blocked))
    .where(and(eq(playerBlocks.blocker, playerId), eq(playerBlocks.blocked, targetId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Player not found");
  return { player: toBlocked(row), since: row.since.toISOString() };
}

/** Unblocks targetId. Idempotent: unblocking twice still succeeds. */
export async function unblockPlayer(playerId: string, targetId: string): Promise<{ unblocked: true }> {
  if (playerId === targetId) throw new AppError("BAD_REQUEST", "You cannot block yourself");
  await getDb()
    .delete(playerBlocks)
    .where(and(eq(playerBlocks.blocker, playerId), eq(playerBlocks.blocked, targetId)));
  return { unblocked: true };
}
