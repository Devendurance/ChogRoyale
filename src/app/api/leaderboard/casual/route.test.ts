import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchParticipants, matches, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET } from "./route";
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

const URL_ = "http://localhost/api/leaderboard/casual";
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
async function seedMm(a: Player, b: Player, winnerSeat: 0 | 1, crowns: [number, number] = [3, 0]) {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const deck8 = [...PRESETS.swarm!.cards, "cmdr:free-scout"];
  await getDb().insert(matches).values({
    id: matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType: "matchmaking",
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: new Date(),
    settledAt: new Date(),
    outcome: "win",
    winnerSeat,
    endReason: "core",
    crowns0: crowns[0],
    crowns1: crowns[1],
    ticks: 100,
    liveHash: `hash-${matchId}`,
    replayHash: `hash-${matchId}`,
    evidenceSha256: `ev-${matchId}`,
    verification: "replay-verified",
  });
  await getDb().insert(matchParticipants).values([
    { matchId, seat: 0, playerId: a.id, result: winnerSeat === 0 ? "win" : "loss", crowns: crowns[0], deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
    { matchId, seat: 1, playerId: b.id, result: winnerSeat === 1 ? "win" : "loss", crowns: crowns[1], deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
  ]);
}

const get = (name: string | null, query = "") =>
  GET(new Request(`${URL_}${query}`, { headers: name ? { authorization: `Bearer tok-${name}` } : {} }));
const asPlayer = (p: Player) => p.privyDid.replace("did:privy:", "");

interface Entry {
  position: number;
  username: string;
  wins: number;
  isYou: boolean;
}
interface Board {
  kind: string;
  minMatches: number;
  ordering: string;
  entries: Entry[];
  total: number;
  limit: number;
  offset: number;
  me: { position: number | null; eligible: boolean };
}

describe("casual leaderboard route", () => {
  it("rejects missing and forged auth", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await GET(new Request(URL_, { headers: { authorization: "Bearer forged" } }))).status).toBe(401);
  });

  it("returns the labelled board with isYou only on the caller's row and me metadata", async () => {
    const tag = randomUUID().slice(0, 4);
    const me = await onboarded(`lb_${tag}_me00`);
    const rival = await onboarded(`lb_${tag}_riva`);
    const filler = await onboarded(`lb_${tag}_fill`);
    for (let i = 0; i < 3; i += 1) {
      await seedMm(me, filler, 0, [2, 0]);
      await seedMm(rival, filler, 0, [3, 0]);
    }
    const res = await get(asPlayer(me));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { success: boolean; data: Board };
    expect(j.data.kind).toBe("casual-unranked");
    expect(j.data.minMatches).toBe(3);
    expect(j.data.ordering).toContain("matchmaking wins");
    const mine = j.data.entries.find((e) => e.username === me.username);
    const theirs = j.data.entries.find((e) => e.username === rival.username);
    expect(mine).toBeDefined();
    expect(theirs).toBeDefined();
    expect(mine!.isYou).toBe(true);
    expect(theirs!.isYou).toBe(false);
    // Rival has strictly more wins and ranks ahead.
    expect(theirs!.position).toBeLessThan(mine!.position);
    expect(j.data.me).toEqual({ position: mine!.position, eligible: true });
    // Entries expose no identity beyond the public profile.
    const text = JSON.stringify(j.data.entries);
    expect(text).not.toContain(me.id);
    expect(text).not.toContain(rival.id);
    expect(text).not.toMatch(/did:privy|0x[0-9a-f]{8}|seed|commands|privyDid/i);
  });

  it("reports ineligible callers honestly and honors pagination bounds", async () => {
    const me = await onboarded(`lb_${randomUUID().slice(0, 4)}_new0`);
    const j = (await (await get(asPlayer(me))).json()) as { success: boolean; data: Board };
    expect(j.data.me).toEqual({ position: null, eligible: false });
    expect(j.data.limit).toBeLessThanOrEqual(50);
    const paged = await get(asPlayer(me), "?limit=1&offset=0");
    expect(paged.status).toBe(200);
    const bad1 = await get(asPlayer(me), "?limit=abc");
    const bad2 = await get(asPlayer(me), "?limit=0");
    const bad3 = await get(asPlayer(me), "?offset=-1");
    const bad4 = await get(asPlayer(me), "?limit=51");
    for (const r of [bad1, bad2, bad3, bad4]) expect(r.status).toBe(400);
  });
});
