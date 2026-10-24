// P5e.1 gift-eligibility read API: auth, neutral blocked responses, no leaks.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { friendships, playerBlocks, players, type Player } from "@/db/schema";
import { acceptRequest, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import { AppError } from "@/lib/errors";
import { GET } from "./route";

vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>();
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const BASE = "http://localhost/api/players/me/gifts/eligibility";
const createdNames: string[] = [];
const createdPlayerIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

const req = (name: string | null, peerId: string | null) => {
  const url = peerId === null ? BASE : `${BASE}?peerId=${peerId}`;
  return new Request(url, { headers: name ? { authorization: `Bearer tok-${name}` } : {} });
};

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(inArray(players.id, [p.id]))
    .returning();
  createdNames.push(name);
  createdPlayerIds.push(p.id);
  return row!;
}

beforeAll(() => {
  routeDalToTestDb();
});

beforeAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
});

afterAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

describe("gift eligibility route", () => {
  it("refuses unauthenticated reads", async () => {
    const res = await GET(req(null, randomUUID()));
    expect(res.status).toBe(401);
  });

  it("rejects bad peer ids and self checks", async () => {
    const a = await onboarded(`gr_self_${randomUUID().slice(0, 6)}`.toLowerCase().replace(/-/g, ""));
    const bad = await GET(req(a.username!, "not-a-uuid"));
    expect(bad.status).toBe(400);
    const self = await GET(req(a.username!, a.id));
    const body = (await self.json()) as { success: boolean; data: { eligible: boolean; reason: string } };
    expect(body.data).toMatchObject({ eligible: false, reason: "self" });
  });

  it("reports too-new with a next time, never private fields", async () => {
    const s = `gr_new1_${randomUUID().slice(0, 6)}`.toLowerCase().replace(/-/g, "");
    const r = `gr_new2_${randomUUID().slice(0, 6)}`.toLowerCase().replace(/-/g, "");
    const a = await onboarded(s);
    const b = await onboarded(r);
    const sent = await sendRequest(a.id, b.id);
    const accepted = await acceptRequest(b.id, sent.friendshipId);
    await getDb().update(friendships).set({ acceptedAt: new Date(Date.now() - 5 * DAY) }).where(eq(friendships.id, accepted.friendshipId));
    const res = await GET(req(a.username!, b.id));
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.data.eligible).toBe(false);
    expect(body.data.reason).toBe("too-new");
    expect(typeof body.data.nextEligibleAt).toBe("string");
    const raw = JSON.stringify(body.data);
    expect(raw).not.toContain(a.id);
    expect(raw).not.toContain(b.id);
  });

  it("blocked pairs get a neutral unavailable with no direction leak", async () => {
    const s = `gr_blk1_${randomUUID().slice(0, 6)}`.toLowerCase().replace(/-/g, "");
    const r = `gr_blk2_${randomUUID().slice(0, 6)}`.toLowerCase().replace(/-/g, "");
    const a = await onboarded(s);
    const b = await onboarded(r);
    const sent = await sendRequest(a.id, b.id);
    await acceptRequest(b.id, sent.friendshipId);
    await getDb().update(friendships).set({ acceptedAt: new Date(Date.now() - 60 * DAY) }).where(eq(friendships.id, sent.friendshipId));
    await blockPlayer(b.id, a.id);
    const fromA = (await (await GET(req(a.username!, b.id))).json()) as { data: { eligible: boolean; reason: string } };
    const fromB = (await (await GET(req(b.username!, a.id))).json()) as { data: { eligible: boolean; reason: string } };
    expect(fromA.data).toEqual({ eligible: false, reason: "unavailable", nextEligibleAt: null });
    expect(fromB.data).toEqual({ eligible: false, reason: "unavailable", nextEligibleAt: null });
  });
});
