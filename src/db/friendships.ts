import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { friendships, players, type Friendship } from "@/db/schema";
import { AppError } from "@/lib/errors";

export type FriendshipStatus = "pending" | "accepted";

export interface FriendPlayer {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
}

export interface FriendshipView {
  friendshipId: string;
  status: FriendshipStatus;
  /** True when the row is a pending request sent by the other party. */
  incoming: boolean;
  player: FriendPlayer;
  since: string;
}

export interface FriendLists {
  friends: FriendshipView[];
  incoming: FriendshipView[];
  outgoing: FriendshipView[];
}

export type SearchStatus = "none" | "outgoing" | "incoming" | "friends";

export interface SearchResult {
  player: FriendPlayer;
  status: SearchStatus;
  friendshipId: string | null;
}

/** Canonical pair ordering. The DB order check rejects anything else, so
 * every lookup and write goes through this helper and a pair can never hold
 * two rows in either direction. */
export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function toPlayer(row: { id: string; username: string | null; displayName: string | null; avatarId: string | null }): FriendPlayer {
  return { id: row.id, username: row.username, displayName: row.displayName, avatarId: row.avatarId };
}

async function profilesById(ids: string[]): Promise<Map<string, FriendPlayer>> {
  const map = new Map<string, FriendPlayer>();
  if (ids.length === 0) return map;
  const rows = await getDb()
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(inArray(players.id, [...new Set(ids)]));
  for (const row of rows) map.set(row.id, toPlayer(row));
  return map;
}

function viewFor(row: Friendship, me: string, other: FriendPlayer): FriendshipView {
  const status = row.status as FriendshipStatus;
  return {
    friendshipId: row.id,
    status,
    incoming: status === "pending" && row.requestedBy !== me,
    player: other,
    since: row.createdAt.toISOString(),
  };
}

/** All friendship rows touching a player, newest first. */
export async function listFriendships(playerId: string): Promise<FriendLists> {
  const db = getDb();
  const rows = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.userA, playerId), eq(friendships.userB, playerId)))
    .orderBy(asc(friendships.createdAt));
  const others = rows.map((r) => (r.userA === playerId ? r.userB : r.userA));
  const profiles = await profilesById(others);
  const lists: FriendLists = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const otherId = row.userA === playerId ? row.userB : row.userA;
    const other = profiles.get(otherId);
    if (!other) continue;
    const view = viewFor(row, playerId, other);
    if (view.status === "accepted") lists.friends.push(view);
    else if (view.incoming) lists.incoming.push(view);
    else lists.outgoing.push(view);
  }
  return lists;
}

/** Username-prefix player search, excluding the caller, with the caller's
 * relationship to each result attached. Client-side filtering only; the
 * server decides every status. */
export async function searchPlayers(playerId: string, query: string, max = 20): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) throw new AppError("BAD_REQUEST", "Search needs a username");
  const like = `${q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const db = getDb();
  const rows = await db
    .select({ id: players.id, username: players.username, displayName: players.displayName, avatarId: players.avatarId })
    .from(players)
    .where(sql`${players.username} ilike ${like} escape '\\'`)
    .orderBy(asc(players.username))
    .limit(Math.min(Math.max(max, 1), 20));
  const mine = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.userA, playerId), eq(friendships.userB, playerId)));
  const byOther = new Map<string, Friendship>();
  for (const row of mine) byOther.set(row.userA === playerId ? row.userB : row.userA, row);
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (row.id === playerId) continue;
    const rel = byOther.get(row.id);
    results.push({
      player: toPlayer(row),
      status: !rel ? "none" : rel.status === "accepted" ? "friends" : rel.requestedBy === playerId ? "outgoing" : "incoming",
      friendshipId: rel ? rel.id : null,
    });
  }
  return results;
}

async function findPair(a: string, b: string): Promise<Friendship | null> {
  const [userA, userB] = pairKey(a, b);
  const rows = await getDb()
    .select()
    .from(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .limit(1);
  return rows[0] ?? null;
}

async function viewOf(row: Friendship, me: string): Promise<FriendshipView> {
  const otherId = row.userA === me ? row.userB : row.userA;
  const profiles = await profilesById([otherId]);
  const other = profiles.get(otherId);
  if (!other) throw new AppError("NOT_FOUND", "Player not found");
  return viewFor(row, me, other);
}

/**
 * Sends a friend request. Idempotent: a repeat send returns the current row,
 * an existing incoming request from the target is accepted instead of
 * duplicated, and an established friendship is returned unchanged.
 */
export async function sendRequest(playerId: string, targetId: string): Promise<FriendshipView> {
  if (playerId === targetId) throw new AppError("BAD_REQUEST", "You cannot friend yourself");
  const db = getDb();
  const target = await db.select({ id: players.id }).from(players).where(eq(players.id, targetId)).limit(1);
  if (!target[0]) throw new AppError("NOT_FOUND", "Player not found");
  const existing = await findPair(playerId, targetId);
  if (existing) {
    if (existing.status === "accepted") return viewOf(existing, playerId);
    if (existing.requestedBy === playerId) return viewOf(existing, playerId);
    const accepted = await db
      .update(friendships)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(friendships.id, existing.id))
      .returning();
    return viewOf(accepted[0], playerId);
  }
  const [userA, userB] = pairKey(playerId, targetId);
  const inserted = await db
    .insert(friendships)
    .values({ userA, userB, status: "pending", requestedBy: playerId })
    .returning();
  return viewOf(inserted[0], playerId);
}

async function rowFor(playerId: string, friendshipId: string): Promise<Friendship> {
  const rows = await getDb().select().from(friendships).where(eq(friendships.id, friendshipId)).limit(1);
  const row = rows[0];
  if (!row || (row.userA !== playerId && row.userB !== playerId)) {
    throw new AppError("NOT_FOUND", "Friendship not found");
  }
  return row;
}

/** Accepts a pending incoming request. Repeat accepts return the row. */
export async function acceptRequest(playerId: string, friendshipId: string): Promise<FriendshipView> {
  const row = await rowFor(playerId, friendshipId);
  if (row.status === "accepted") return viewOf(row, playerId);
  if (row.requestedBy === playerId) throw new AppError("BAD_REQUEST", "You cannot accept your own request");
  const updated = await getDb()
    .update(friendships)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(friendships.id, row.id))
    .returning();
  return viewOf(updated[0], playerId);
}

/** Declines a pending incoming request. The requester cancels via remove. */
export async function declineRequest(playerId: string, friendshipId: string): Promise<{ declined: true }> {
  const row = await rowFor(playerId, friendshipId);
  if (row.status !== "pending" || row.requestedBy === playerId) {
    throw new AppError("BAD_REQUEST", "There is no incoming request to decline");
  }
  await getDb().delete(friendships).where(eq(friendships.id, row.id));
  return { declined: true };
}

/** Cancels an outgoing pending request or removes an established friend. */
export async function removeFriendship(playerId: string, friendshipId: string): Promise<{ removed: true }> {
  const row = await rowFor(playerId, friendshipId);
  await getDb().delete(friendships).where(eq(friendships.id, row.id));
  return { removed: true };
}
