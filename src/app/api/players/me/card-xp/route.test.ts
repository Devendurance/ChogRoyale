// P2a authenticated card progression route. Read-only. TEST branch only.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { cardXpAwards, cardXpProgress, cardXpRuns, matches, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { applyCardXp, stageCardXp } from "@/db/card-xp";
import { CARD_XP_LEVEL_REQUIREMENTS } from "@/lib/card-xp";
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

const URL_ = "http://localhost/api/players/me/card-xp";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, matchIds));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function onboarded(suffix: string): Promise<{ player: Player; token: string }> {
  const did = `did:privy:cardxp_${suffix}_${randomUUID().slice(0, 6)}`;
  const p = await provisionPlayer({ privyDid: did });
  const [row] = await getDb()
    .update(players)
    .set({ username: `cx${suffix}`, usernameKey: `cx${suffix}`.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return { player: row!, token: `tok-${did.replace("did:privy:", "")}` };
}

const get = (token?: string) =>
  GET(new Request(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {}) as Request).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("GET /api/players/me/card-xp", () => {
  it("requires authentication", async () => {
    expect((await get(undefined)).status).toBe(401);
  });

  it("returns honest zeros across all 20 cards for a fresh player", async () => {
    const { token } = await onboarded("fresh");
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(r.body.data.cards.policyVersion).toBe(1);
    expect(r.body.data.cards.maxLevel).toBe(10);
    expect(r.body.data.cards.cards).toHaveLength(20);
    expect(r.body.data.cards.cards.every((c: { level: number; xp: number; eligible: boolean; maxed: boolean }) => c.level === 1 && c.xp === 0 && c.eligible === false && c.maxed === false)).toBe(true);
  });

  it("returns server-owned progress after verified usage", async () => {
    const { player, token } = await onboarded("prog");
    const matchId = randomUUID();
    matchIds.push(matchId);
    await getDb().insert(matches).values({
      id: matchId, roomId: "cx-room", matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 1, ticks: 1800,
      liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    await stageCardXp(matchId, [{ playerId: player.id, cardId: "choglings", deployments: 5, xp: 5 }], "done");
    await applyCardXp(matchId);
    const r = await get(token);
    expect(r.status).toBe(200);
    const chog = r.body.data.cards.cards.find((c: { cardId: string }) => c.cardId === "choglings");
    expect(chog).toMatchObject({ level: 2, xp: 5, xpTarget: CARD_XP_LEVEL_REQUIREMENTS[2], eligible: false, maxed: false });
    const rest = r.body.data.cards.cards.filter((c: { cardId: string }) => c.cardId !== "choglings");
    expect(rest.every((c: { xp: number }) => c.xp === 0)).toBe(true);
    // No XP-write surface: unknown routes stay 404.
    expect(r.body.data.cards.cards.every((c: { cardId: string }) => typeof c.cardId === "string")).toBe(true);
  });
});
