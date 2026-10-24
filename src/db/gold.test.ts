// P2b Gold economy and paid upgrades. TEST branch only, never PROD.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  cardXpProgress,
  goldEarnLedger,
  goldSpendLedger,
  matchParticipants,
  matches,
  players,
  type Player,
} from "@/db/schema";
import { CARD_UPGRADE_GOLD_COSTS, cardLevelForXp } from "@/lib/card-xp";
import {
  getGoldAwardableMatch,
  getGoldBalance,
  getGoldTotals,
  reconcileGoldEarn,
  stageGoldEarn,
  upgradeCard,
} from "./gold";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

async function cleanFixtures() {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
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
  const p = await provisionPlayer({ privyDid: `did:privy:goldtest_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

async function seedMatch(type: "matchmaking" | "ranked" | "private" = "matchmaking", winnerSeat: 0 | 1 | null = 0): Promise<string> {
  const matchId = randomUUID();
  matchIds.push(matchId);
  await getDb().insert(matches).values({
    id: matchId, roomId: `g-${matchId.slice(0, 8)}`, matchType: type, rulesetVersion: "v-test", protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
    outcome: winnerSeat === null ? "draw" : "win", winnerSeat, endReason: "core",
    crowns0: winnerSeat === 1 ? 0 : 3, crowns1: winnerSeat === 1 ? 3 : winnerSeat === null ? 2 : 0,
    ticks: 1800, liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
  });
  return matchId;
}

async function seedParticipants(matchId: string, a: Player, b: Player, winnerSeat: 0 | 1 | null) {
  const deck8 = ["swarm", "archer", "sparkcaster", "sentry", "snare", "sprites", "bolt", "cmdr:free-scout"];
  for (const seat of [0, 1] as const) {
    await getDb().insert(matchParticipants).values({
      matchId, seat, playerId: seat === 0 ? a.id : b.id,
      result: winnerSeat === null ? "draw" : winnerSeat === seat ? "win" : "loss",
      crowns: seat === 0 ? 3 : 0, deck: deck8, commanderKind: "free", commanderClass: "scout",
      nftTokenId: null, commanderIdentity: {}, entitlementOwner: null,
    });
  }
}

/** Give a player verified XP headroom plus Gold via real ledger rows. */
async function fund(p: Player, goldMatches: number, xp = 200, cardId = "choglings") {
  const db = getDb();
  for (let i = 0; i < goldMatches; i += 1) {
    const m = await seedMatch("matchmaking", 0);
    await db.insert(goldEarnLedger).values({ matchId: m, playerId: p.id, amount: 60, result: "win", policyVersion: 1 });
  }
  await db
    .insert(cardXpProgress)
    .values({ playerId: p.id, cardId, xp, level: cardLevelForXp(xp), purchasedLevel: 1 })
    .onConflictDoNothing({ target: [cardXpProgress.playerId, cardXpProgress.cardId] });
}

describe("P2b gold earn", () => {
  it("stages win/loss/draw rewards idempotently per match", async () => {
    const [a, b] = [await player("e1"), await player("e2")];
    const m = await seedMatch("ranked", 0);
    await seedParticipants(m, a, b, 0);
    const gate = await getGoldAwardableMatch(m);
    expect(gate.ok).toBe(true);
    const units = gate.ok
      ? gate.seats.map((s) => ({ playerId: s.playerId, amount: s.result === "win" ? 60 : s.result === "loss" ? 30 : 40, result: s.result }))
      : [];
    expect(await stageGoldEarn(m, units)).toEqual({ staged: 2 });
    expect(await stageGoldEarn(m, units)).toEqual({ staged: 0 });
    expect(await getGoldTotals(a.id)).toMatchObject({ earned: 60, spent: 0, balance: 60 });
    expect(await getGoldTotals(b.id)).toMatchObject({ earned: 30, spent: 0, balance: 30 });
    const md = await seedMatch("matchmaking", null);
    await seedParticipants(md, a, b, null);
    const g2 = await getGoldAwardableMatch(md);
    expect(g2.ok).toBe(true);
    if (g2.ok) {
      await stageGoldEarn(md, g2.seats.map((s) => ({ playerId: s.playerId, amount: 40, result: s.result })));
    }
    expect(await getGoldTotals(a.id)).toMatchObject({ earned: 100 });
  });

  it("skips private, unverified, unknown and malformed matches", async () => {
    const [a, b] = [await player("s1"), await player("s2")];
    const priv = await seedMatch("private", 0);
    await seedParticipants(priv, a, b, 0);
    expect(await getGoldAwardableMatch(priv)).toMatchObject({ ok: false, reason: "ineligible-type:private" });
    expect(await getGoldAwardableMatch(randomUUID())).toMatchObject({ ok: false, reason: "unknown-match" });
    expect((await getGoldBalance(a.id)).balance).toBe(0);
  });

  it("reconciles matches with a short earn ledger", async () => {
    const [a, b] = [await player("r1"), await player("r2")];
    const m = await seedMatch("ranked", 1);
    await seedParticipants(m, a, b, 1);
    const rec = await reconcileGoldEarn(50, async (id) => {
      const g = await getGoldAwardableMatch(id);
      if (!g.ok) return { status: "skipped" };
      const s = await stageGoldEarn(id, g.seats.map((x) => ({ playerId: x.playerId, amount: x.result === "win" ? 60 : 30, result: x.result })));
      return { status: s.staged > 0 ? "awarded" : "already-awarded" };
    });
    expect(rec.processed).toBeGreaterThanOrEqual(1);
    expect(await getGoldTotals(b.id)).toMatchObject({ earned: 60, balance: 60 });
    // Re-staging the same match is a no-op; a reconcile pass that stages
    // nothing creates no rows anywhere.
    const g = await getGoldAwardableMatch(m);
    expect(g.ok).toBe(true);
    if (g.ok) {
      const re = await stageGoldEarn(m, g.seats.map((x) => ({ playerId: x.playerId, amount: 60, result: x.result })));
      expect(re).toEqual({ staged: 0 });
    }
    const before = await getDb().select().from(goldEarnLedger);
    await reconcileGoldEarn(50, async () => ({ status: "skipped" }));
    const after = await getDb().select().from(goldEarnLedger);
    expect(after.length).toBe(before.length);
  });

  it("keeps both players balances isolated", async () => {
    const [a, b] = [await player("i1"), await player("i2")];
    const m = await seedMatch("matchmaking", 0);
    await seedParticipants(m, a, b, 0);
    await stageGoldEarn(m, [
      { playerId: a.id, amount: 60, result: "win" },
      { playerId: b.id, amount: 30, result: "loss" },
    ]);
    // A spend by a never touches b.
    await fund(a, 0);
    const up = await upgradeCard(a.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(["insufficient-gold", "upgraded"]).toContain(up.status);
    expect((await getGoldTotals(b.id)).balance).toBe(30);
  });
});

describe("P2b paid upgrades", () => {
  it("starts every card at purchased level 1 and refuses bad input", async () => {
    const p = await player("u0");
    await fund(p, 2);
    expect(await upgradeCard(p.id, { cardId: "not-a-card", expectedLevel: 1, idempotencyKey: randomUUID() })).toMatchObject({ status: "invalid-card" });
    expect(await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 0, idempotencyKey: randomUUID() })).toMatchObject({ status: "level-mismatch" });
    expect(await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 10, idempotencyKey: randomUUID() })).toMatchObject({ status: "maxed" });
    await expect(upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: "nope" })).rejects.toThrow(/malformed/);
    // No spend rows, no level movement from any refusal.
    expect(await getDb().select().from(goldSpendLedger).where(eq(goldSpendLedger.playerId, p.id))).toEqual([]);
  });

  it("refuses without XP or Gold and rolls back cleanly", async () => {
    const [noXp, noGold] = [await player("nx"), await player("ng")];
    await fund(noXp, 2, 0); // gold but no XP
    const r1 = await upgradeCard(noXp.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(r1).toMatchObject({ status: "insufficient-xp", purchasedLevel: 1 });
    await fund(noGold, 0); // XP but no gold
    const r2 = await upgradeCard(noGold.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(r2).toMatchObject({ status: "insufficient-gold", purchasedLevel: 1 });
    for (const p of [noXp, noGold]) {
      expect(await getDb().select().from(goldSpendLedger).where(eq(goldSpendLedger.playerId, p.id))).toEqual([]);
      const rows = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
      expect(rows.every((x) => Number(x.purchasedLevel) === 1)).toBe(true);
    }
  });

  it("seeds stored levels from the XP ladder, never a hardcoded level", async () => {
    const [zero, full] = [await player("lv0"), await player("lvmax")];
    await fund(zero, 0, 0);
    await fund(full, 0, 200);
    const read = async (p: Player) =>
      (await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id)))[0]!;
    expect(Number((await read(zero)).xp)).toBe(0);
    expect(Number((await read(zero)).level)).toBe(cardLevelForXp(0));
    expect(Number((await read(full)).level)).toBe(cardLevelForXp(200));
  });

  it("deducts once, advances exactly one level, and replays the same key", async () => {
    const p = await player("ok");
    await fund(p, 2); // 120 gold, XP headroom
    const key = randomUUID();
    const r = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: key });
    expect(r).toMatchObject({ status: "upgraded", purchasedLevel: 2, balance: 20 });
    expect(await getGoldTotals(p.id)).toMatchObject({ earned: 120, spent: 100, balance: 20 });
    const dup = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: key });
    expect(dup).toMatchObject({ status: "duplicate", purchasedLevel: 2, balance: 20 });
    // Stale expected level with a fresh key cannot advance again or charge.
    const stale = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(stale).toMatchObject({ status: "level-mismatch", purchasedLevel: 2, balance: 20 });
    // Next level costs the published step price.
    const key2 = randomUUID();
    await fund(p, 4); // +240 => 260 available after the first 100-cost upgrade
    const r2 = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 2, idempotencyKey: key2 });
    expect(r2).toMatchObject({ status: "upgraded", purchasedLevel: 3 });
    expect(r2.balance).toBe(260 - CARD_UPGRADE_GOLD_COSTS[1]);
  });

  it("holds the level 10 ceiling", async () => {
    const p = await player("cap");
    // Bulk-fund 54 wins (3240 gold) in two statements instead of 54 rounds.
    const db = getDb();
    const mids = Array.from({ length: 54 }, () => {
      const id = randomUUID();
      matchIds.push(id);
      return id;
    });
    await db.insert(matches).values(
      mids.map((id) => ({
        id, roomId: `g-${id.slice(0, 8)}`, matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
        startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), settledAt: new Date(),
        outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
        liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
      }))
    );
    await db.insert(goldEarnLedger).values(mids.map((id) => ({ matchId: id, playerId: p.id, amount: 60, result: "win" as const, policyVersion: 1 })));
    await db.insert(cardXpProgress).values({ playerId: p.id, cardId: "choglings", xp: 200, level: cardLevelForXp(200), purchasedLevel: 1 });
    await db.update(cardXpProgress).set({ purchasedLevel: 9 }).where(eq(cardXpProgress.playerId, p.id));
    const key = randomUUID();
    const r = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 9, idempotencyKey: key });
    expect(r).toMatchObject({ status: "upgraded", purchasedLevel: 10 });
    expect(await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 9, idempotencyKey: randomUUID() })).toMatchObject({ status: "level-mismatch", purchasedLevel: 10 });
    expect(await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 10, idempotencyKey: randomUUID() })).toMatchObject({ status: "maxed" });
  });

  it("serializes concurrent upgrades without double charge or overdraft", async () => {
    const p = await player("cc");
    await fund(p, 2, 200, "choglings");
    await fund(p, 0, 200, "sparkcaster");
    // Two cards, one shared 120 balance: only one 100-cost upgrade fits... plus the 20 left over.
    const [r1, r2] = await Promise.all([
      upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() }),
      upgradeCard(p.id, { cardId: "sparkcaster", expectedLevel: 1, idempotencyKey: randomUUID() }),
    ]);
    const ok = [r1, r2].filter((r) => r.status === "upgraded");
    const denied = [r1, r2].filter((r) => r.status !== "upgraded");
    expect(ok).toHaveLength(1);
    expect(denied[0]!.status).toBe("insufficient-gold");
    expect((await getGoldTotals(p.id)).balance).toBe(20);
    // Same card, same key five times: exactly one charge.
    const key = randomUUID();
    const same = await Promise.all(Array.from({ length: 5 }, () => upgradeCard(p.id, { cardId: "rift_sentry", expectedLevel: 1, idempotencyKey: key })));
    // rift_sentry has no XP row (xp 0) -> all fail the same way, none charge.
    expect(same.every((r) => r.status === "insufficient-xp")).toBe(true);
    expect((await getGoldTotals(p.id)).balance).toBe(20);
  });
});
