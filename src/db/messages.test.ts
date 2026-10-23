import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, listFriendships, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import {
  ackRead,
  checkDmRateLimit,
  fetchMessages,
  getOrCreateConversation,
  listConversations,
  sendMessage,
} from "@/db/messages";
import { dmConversations, dmMessages, friendships, playerBlocks, players, type Player } from "@/db/schema";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
}, 60000);

beforeAll(async () => {
  await getDb().delete(dmMessages);
  await getDb().delete(dmConversations);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
}, 60000);

const createdPlayerIds: string[] = [];
const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `msg_${name}_${randomUUID().slice(0, 8)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  await getDb()
    .update(players)
    .set({ username: tag.slice(0, 20), usernameKey: tag.slice(0, 20), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id));
  createdPlayerIds.push(p.id);
  return p;
};

const befriend = async (a: Player, b: Player) => {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
};

afterAll(async () => {
  await getDb().delete(dmMessages);
  await getDb().delete(dmConversations);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
}, 60000);

describe("direct messages", () => {
  it("sends between confirmed friends and reads back in order", async () => {
    const a = await mkPlayer("ab_a");
    const b = await mkPlayer("ab_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    const first = await sendMessage(a.id, conversationId, "hello", randomUUID());
    expect(first.duplicate).toBe(false);
    expect(first.message.sender).toBe(a.id);
    expect(first.message.status).toBe("sent");
    await sendMessage(b.id, conversationId, "hi back", randomUUID());
    const page = await fetchMessages(a.id, conversationId, null, 10);
    expect(page.messages.map((m) => m.content)).toEqual(["hello", "hi back"]);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects sends without an accepted friendship", async () => {
    const a = await mkPlayer("nf_a");
    const b = await mkPlayer("nf_b");
    await expect(getOrCreateConversation(a.id, b.id)).rejects.toThrowError(/unavailable/i);
    // Pending requests are not enough either.
    await sendRequest(a.id, b.id);
    await expect(getOrCreateConversation(a.id, b.id)).rejects.toThrowError(/unavailable/i);
  });

  it("rejects self messages, unknown players and bad ids", async () => {
    const a = await mkPlayer("bad_a");
    await expect(getOrCreateConversation(a.id, a.id)).rejects.toThrow();
    await expect(getOrCreateConversation(a.id, randomUUID())).rejects.toThrow();
    await expect(fetchMessages(a.id, "not-a-uuid", null)).rejects.toThrow();
    await expect(fetchMessages(a.id, randomUUID(), null)).rejects.toThrow();
  });

  it("enforces blocks in both directions at send time", async () => {
    const a = await mkPlayer("bl_a");
    const b = await mkPlayer("bl_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    await blockPlayer(a.id, b.id);
    await expect(sendMessage(a.id, conversationId, "x", randomUUID())).rejects.toThrowError(/unavailable/i);
    await expect(sendMessage(b.id, conversationId, "x", randomUUID())).rejects.toThrowError(/unavailable/i);
  });

  it("unfriend prevents new messages but keeps history", async () => {
    const a = await mkPlayer("un_a");
    const b = await mkPlayer("un_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    await sendMessage(a.id, conversationId, "before", randomUUID());
    const lists = await listFriendships(a.id);
    await getDb().delete(friendships).where(eq(friendships.id, lists.friends[0].friendshipId));
    await expect(sendMessage(a.id, conversationId, "after", randomUUID())).rejects.toThrowError(/unavailable/i);
    const page = await fetchMessages(a.id, conversationId, null, 10);
    expect(page.messages.map((m) => m.content)).toEqual(["before"]);
  });

  it("keeps history readable after a block but hides the inbox row", async () => {
    const a = await mkPlayer("hb_a");
    const b = await mkPlayer("hb_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    await sendMessage(a.id, conversationId, "kept", randomUUID());
    await blockPlayer(b.id, a.id);
    expect(await listConversations(a.id)).toEqual([]);
    expect(await listConversations(b.id)).toEqual([]);
    const page = await fetchMessages(a.id, conversationId, null, 10);
    expect(page.messages.map((m) => m.content)).toEqual(["kept"]);
  });

  it("creates one conversation per pair under simultaneous creation", async () => {
    const a = await mkPlayer("dc_a");
    const b = await mkPlayer("dc_b");
    await befriend(a, b);
    const [first, second] = await Promise.all([
      getOrCreateConversation(a.id, b.id),
      getOrCreateConversation(b.id, a.id),
    ]);
    expect(first.conversationId).toBe(second.conversationId);
    const again = await getOrCreateConversation(a.id, b.id);
    expect(again).toEqual({ conversationId: first.conversationId, created: false });
  });

  it("treats a repeated idempotency key as a no-op", async () => {
    const a = await mkPlayer("ik_a");
    const b = await mkPlayer("ik_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    const key = randomUUID();
    const first = await sendMessage(a.id, conversationId, "once", key);
    const second = await sendMessage(a.id, conversationId, "once", key);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    const page = await fetchMessages(a.id, conversationId, null, 10);
    expect(page.messages.filter((m) => m.id === first.message.id)).toHaveLength(1);
  });

  it("collapses concurrent duplicate sends to one row", async () => {
    const a = await mkPlayer("cc_a");
    const b = await mkPlayer("cc_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      sendMessage(a.id, conversationId, "race", key),
      sendMessage(a.id, conversationId, "race", key),
    ]);
    expect(r1.message.id).toBe(r2.message.id);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);
  });

  it("rejects oversized and empty content", async () => {
    const a = await mkPlayer("ct_a");
    const b = await mkPlayer("ct_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    await expect(sendMessage(a.id, conversationId, "   ", randomUUID())).rejects.toThrow();
    await expect(sendMessage(a.id, conversationId, "x".repeat(1001), randomUUID())).rejects.toThrow();
  });

  it("paginates with a stable cursor", async () => {
    const a = await mkPlayer("pg_a");
    const b = await mkPlayer("pg_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    for (let i = 0; i < 5; i++) await sendMessage(a.id, conversationId, `m${i}`, randomUUID());
    const p1 = await fetchMessages(a.id, conversationId, null, 2);
    expect(p1.messages.map((m) => m.content)).toEqual(["m0", "m1"]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await fetchMessages(a.id, conversationId, p1.nextCursor, 2);
    expect(p2.messages.map((m) => m.content)).toEqual(["m2", "m3"]);
    const p3 = await fetchMessages(a.id, conversationId, p2.nextCursor, 2);
    expect(p3.messages.map((m) => m.content)).toEqual(["m4"]);
    expect(p3.nextCursor).toBeNull();
    await expect(fetchMessages(a.id, conversationId, "bogus", 2)).rejects.toThrow();
  });

  it("tracks unread and read honestly, recipient only", async () => {
    const a = await mkPlayer("rd_a");
    const b = await mkPlayer("rd_b");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    const m1 = await sendMessage(a.id, conversationId, "one", randomUUID());
    await sendMessage(a.id, conversationId, "two", randomUUID());
    expect((await listConversations(b.id))[0].unread).toBe(2);
    expect((await listConversations(a.id))[0].unread).toBe(0);
    await ackRead(b.id, conversationId, m1.message.id);
    const after = await fetchMessages(b.id, conversationId, null, 10);
    expect(after.messages[0].status).toBe("read");
    expect(after.messages[1].status).toBe("sent");
    expect((await listConversations(b.id))[0].unread).toBe(1);
    expect((await ackRead(b.id, conversationId, after.messages[1].id)).read).toBe(true);
    expect((await listConversations(b.id))[0].unread).toBe(0);
  });

  it("refuses forged read acknowledgements", async () => {
    const a = await mkPlayer("fg_a");
    const b = await mkPlayer("fg_b");
    const c = await mkPlayer("fg_c");
    const d = await mkPlayer("fg_d");
    await befriend(a, b);
    await befriend(c, d);
    const ca = await getOrCreateConversation(a.id, b.id);
    const cc = await getOrCreateConversation(c.id, d.id);
    const foreign = await sendMessage(c.id, cc.conversationId, "foreign", randomUUID());
    await expect(ackRead(a.id, ca.conversationId, foreign.message.id)).rejects.toThrow();
    await expect(ackRead(a.id, ca.conversationId, randomUUID())).rejects.toThrow();
    await expect(ackRead(c.id, cc.conversationId, foreign.message.id)).rejects.toThrow();
  });

  it("refuses reads by non-participants without leaking", async () => {
    const a = await mkPlayer("ur_a");
    const b = await mkPlayer("ur_b");
    const s = await mkPlayer("ur_s");
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    await sendMessage(a.id, conversationId, "private", randomUUID());
    await expect(fetchMessages(s.id, conversationId, null)).rejects.toThrowError(/not found/i);
    const listed = await listConversations(s.id);
    expect(listed.some((c) => c.conversationId === conversationId)).toBe(false);
  });

  it("throttles rapid sends", () => {
    const id = randomUUID();
    const now = Date.now();
    for (let i = 0; i < 20; i++) checkDmRateLimit(id, now);
    expect(() => checkDmRateLimit(id, now)).toThrowError(/too quickly/i);
    expect(() => checkDmRateLimit(id, now + 61_000)).not.toThrow();
  });
});
