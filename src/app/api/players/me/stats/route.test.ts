import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchParticipants, matches, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET } from "./route";
import { GET as matchesGet } from "@/app/api/players/me/matches/route";
import { PRESETS } from "@/server/battle/session";

// Identity comes only from the verified token: tok-<name> -> did:privy:<name>.
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

const URL_ = "http://localhost/api/players/me/stats";
const MATCHES_URL = "http://localhost/api/players/me/matches";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) await db.delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
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

// Seeded settled-row fixtures; the route only reads them.
async function seedMatch(a: Player, b: Player, type: "private" | "matchmaking", winnerSeat: 0 | 1 | null, settledAt = new Date()) {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const deck8 = [...PRESETS.swarm!.cards, "cmdr:free-scout"];
  await getDb().insert(matches).values({
    id: matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType: type,
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(settledAt.getTime() - 60_000),
    finishedAt: settledAt,
    settledAt,
    outcome: winnerSeat === null ? "draw" : "win",
    winnerSeat,
    endReason: "core",
    crowns0: 3,
    crowns1: 1,
    ticks: 100,
    liveHash: `hash-${matchId}`,
    replayHash: `hash-${matchId}`,
    evidenceSha256: `ev-${matchId}`,
    verification: "replay-verified",
  });
  const res = (seat: 0 | 1) => (winnerSeat === null ? "draw" : winnerSeat === seat ? "win" : "loss");
  await getDb().insert(matchParticipants).values([
    { matchId, seat: 0, playerId: a.id, result: res(0), crowns: 3, deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
    { matchId, seat: 1, playerId: b.id, result: res(1), crowns: 1, deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
  ]);
}

const get = (name: string | null, url = URL_) =>
  GET(new Request(url, { headers: name ? { authorization: `Bearer tok-${name}` } : {} }));
const asPlayer = (p: Player) => p.privyDid.replace("did:privy:", "");

describe("player stats route", () => {
  it("rejects missing and forged auth", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await GET(new Request(URL_, { headers: { authorization: "Bearer forged" } }))).status).toBe(401);
  });

  it("returns verified aggregates consistent with the matches route, and empty stats for new players", async () => {
    const me = await onboarded(`stats_${randomUUID().slice(0, 6)}`);
    const them = await onboarded(`stats_${randomUUID().slice(0, 6)}`);
    const res = await get(asPlayer(me));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { success: boolean; data: { username: string; stats: { total: number; winRateBp: number | null }; casual: { eligible: boolean; matchmakingMatches: number } } };
    expect(j.data.username).toBe(me.username);
    expect(j.data.stats.total).toBe(0);
    expect(j.data.stats.winRateBp).toBeNull();
    expect(j.data.casual).toMatchObject({ eligible: false, matchmakingMatches: 0, position: null });

    // 2 wins private, 1 win + 1 loss matchmaking.
    await seedMatch(me, them, "private", 0);
    await seedMatch(me, them, "private", 0);
    await seedMatch(me, them, "matchmaking", 0);
    await seedMatch(them, me, "matchmaking", 0);
    const res2 = await get(asPlayer(me));
    const j2 = (await res2.json()) as { success: boolean; data: { stats: { total: number; wins: number; losses: number; winRateBp: number }; casual: { matchmakingMatches: number; eligible: boolean } } };
    expect(j2.data.stats).toMatchObject({ total: 4, wins: 3, losses: 1, winRateBp: 7500 });
    expect(j2.data.casual.matchmakingMatches).toBe(2);
    expect(j2.data.casual.eligible).toBe(false);
    // Same rows feed match history: the item count must match stats.total.
    const m = await matchesGet(new Request(`${MATCHES_URL}?limit=50`, { headers: { authorization: `Bearer tok-${asPlayer(me)}` } }));
    const mj = (await m.json()) as { data: { items: unknown[] } };
    expect(mj.data.items.length).toBe(j2.data.stats.total);
  });

  it("never leaks player ids, privy dids, wallets, seeds or commands", async () => {
    const me = await onboarded(`stats_${randomUUID().slice(0, 6)}`);
    const them = await onboarded(`stats_${randomUUID().slice(0, 6)}`);
    await seedMatch(me, them, "matchmaking", 0);
    const text = await (await get(asPlayer(me))).text();
    expect(text).not.toContain(me.id);
    expect(text).not.toContain(them.id);
    expect(text).not.toContain("did:privy");
    expect(text).not.toMatch(/0x[0-9a-f]{8}/i);
    expect(text).not.toMatch(/seed|commands|privyDid/);
  });
});
