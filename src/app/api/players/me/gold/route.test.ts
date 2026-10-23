// P2b Gold balance route. Read-only. TEST branch only.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { goldEarnLedger, matchParticipants, matches, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { stageGoldEarn } from "@/db/gold";
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

const URL_ = "http://localhost/api/players/me/gold";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function onboarded(suffix: string): Promise<{ player: Player; token: string }> {
  const did = `did:privy:mygold_${suffix}_${randomUUID().slice(0, 6)}`;
  const p = await provisionPlayer({ privyDid: did });
  const [row] = await getDb()
    .update(players)
    .set({ username: `mg${suffix}`, usernameKey: `mg${suffix}`.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return { player: row!, token: `tok-${did.replace("did:privy:", "")}` };
}

const get = (token?: string) =>
  GET(new Request(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {}) as Request).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("GET /api/players/me/gold", () => {
  it("requires authentication", async () => {
    expect((await get(undefined)).status).toBe(401);
  });

  it("returns a zero balance with empty history for a fresh player", async () => {
    const { token } = await onboarded("fresh");
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(r.body.data.gold).toMatchObject({ policyVersion: 1, balance: 0, earned: 0, spent: 0, recentEarn: [], recentSpends: [] });
  });

  it("returns the derived balance and earn history", async () => {
    const { player, token } = await onboarded("rich");
    const matchId = randomUUID();
    matchIds.push(matchId);
    await getDb().insert(matches).values({
      id: matchId, roomId: "mg-room", matchType: "ranked", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
      liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    await stageGoldEarn(matchId, [{ playerId: player.id, amount: 60, result: "win" }]);
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(r.body.data.gold).toMatchObject({ balance: 60, earned: 60, spent: 0 });
    expect(r.body.data.gold.recentEarn[0]).toMatchObject({ matchId, amount: 60, result: "win" });
  });
});
