// P2a card XP persistence. TEST branch only, never PROD.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { cardXpAwards, cardXpProgress, cardXpRuns, matchParticipants, matches, players, type Player } from "@/db/schema";
import { CARD_XP_LEVEL_REQUIREMENTS, cardLevelForXp } from "@/lib/card-xp";
import {
  applyCardXp,
  getMyCardXp,
  ordinaryCardIds,
  reconcileCardXp,
  stageCardXp,
} from "./card-xp";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

async function cleanFixtures() {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, matchIds));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
}

beforeAll(async () => {
  await cleanFixtures();
});
afterAll(async () => {
  await cleanFixtures();
  resetDbCache();
});

async function player(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:xptest_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

async function seedMatch(type: "matchmaking" | "ranked" | "private" = "matchmaking"): Promise<string> {
  const matchId = randomUUID();
  matchIds.push(matchId);
  await getDb().insert(matches).values({
    id: matchId, roomId: `xp-${matchId.slice(0, 8)}`, matchType: type, rulesetVersion: "v-test", protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
    outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
    liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
  });
  return matchId;
}

describe("P2a card XP ledger", () => {
  it("lists the 20 ordinary cards and reports honest zeros", async () => {
    expect(ordinaryCardIds()).toHaveLength(20);
    const p = await player("zero");
    const me = await getMyCardXp(p.id);
    expect(me.cards).toHaveLength(20);
    expect(me.cards.every((c) => c.level === 1 && c.xp === 0 && c.eligible === false && c.maxed === false)).toBe(true);
    expect(me.cards[0]).toMatchObject({ xpTarget: CARD_XP_LEVEL_REQUIREMENTS[1] });
  });

  it("stages once and applies cumulative XP with the policy level ladder", async () => {
    const [a, b] = [await player("sa"), await player("sb")];
    const m1 = await seedMatch();
    const m2 = await seedMatch();
    expect(await stageCardXp(m1, [{ playerId: a.id, cardId: "choglings", deployments: 5, xp: 5 }], "done")).toMatchObject({ fresh: true });
    expect(await stageCardXp(m1, [{ playerId: a.id, cardId: "choglings", deployments: 5, xp: 5 }], "done")).toMatchObject({ fresh: false });
    await stageCardXp(m2, [{ playerId: a.id, cardId: "choglings", deployments: 3, xp: 3 }, { playerId: b.id, cardId: "rift_sentry", deployments: 2, xp: 2 }], "done");
    expect(await applyCardXp(m1)).toMatchObject({ applied: true, units: 1 });
    expect(await applyCardXp(m1)).toMatchObject({ applied: false, units: 0 });
    await applyCardXp(m2);
    // a/swarm totals 8 -> level 2 (threshold 5); b/sentry totals 2 -> level 1.
    const me = await getMyCardXp(a.id);
    const swarm = me.cards.find((c) => c.cardId === "choglings")!;
    expect(swarm).toMatchObject({ xp: 8, level: 2, eligible: false });
    expect(swarm.xpTarget).toBe(CARD_XP_LEVEL_REQUIREMENTS[2]);
    const other = me.cards.find((c) => c.cardId === "rift_sentry")!;
    expect(other).toMatchObject({ xp: 0, level: 1 });
  });

  it("keeps the SQL level ladder identical to the policy function", async () => {
    const p = await player("ladder");
    const totals = [0, 4, 5, 11, 12, 21, 22, 34, 35, 51, 52, 71, 72, 95, 96, 123, 124, 154, 155, 400];
    const ids = ordinaryCardIds();
    expect(ids).toHaveLength(totals.length);
    for (const [i, xp] of totals.entries()) {
      const m = await seedMatch();
      await stageCardXp(m, [{ playerId: p.id, cardId: ids[i]!, deployments: Math.max(xp, 1), xp }], "done");
      await applyCardXp(m);
    }
    const me = await getMyCardXp(p.id);
    for (const [i, xp] of totals.entries()) {
      const row = me.cards.find((c) => c.cardId === ids[i])!;
      expect(row.level).toBe(cardLevelForXp(xp));
      expect(row.maxed).toBe(row.level === 10);
      expect(row.eligible).toBe(row.level < 10 && xp >= CARD_XP_LEVEL_REQUIREMENTS[row.level]!);
      expect(row.xpTarget).toBe(row.level >= 10 ? null : CARD_XP_LEVEL_REQUIREMENTS[row.level]!);
    }
  });

  it("converges under concurrent applies without double counting", async () => {
    const p = await player("conc");
    const m = await seedMatch();
    await stageCardXp(m, [{ playerId: p.id, cardId: "chaos_archer", deployments: 4, xp: 4 }], "done");
    const results = await Promise.all(Array.from({ length: 5 }, () => applyCardXp(m)));
    expect(results.filter((r) => r.applied).length).toBeLessThanOrEqual(1);
    const me = await getMyCardXp(p.id);
    expect(me.cards.find((c) => c.cardId === "chaos_archer")).toMatchObject({ xp: 4, level: 1 });
    const again = await applyCardXp(m);
    expect(again).toMatchObject({ applied: false });
  });

  it("reconciles interrupted runs by recomputing from the ledger", async () => {
    const p = await player("rec");
    const m = await seedMatch();
    await stageCardXp(m, [{ playerId: p.id, cardId: "chaos_bolt", deployments: 5, xp: 5 }], "done");
    await applyCardXp(m);
    // Simulate a lost progress write with the ledger intact and the run open.
    const db = getDb();
    await db.delete(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    await db.update(cardXpRuns).set({ applied: false }).where(eq(cardXpRuns.matchId, m));
    const rec = await reconcileCardXp(50, async (id) => {
      const r = await applyCardXp(id);
      return { status: r.applied ? "awarded" : "already-awarded" };
    });
    expect(rec.processed).toBeGreaterThanOrEqual(1);
    const me = await getMyCardXp(p.id);
    expect(me.cards.find((c) => c.cardId === "chaos_bolt")).toMatchObject({ xp: 5, level: 2 });
    const rows = await db.select().from(cardXpAwards).where(eq(cardXpAwards.matchId, m));
    expect(rows).toHaveLength(1);
  });

  it("finds unmarked settled matches for a full award pass", async () => {
    const m = await seedMatch();
    const rec = await reconcileCardXp(50, async (id) => (id === m ? { status: "awarded" } : { status: "skipped" }));
    expect(rec.processed).toBeGreaterThanOrEqual(1);
    expect(rec.awarded).toBeGreaterThanOrEqual(1);
  });
});
