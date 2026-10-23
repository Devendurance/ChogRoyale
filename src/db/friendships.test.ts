import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  acceptRequest,
  declineRequest,
  listFriendships,
  removeFriendship,
  searchPlayers,
  sendRequest,
} from "@/db/friendships";
import { friendships, players, type Player } from "@/db/schema";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(friendships);
});

const createdPlayerIds: string[] = [];
const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `friend_${name}_${randomUUID().slice(0, 8)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  await getDb()
    .update(players)
    .set({ username: tag.slice(0, 20), usernameKey: tag.slice(0, 20) })
    .where(eq(players.id, p.id));
  createdPlayerIds.push(p.id);
  return { ...p, username: tag.slice(0, 20), usernameKey: tag.slice(0, 20) };
};

afterAll(async () => {
  await getDb().delete(friendships);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("friendships", () => {
  it("starts empty for a new player", async () => {
    const p = await mkPlayer("empty");
    expect(await listFriendships(p.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
  });

  it("sends, receives and accepts a request", async () => {
    const a = await mkPlayer("sender");
    const b = await mkPlayer("receiver");
    const sent = await sendRequest(a.id, b.id);
    expect(sent.status).toBe("pending");
    expect(sent.incoming).toBe(false);
    expect(sent.player.id).toBe(b.id);

    const forB = await listFriendships(b.id);
    expect(forB.incoming).toHaveLength(1);
    expect(forB.incoming[0].incoming).toBe(true);
    expect(forB.friends).toHaveLength(0);

    const accepted = await acceptRequest(b.id, sent.friendshipId);
    expect(accepted.status).toBe("accepted");

    const listA = await listFriendships(a.id);
    const listB = await listFriendships(b.id);
    expect(listA.friends).toHaveLength(1);
    expect(listB.friends).toHaveLength(1);
    expect(listA.friends[0].player.id).toBe(b.id);
    expect(listA.incoming).toHaveLength(0);
    expect(listA.outgoing).toHaveLength(0);
  });

  it("resending is idempotent and reverse send auto-accepts", async () => {
    const a = await mkPlayer("idem_a");
    const b = await mkPlayer("idem_b");
    const first = await sendRequest(a.id, b.id);
    const repeat = await sendRequest(a.id, b.id);
    expect(repeat.friendshipId).toBe(first.friendshipId);
    expect(repeat.status).toBe("pending");
    const crossed = await sendRequest(b.id, a.id);
    expect(crossed.friendshipId).toBe(first.friendshipId);
    expect(crossed.status).toBe("accepted");
    const again = await sendRequest(a.id, b.id);
    expect(again.status).toBe("accepted");
  });

  it("rejects self requests and unknown players", async () => {
    const a = await mkPlayer("selfish");
    await expect(sendRequest(a.id, a.id)).rejects.toThrow();
    await expect(sendRequest(a.id, randomUUID())).rejects.toThrow();
  });

  it("refuses accept by the requester or a stranger", async () => {
    const a = await mkPlayer("acc_a");
    const b = await mkPlayer("acc_b");
    const c = await mkPlayer("acc_c");
    const sent = await sendRequest(a.id, b.id);
    await expect(acceptRequest(a.id, sent.friendshipId)).rejects.toThrow();
    await expect(acceptRequest(c.id, sent.friendshipId)).rejects.toThrow();
  });

  it("declines incoming and cancels outgoing by removal", async () => {
    const a = await mkPlayer("dec_a");
    const b = await mkPlayer("dec_b");
    const sent = await sendRequest(a.id, b.id);
    await expect(declineRequest(a.id, sent.friendshipId)).rejects.toThrow();
    expect(await declineRequest(b.id, sent.friendshipId)).toEqual({ declined: true });
    expect(await listFriendships(a.id)).toEqual({ friends: [], incoming: [], outgoing: [] });

    const sent2 = await sendRequest(a.id, b.id);
    expect(await removeFriendship(a.id, sent2.friendshipId)).toEqual({ removed: true });
    expect(await listFriendships(b.id)).toEqual({ friends: [], incoming: [], outgoing: [] });
  });

  it("removes an established friend both ways", async () => {
    const a = await mkPlayer("rem_a");
    const b = await mkPlayer("rem_b");
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    expect(await removeFriendship(b.id, sent.friendshipId)).toEqual({ removed: true });
    expect((await listFriendships(a.id)).friends).toHaveLength(0);
    expect((await listFriendships(b.id)).friends).toHaveLength(0);
  });

  it("searches by username prefix with relationship status", async () => {
    const me = await mkPlayer("seeker");
    const target = await mkPlayer("target_xyz");
    const before = await searchPlayers(me.id, target.username!.slice(0, 8));
    const found = before.find((r) => r.player.id === target.id);
    expect(found?.status).toBe("none");
    expect(before.some((r) => r.player.id === me.id)).toBe(false);
    await sendRequest(me.id, target.id);
    const after = await searchPlayers(me.id, target.username!.slice(0, 8));
    expect(after.find((r) => r.player.id === target.id)?.status).toBe("outgoing");
    await expect(searchPlayers(me.id, "   ")).rejects.toThrow();
  });
});
