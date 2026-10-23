// P1b.2 authenticated ranked standing route. Read-only. TEST branch only.
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

const URL_ = "http://localhost/api/players/me/ranked";
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

async function onboarded(suffix: string): Promise<{ player: Player; token: string }> {
  const did = `did:privy:meranked_${suffix}_${randomUUID().slice(0, 6)}`;
  const p = await provisionPlayer({ privyDid: did });
  const [row] = await getDb()
    .update(players)
    .set({ username: `mr${suffix}`, usernameKey: `mr${suffix}`.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return { player: row!, token: `tok-${did.replace("did:privy:", "")}` };
}

const get = (token?: string) =>
  GET(new Request(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {}) as Request).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("GET /api/players/me/ranked", () => {
  it("requires authentication", async () => {
    expect((await get(undefined)).status).toBe(401);
  });

  it("returns zeros for a player with no ranked matches", async () => {
    const { token } = await onboarded("fresh");
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(r.body.data.ranked).toMatchObject({ season: 1, trophies: 0, eligible: false, position: null, rankedMatches: 0, recent: [] });
  });

  it("returns trophies, rank and the latest trophy delta after a verified win", async () => {
    const { player, token } = await onboarded("winner");
    const { player: opp } = await onboarded("loser");
    const matchId = randomUUID();
    matchIds.push(matchId);
    const deck8 = ["swarm", "archer", "sparkcaster", "sentry", "snare", "sprites", "bolt", "cmdr:free-scout"];
    await getDb().insert(matches).values({
      id: matchId, roomId: "mr-room", matchType: "ranked", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 1, ticks: 1800,
      liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    for (const seat of [0, 1] as const) {
      await getDb().insert(matchParticipants).values({
        matchId, seat, playerId: seat === 0 ? player.id : opp.id, result: seat === 0 ? "win" : "loss",
        crowns: seat === 0 ? 3 : 1, deck: deck8, commanderKind: "free", commanderClass: "scout",
        nftTokenId: null, commanderIdentity: {}, entitlementOwner: null,
      });
    }
    expect((await awardRankedMatch(matchId)).status).toBe("awarded");
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(r.body.data.ranked).toMatchObject({ season: 1, trophies: 25, eligible: true, rankedMatches: 1, wins: 1 });
    expect(r.body.data.ranked.position).toBeGreaterThanOrEqual(1);
    expect(r.body.data.ranked.recent[0]).toMatchObject({ matchId, result: "win", delta: 25, balanceAfter: 25 });
  });
});
