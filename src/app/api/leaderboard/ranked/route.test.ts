// P1b.2 ranked leaderboard route. Ranked rows only; the casual board is
// untouched. TEST branch only.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchParticipants, matches, players, rankedTrophyAwards, rankedTrophyBalances, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { awardRankedMatch } from "@/db/ranked";
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

const URL_ = "http://localhost/api/leaderboard/ranked";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(rankedTrophyAwards).where(inArray(rankedTrophyAwards.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(rankedTrophyBalances).where(inArray(rankedTrophyBalances.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:board_${name}_${randomUUID().slice(0, 6)}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

async function seedRankedWin(a: Player, b: Player) {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const deck8 = ["swarm", "archer", "sparkcaster", "sentry", "snare", "sprites", "bolt", "cmdr:free-scout"];
  await getDb().insert(matches).values({
    id: matchId, roomId: `br-${matchId.slice(0, 8)}`, matchType: "ranked", rulesetVersion: "v-test", protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
    outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
    liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
  });
  for (const seat of [0, 1] as const) {
    await getDb().insert(matchParticipants).values({
      matchId, seat, playerId: seat === 0 ? a.id : b.id, result: seat === 0 ? "win" : "loss",
      crowns: seat === 0 ? 3 : 0, deck: deck8, commanderKind: "free", commanderClass: "scout",
      nftTokenId: null, commanderIdentity: {}, entitlementOwner: null,
    });
  }
  const r = await awardRankedMatch(matchId);
  expect(r.status).toBe("awarded");
}

const get = (token?: string, qs = "") =>
  GET(new Request(`${URL_}${qs}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}) as Request).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("GET /api/leaderboard/ranked", () => {
  it("requires authentication", async () => {
    const r = await get(undefined);
    expect(r.status).toBe(401);
  });

  it("returns an empty board shape with no ranked matches", async () => {
    const p = await onboarded(`nb${randomUUID().slice(0, 6)}`);
    const r = await get(`tok-${p.privyDid.replace("did:privy:", "")}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ kind: "ranked-season-1", season: 1, total: 0, me: { eligible: false, position: null } });
  });

  it("ranks by trophies server-side with stable order and a real me row", async () => {
    const [a, b, c] = [await onboarded(`ra${randomUUID().slice(0, 4)}`), await onboarded(`rb${randomUUID().slice(0, 4)}`), await onboarded(`rc${randomUUID().slice(0, 4)}`)];
    await seedRankedWin(a, b);
    await seedRankedWin(a, c);
    // Other suites share the TEST board, so assert relative order among the
    // three seeded players rather than the global top row.
    const r = await get(`tok-${a.privyDid.replace("did:privy:", "")}`);
    expect(r.status).toBe(200);
    expect(r.body.data.kind).toBe("ranked-season-1");
    const mine = r.body.data.entries.filter((e: { username: string }) => [a.username, b.username, c.username].includes(e.username));
    // a won twice (50); b and c lost once each (0). a sorts first, b/c tie.
    expect(mine[0]).toMatchObject({ username: a.username, trophies: 50, wins: 2, isYou: true });
    expect(new Set(mine.slice(1).map((e: { username: string }) => e.username))).toEqual(new Set([b.username, c.username]));
    expect(mine.slice(1).every((e: { trophies: number }) => e.trophies === 0)).toBe(true);
    expect(r.body.data.me).toMatchObject({ eligible: true, trophies: 50, rankedMatches: 2 });
    expect(r.body.data.entries.every((e: { playerId?: string }) => e.playerId === undefined)).toBe(true);
  });
});
