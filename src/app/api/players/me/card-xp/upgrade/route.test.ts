// P2b paid upgrade route. No Gold is ever invented client-side; the
// server checks XP, balance and the expected level atomically. TEST only.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  cardXpProgress,
  goldEarnLedger,
  goldSpendLedger,
  matches,
  players,
  type Player,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POST } from "./route";

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

const URL_ = "http://localhost/api/players/me/card-xp/upgrade";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function onboarded(suffix: string): Promise<{ player: Player; token: string }> {
  const did = `did:privy:upg_${suffix}_${randomUUID().slice(0, 6)}`;
  const p = await provisionPlayer({ privyDid: did });
  const [row] = await getDb()
    .update(players)
    .set({ username: `ug${suffix}`, usernameKey: `ug${suffix}`.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return { player: row!, token: `tok-${did.replace("did:privy:", "")}` };
}

/** Real ledger setup: a settled-style match row plus earn + XP rows. */
async function setupRich(p: Player, wins: number, xp = 200, cardId = "choglings") {
  const db = getDb();
  for (let i = 0; i < wins; i += 1) {
    const m = randomUUID();
    matchIds.push(m);
    await db.insert(matches).values({
      id: m, roomId: `up-${m.slice(0, 8)}`, matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
      outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
      liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
    });
    await db.insert(goldEarnLedger).values({ matchId: m, playerId: p.id, amount: 60, result: "win", policyVersion: 1 });
  }
  await db.insert(cardXpProgress).values({ playerId: p.id, cardId, xp, level: 10, purchasedLevel: 1 });
}

async function post(token: string | undefined, body: unknown) {
  const r = await POST(
    new Request(URL_, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }) as Request
  );
  return { status: r.status, body: (await r.json()) as { success: boolean; data: Record<string, unknown> } };
}

describe("POST /api/players/me/card-xp/upgrade", () => {
  it("requires authentication and well-formed bodies", async () => {
    expect((await post(undefined, {})).status).toBe(401);
    const { token } = await onboarded("shape");
    expect((await post(token, {})).status).toBe(400);
    expect((await post(token, { cardId: "choglings", expectedLevel: 1, idempotencyKey: "bad" })).status).toBe(400);
    expect((await post(token, { cardId: "", expectedLevel: 1, idempotencyKey: randomUUID() })).status).toBe(400);
    expect((await post(token, { cardId: "choglings", expectedLevel: 1.5, idempotencyKey: randomUUID() })).status).toBe(400);
  });

  it("refuses invalid cards and empty balances without charging", async () => {
    const { player, token } = await onboarded("poor");
    await setupRich(player, 0);
    const bad = await post(token, { cardId: "nope", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(bad.status).toBe(200);
    expect(bad.body.data).toMatchObject({ status: "invalid-card" });
    const noGold = await post(token, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(noGold.status).toBe(200);
    // XP row exists with 200 but the setup earned no gold: insufficient gold.
    expect(noGold.body.data).toMatchObject({ status: "insufficient-gold" });
  });

  it("upgrades exactly once and replays the same key for free", async () => {
    const { player: p, token } = await onboarded("rich");
    const db = getDb();
    await setupRich(p, 2);
    const key = randomUUID();
    const r1 = await post(token, { cardId: "choglings", expectedLevel: 1, idempotencyKey: key });
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ status: "upgraded", purchasedLevel: 2, balance: 20 });
    const r2 = await post(token, { cardId: "choglings", expectedLevel: 1, idempotencyKey: key });
    expect(r2.body.data.status).toBe("duplicate");
    const spends = await db.select().from(goldSpendLedger).where(eq(goldSpendLedger.playerId, p!.id));
    expect(spends).toHaveLength(1);
    expect(spends[0]).toMatchObject({ fromLevel: 1, toLevel: 2, cost: 100 });
  });
});
