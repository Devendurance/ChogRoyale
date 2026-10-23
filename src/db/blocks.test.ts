import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, listFriendships, searchPlayers, sendRequest } from "@/db/friendships";
import { blockBetween, blockPlayer, blockedIdsFor, canSociallyInteract, listBlocks, unblockPlayer } from "@/db/blocks";
import { friendships, playerBlocks, players, type Player } from "@/db/schema";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
});

const createdPlayerIds: string[] = [];
const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `blk_${name}_${randomUUID().slice(0, 8)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  await getDb().update(players).set({ username: tag.slice(0, 20), usernameKey: tag.slice(0, 20) }).where(eq(players.id, p.id));
  createdPlayerIds.push(p.id);
  return { ...p, username: tag.slice(0, 20), usernameKey: tag.slice(0, 20) };
};

afterAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("player blocks", () => {
  it("blocks a player and lists it without private identity", async () => {
    const a = await mkPlayer("list_a");
    const b = await mkPlayer("list_b");
    const view = await blockPlayer(a.id, b.id);
    expect(view.player.id).toBe(b.id);
    expect(new Date(view.since).toString()).not.toBe("Invalid Date");
    expect(Object.keys(view.player).sort()).toEqual(["avatarId", "displayName", "id", "username"]);
    const listed = await listBlocks(a.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].player.id).toBe(b.id);
    expect(await listBlocks(b.id)).toEqual([]);
  });

  it("rejects self-block and unknown players", async () => {
    const a = await mkPlayer("self");
    await expect(blockPlayer(a.id, a.id)).rejects.toThrow();
    await expect(blockPlayer(a.id, randomUUID())).rejects.toThrow();
    await expect(unblockPlayer(a.id, a.id)).rejects.toThrow();
  });

  it("treats duplicate block as idempotent no-op", async () => {
    const a = await mkPlayer("dup_a");
    const b = await mkPlayer("dup_b");
    const first = await blockPlayer(a.id, b.id);
    const second = await blockPlayer(a.id, b.id);
    expect(second.player.id).toBe(first.player.id);
    expect(await listBlocks(a.id)).toHaveLength(1);
  });

  it("stores reverse blocks independently", async () => {
    const a = await mkPlayer("rev_a");
    const b = await mkPlayer("rev_b");
    await blockPlayer(a.id, b.id);
    await blockPlayer(b.id, a.id);
    expect(await listBlocks(a.id)).toHaveLength(1);
    expect(await listBlocks(b.id)).toHaveLength(1);
    expect(await blockBetween(a.id, b.id)).toEqual({ aBlocksB: true, bBlocksA: true });
  });

  it("unblocks and stays unblocked on repeat", async () => {
    const a = await mkPlayer("un_a");
    const b = await mkPlayer("un_b");
    await blockPlayer(a.id, b.id);
    expect(await unblockPlayer(a.id, b.id)).toEqual({ unblocked: true });
    expect(await listBlocks(a.id)).toEqual([]);
    expect(await unblockPlayer(a.id, b.id)).toEqual({ unblocked: true });
  });

  it("unblock does not restore friendship", async () => {
    const a = await mkPlayer("nor_a");
    const b = await mkPlayer("nor_b");
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    await blockPlayer(a.id, b.id);
    await unblockPlayer(a.id, b.id);
    expect((await listFriendships(a.id)).friends).toHaveLength(0);
    expect((await listFriendships(b.id)).friends).toHaveLength(0);
  });

  it("cancels pending requests in both directions", async () => {
    const a = await mkPlayer("can_a");
    const b = await mkPlayer("can_b");
    await sendRequest(a.id, b.id);
    await blockPlayer(a.id, b.id);
    expect(await listFriendships(a.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(await listFriendships(b.id)).toEqual({ friends: [], incoming: [], outgoing: [] });

    const c = await mkPlayer("can_c");
    const d = await mkPlayer("can_d");
    await sendRequest(c.id, d.id);
    await blockPlayer(d.id, c.id);
    expect(await listFriendships(c.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(await listFriendships(d.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
  });

  it("removes an existing friendship", async () => {
    const a = await mkPlayer("rm_a");
    const b = await mkPlayer("rm_b");
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    await blockPlayer(b.id, a.id);
    expect((await listFriendships(a.id)).friends).toHaveLength(0);
    expect((await listFriendships(b.id)).friends).toHaveLength(0);
  });

  it("refuses new requests in both directions while blocked", async () => {
    const a = await mkPlayer("nb_a");
    const b = await mkPlayer("nb_b");
    await blockPlayer(a.id, b.id);
    await expect(sendRequest(a.id, b.id)).rejects.toThrowError(/unavailable/i);
    await expect(sendRequest(b.id, a.id)).rejects.toThrowError(/unavailable/i);
  });

  it("refuses accept across a block without revealing direction", async () => {
    const a = await mkPlayer("ab_a");
    const b = await mkPlayer("ab_b");
    const sent = await sendRequest(a.id, b.id);
    await blockPlayer(a.id, b.id);
    await expect(acceptRequest(b.id, sent.friendshipId)).rejects.toThrow();
    // Race state where both rows exist: the guard still refuses neutrally.
    const c = await mkPlayer("ab_c");
    const d = await mkPlayer("ab_d");
    await blockPlayer(c.id, d.id);
    const [userA, userB] = c.id < d.id ? [c.id, d.id] : [d.id, c.id];
    const inserted = await getDb()
      .insert(friendships)
      .values({ userA, userB, status: "pending", requestedBy: c.id })
      .returning();
    await expect(acceptRequest(d.id, inserted[0].id)).rejects.toThrowError(/no longer available/i);
    await getDb().delete(friendships).where(eq(friendships.id, inserted[0].id));
  });

  it("hides blocked pairs from search both ways", async () => {
    const a = await mkPlayer("hs_a");
    const b = await mkPlayer("hs_b_xyz");
    const q = b.username!.slice(0, 10);
    expect((await searchPlayers(a.id, q)).some((r) => r.player.id === b.id)).toBe(true);
    await blockPlayer(a.id, b.id);
    expect((await searchPlayers(a.id, q)).some((r) => r.player.id === b.id)).toBe(false);
    expect((await searchPlayers(b.id, a.username!.slice(0, 10))).some((r) => r.player.id === a.id)).toBe(false);
  });

  it("keeps concurrent accept/block in a safe end state", async () => {
    const a = await mkPlayer("cc_a");
    const b = await mkPlayer("cc_b");
    const sent = await sendRequest(a.id, b.id);
    await blockPlayer(a.id, b.id);
    await expect(acceptRequest(b.id, sent.friendshipId)).rejects.toThrow();
    expect(await listFriendships(a.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await blockedIdsFor(a.id)).has(b.id)).toBe(true);
  });

  it("answers the shared guard in both directions", async () => {
    const a = await mkPlayer("g_a");
    const b = await mkPlayer("g_b");
    expect(await canSociallyInteract(a.id, b.id)).toEqual({ allowed: true });
    await blockPlayer(a.id, b.id);
    expect(await canSociallyInteract(a.id, b.id)).toEqual({ allowed: false, reason: "blocked" });
    expect(await canSociallyInteract(b.id, a.id)).toEqual({ allowed: false, reason: "blocked" });
    await unblockPlayer(a.id, b.id);
    expect(await canSociallyInteract(a.id, b.id)).toEqual({ allowed: true });
  });
});
