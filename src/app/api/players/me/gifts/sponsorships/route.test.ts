// P6c route contracts: auth, validation, neutral failures, happy path.
// DAL runs against TEST; only Privy verification is mocked.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { acceptRequest, sendRequest } from "@/db/friendships";
import { blockPlayer } from "@/db/blocks";
import {
  cardXpProgress,
  friendships,
  giftSponsorships,
  goldEarnLedger,
  goldSpendLedger,
  matches,
  playerBlocks,
  players,
  type Player,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET as listGet, POST as sponsorPost } from "./route";
import { GET as quoteGet } from "./quote/route";

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

const BASE = "http://localhost/api/players/me/gifts/sponsorships";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

const req = (url: string, name: string | null, body?: unknown) =>
  new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

async function befriendAt(a: Player, b: Player, ageMs: number): Promise<void> {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
  await getDb().update(friendships).set({ acceptedAt: new Date(Date.now() - ageMs) }).where(eq(friendships.id, sent.friendshipId));
}

async function fundGold(p: Player, wins: number): Promise<void> {
  const db = getDb();
  for (let i = 0; i < wins; i += 1) {
    const id = randomUUID();
    matchIds.push(id);
    await db.insert(matches).values({
      id, roomId: `sr-${id.slice(0, 8)}`, matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0,
      ticks: 1800, liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    await db.insert(goldEarnLedger).values({ matchId: id, playerId: p.id, amount: 60, result: "win", policyVersion: 1 });
  }
}

async function setXp(p: Player, cardId: string, xp: number, level: number): Promise<void> {
  await getDb()
    .insert(cardXpProgress)
    .values({ playerId: p.id, cardId, xp, level: 10, purchasedLevel: level })
    .onConflictDoUpdate({ target: [cardXpProgress.playerId, cardXpProgress.cardId], set: { xp, level: 10, purchasedLevel: level } });
}

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (createdPlayerIds.length > 0) {
    await db.delete(giftSponsorships).where(inArray(giftSponsorships.sponsorId, createdPlayerIds));
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
  }
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(friendships);
    await db.delete(playerBlocks);
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

describe("P6c sponsorship routes", () => {
  it("refuses unauthenticated access and malformed input", async () => {
    expect((await sponsorPost(req(BASE, null, {}))).status).toBe(401);
    expect((await listGet(req(BASE, null))).status).toBe(401);
    expect((await quoteGet(req(`${BASE}/quote?recipientId=x`, null))).status).toBe(401);
    const a = await onboarded(`rt_a_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    const bad = await sponsorPost(req(BASE, a.username!, { recipientId: "nope", cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() }));
    expect(bad.status).toBe(400);
    const badRole = await listGet(req(`${BASE}?role=bogus`, a.username!));
    expect(badRole.status).toBe(400);
    const badQuote = await quoteGet(req(`${BASE}/quote?recipientId=nope&cardId=choglings`, a.username!));
    expect(badQuote.status).toBe(400);
  });

  it("sponsors through the write route and serves quote plus history", async () => {
    const s = await onboarded(`rt_s_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    const r = await onboarded(`rt_r_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    await befriendAt(s, r, 31 * DAY_MS);
    await fundGold(s, 2);
    await setXp(r, "choglings", 200, 1);

    const quote = (await (await quoteGet(req(`${BASE}/quote?recipientId=${r.id}&cardId=choglings`, s.username!))).json()) as {
      data: { eligible: boolean; reason: string; nextLevel: number | null; cost: number | null };
    };
    expect(quote.data).toMatchObject({ eligible: true, reason: "eligible", nextLevel: 1, cost: 100 });

    const created = (await (await sponsorPost(
      req(BASE, s.username!, { recipientId: r.id, cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() })
    )).json()) as { data: { status: string; recipientLevel: number; sponsorBalance: number; receiptId: string } };
    expect(created.data.status).toBe("sponsored");
    expect(created.data.recipientLevel).toBe(2);
    expect(created.data.sponsorBalance).toBe(20);

    const listed = (await (await listGet(req(BASE, s.username!))).json()) as {
      data: { sent: { id: string }[]; received: { id: string }[] };
    };
    expect(listed.data.sent.map((x) => x.id)).toContain(created.data.receiptId);
    expect(listed.data.received).toEqual([]);
    const rlisted = (await (await listGet(req(`${BASE}?role=received`, r.username!))).json()) as {
      data: { received: { id: string }[] };
    };
    expect(rlisted.data.received.map((x) => x.id)).toContain(created.data.receiptId);
  });

  it("keeps blocked sponsorship neutral with no private fields", async () => {
    const s = await onboarded(`rt_x_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    const r = await onboarded(`rt_y_${randomUUID().slice(0, 6)}`.replace(/-/g, ""));
    await befriendAt(s, r, 31 * DAY_MS);
    await fundGold(s, 2);
    await setXp(r, "choglings", 200, 1);
    await blockPlayer(r.id, s.id);
    const res = await sponsorPost(
      req(BASE, s.username!, { recipientId: r.id, cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("not-eligible");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("wallet");
    expect(raw).not.toContain("privy");
    expect(raw).not.toContain("did:");
  });
});
