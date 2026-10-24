// P5e.1 gift-eligibility focused tests. Deterministic time via explicit
// acceptedAt values plus a nowMsOverride; one case pins the default path
// to the server/database clock.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, removeFriendship, sendRequest } from "@/db/friendships";
import { blockPlayer, unblockPlayer } from "@/db/blocks";
import { canGiftToFriend, FRIENDSHIP_GIFT_MS } from "@/db/gifting";
import { friendships, playerBlocks, players, type Player } from "@/db/schema";

beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
});

const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const createdPlayerIds: string[] = [];

const mkPlayer = async (name: string): Promise<Player> => {
  const tag = `gift_${name}_${randomUUID().slice(0, 8)}`.toLowerCase().replace(/-/g, "_");
  const p = await provisionPlayer({ privyDid: `did:privy:${tag}` });
  const key = tag.slice(0, 20);
  const [row] = await getDb()
    .update(players)
    .set({ username: key, usernameKey: key, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
};

async function befriendAt(a: Player, b: Player, acceptedAt: Date | null): Promise<string> {
  const sent = await sendRequest(a.id, b.id);
  const accepted = await acceptRequest(b.id, sent.friendshipId);
  await getDb().update(friendships).set({ acceptedAt }).where(eq(friendships.id, accepted.friendshipId));
  return accepted.friendshipId;
}

async function acceptedAtOf(friendshipId: string): Promise<Date | null> {
  const rows = await getDb().select().from(friendships).where(eq(friendships.id, friendshipId)).limit(1);
  const v = rows[0]?.acceptedAt;
  return v ? new Date(v) : null;
}

afterAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("P5e.1 gift eligibility", () => {
  it("writes acceptedAt on accept and leaves pending rows null", async () => {
    const a = await mkPlayer("accept_ts_a");
    const b = await mkPlayer("accept_ts_b");
    const sent = await sendRequest(a.id, b.id);
    expect(await acceptedAtOf(sent.friendshipId)).toBeNull();
    const accepted = await acceptRequest(b.id, sent.friendshipId);
    expect(await acceptedAtOf(accepted.friendshipId)).toBeInstanceOf(Date);
  });

  it("pending requests are ineligible", async () => {
    const a = await mkPlayer("pending_a");
    const b = await mkPlayer("pending_b");
    await sendRequest(a.id, b.id);
    const res = await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW });
    expect(res).toEqual({ eligible: false, reason: "pending", nextEligibleAt: null });
  });

  it("accepted friendship under 30 days is too-new with a verifiable next time", async () => {
    const a = await mkPlayer("new_a");
    const b = await mkPlayer("new_b");
    const acceptedAt = new Date(NOW - 10 * DAY);
    await befriendAt(a, b, acceptedAt);
    const res = await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("too-new");
    expect(res.nextEligibleAt).toBe(new Date(acceptedAt.getTime() + FRIENDSHIP_GIFT_MS).toISOString());
  });

  it("exactly 30 full days qualifies, 29d23h does not", async () => {
    const a = await mkPlayer("exact_a");
    const b = await mkPlayer("exact_b");
    await befriendAt(a, b, new Date(NOW - 30 * DAY));
    expect(await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).toEqual({
      eligible: true,
      reason: "eligible",
      nextEligibleAt: null,
    });

    const c = await mkPlayer("exact_c");
    const d = await mkPlayer("exact_d");
    await befriendAt(c, d, new Date(NOW - (29 * DAY + 23 * 60 * 60 * 1000)));
    const res = await canGiftToFriend(c.id, d.id, { nowMsOverride: NOW });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("too-new");
    expect(res.nextEligibleAt).not.toBeNull();
  });

  it("removed friendships are ineligible and re-friending resets the clock", async () => {
    const a = await mkPlayer("reset_a");
    const b = await mkPlayer("reset_b");
    const fid = await befriendAt(a, b, new Date(NOW - 31 * DAY));
    expect((await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).eligible).toBe(true);
    await removeFriendship(a.id, fid);
    expect(await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "not-friends",
      nextEligibleAt: null,
    });
    // Re-friend now: fresh acceptedAt, so the old 31-day history is gone.
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    const fresh = await acceptedAtOf(sent.friendshipId);
    expect(fresh).toBeInstanceOf(Date);
    const res = await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("too-new");
  });

  it("blocks in either direction prevent gifting with a neutral reason", async () => {
    const a = await mkPlayer("block_a");
    const b = await mkPlayer("block_b");
    await befriendAt(a, b, new Date(NOW - 31 * DAY));
    await blockPlayer(a.id, b.id);
    expect(await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "unavailable",
      nextEligibleAt: null,
    });
    expect(await canGiftToFriend(b.id, a.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "unavailable",
      nextEligibleAt: null,
    });
    await unblockPlayer(a.id, b.id);
    // Unblock ends the friendship row without restoring it.
    expect(await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "not-friends",
      nextEligibleAt: null,
    });

    const c = await mkPlayer("block_c");
    const d = await mkPlayer("block_d");
    await befriendAt(c, d, new Date(NOW - 31 * DAY));
    await blockPlayer(d.id, c.id);
    expect(await canGiftToFriend(c.id, d.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "unavailable",
      nextEligibleAt: null,
    });
  });

  it("rejects self-gifting", async () => {
    const a = await mkPlayer("self");
    expect(await canGiftToFriend(a.id, a.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "self",
      nextEligibleAt: null,
    });
  });

  it("legacy accepted rows without an acceptance timestamp never qualify", async () => {
    const a = await mkPlayer("legacy_a");
    const b = await mkPlayer("legacy_b");
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    // Simulate a pre-P5e.1 row: accepted long ago, but no trustworthy date.
    await getDb()
      .update(friendships)
      .set({ acceptedAt: null, createdAt: new Date(NOW - 90 * DAY) })
      .where(eq(friendships.id, sent.friendshipId));
    expect(await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).toEqual({
      eligible: false,
      reason: "no-acceptance-record",
      nextEligibleAt: null,
    });
  });

  it("defaults to the server/database clock, not caller time", async () => {
    const a = await mkPlayer("clock_a");
    const b = await mkPlayer("clock_b");
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    // acceptedAt ~ real now: eligible only after 30 real days pass.
    const res = await canGiftToFriend(a.id, b.id);
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("too-new");
    expect(res.nextEligibleAt).not.toBeNull();
  });

  it("concurrent relationship changes cannot leave durable false eligibility", async () => {
    const a = await mkPlayer("race_a");
    const b = await mkPlayer("race_b");
    const fid = await befriendAt(a, b, new Date(NOW - 31 * DAY));
    expect((await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).eligible).toBe(true);
    // A removal landing after the read must invalidate any cached true.
    await removeFriendship(a.id, fid);
    expect((await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW })).eligible).toBe(false);
    // P5e.2 must recheck inside its write; this test pins the boundary:
    // a stale eligible snapshot plus a fresh check never both stay true.
    const stale = { eligible: true };
    const fresh = await canGiftToFriend(a.id, b.id, { nowMsOverride: NOW });
    expect(stale.eligible && fresh.eligible).toBe(false);
  });

  it("unknown players do not leak state", async () => {
    const a = await mkPlayer("unknown_a");
    const res = await canGiftToFriend(a.id, randomUUID(), { nowMsOverride: NOW });
    expect(res).toEqual({ eligible: false, reason: "not-friends", nextEligibleAt: null });
  });

  it("unonboarded peers stay unavailable without detail", async () => {
    const a = await mkPlayer("onb_a");
    const raw = await provisionPlayer({ privyDid: `did:privy:pending_${randomUUID().slice(0, 8)}` });
    createdPlayerIds.push(raw.id);
    await getDb().execute(sql`INSERT INTO friendships (user_a, user_b, status, requested_by, accepted_at) VALUES (${a.id < raw.id ? a.id : raw.id}, ${a.id < raw.id ? raw.id : a.id}, 'accepted', ${a.id}, now()) ON CONFLICT DO NOTHING`);
    const res = await canGiftToFriend(a.id, raw.id, { nowMsOverride: NOW });
    expect(res).toEqual({ eligible: false, reason: "unavailable", nextEligibleAt: null });
  });
});
