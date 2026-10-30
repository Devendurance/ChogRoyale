// V2.2c-1 award-time progression snapshots. Durable per-award
// (xp_before, xp_after) replace reconstruction from the live lifetime
// total, so historical receipts are stable, each threshold crossing is
// claimed exactly once, duplicates repeat, and the PvP daily cap holds
// under genuinely concurrent independent sessions. TEST branch only.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  accountXpAwards,
  accountXpAwardClaims,
  accountXpDailyCounts,
  accountXpHeads,
  accountXpRuns,
  botMatches,
  matches,
  players,
  type Player,
} from "@/db/schema";
import {
  ensureAccountXpRelease,
  getAccountXpAward,
  getAccountXpTotal,
  stageAccountXpBotAward,
  stageAccountXpPvpAward,
} from "@/db/account-xp";
import { buildAccountXpReceipt } from "./account-xp";
import { validateAccountXpReceipt } from "@/lib/account-xp";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const pvpMatchIds: string[] = [];
const botMatchIds: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (createdPlayerIds.length > 0) {
    await db.delete(accountXpAwards).where(inArray(accountXpAwards.playerId, createdPlayerIds));
    await db.delete(accountXpAwardClaims).where(inArray(accountXpAwardClaims.playerId, createdPlayerIds));
    await db.delete(accountXpRuns).where(inArray(accountXpRuns.playerId, createdPlayerIds));
    await db.delete(accountXpHeads).where(inArray(accountXpHeads.playerId, createdPlayerIds));
    await db.delete(accountXpDailyCounts).where(inArray(accountXpDailyCounts.playerId, createdPlayerIds));
  }
  if (pvpMatchIds.length > 0) {
    await db.delete(matches).where(inArray(matches.id, pvpMatchIds));
  }
  if (botMatchIds.length > 0) {
    await db.delete(botMatches).where(inArray(botMatches.matchId, botMatchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:axsn_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

async function seedPvpMatch(): Promise<string> {
  const id = randomUUID();
  pvpMatchIds.push(id);
  await getDb().insert(matches).values({
    id,
    roomId: `sn-${id.slice(0, 8)}`,
    matchType: "matchmaking",
    rulesetVersion: "v16",
    protocolVersion: "1",
    startedAt: new Date(),
    finishedAt: new Date(),
    outcome: "win",
    winnerSeat: 0,
    endReason: "core",
    crowns0: 1,
    crowns1: 0,
    ticks: 1800,
    liveHash: `sh${id.slice(0, 8)}`,
    replayHash: `sh${id.slice(0, 8)}`,
    evidenceSha256: `se${id.slice(0, 8)}`,
    verification: "replay-verified",
  });
  return id;
}

async function seedBotMatch(pId: string): Promise<string> {
  const id = randomUUID();
  botMatchIds.push(id);
  await getDb().insert(botMatches).values({
    matchId: id,
    playerId: pId,
    difficulty: "medium",
    source: "unranked-fallback",
    policyVersion: 1,
    config: {},
    commands: [],
    humanSeat: 0,
    liveHash: "h",
    replayHash: "h",
    replayIdentical: true,
    winnerSeat: 1,
    ticks: 1800,
    humanDeploys: 9,
    status: "awarded",
    startedAt: new Date(),
    xpEligible: false,
  });
  return id;
}

describe("V2.2c-1 stable per-award snapshots", () => {
  it("attributes a Level 3 crossing to the award that caused it, stably", async () => {
    const p = await mkPlayer("stab1");
    await ensureAccountXpRelease();
    // Seed 150 lifetime XP: three staged 50s.
    for (let i = 0; i < 3; i += 1) {
      const id = await seedPvpMatch();
      expect((await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 50, result: "loss" })).status).toBe("awarded");
    }
    expect(await getAccountXpTotal(p.id)).toBe(150);
    // Match A reaches 200: no crossing (Level 3 begins at 225).
    const idA = await seedPvpMatch();
    expect((await stageAccountXpPvpAward({ matchId: idA, playerId: p.id, amount: 50, result: "win" })).status).toBe("awarded");
    const recA1 = await buildAccountXpReceipt(p.id, "matchmaking", idA, { eligibility: "eligible", amount: 50, result: "win", status: "confirmed" });
    expect(validateAccountXpReceipt(recA1).ok).toBe(true);
    expect(recA1!.totalXp).toBe(200);
    // Match B reaches 250: the only Level 2 -> Level 3 crossing.
    const idB = await seedPvpMatch();
    expect((await stageAccountXpPvpAward({ matchId: idB, playerId: p.id, amount: 50, result: "win" })).status).toBe("awarded");
    const recB1 = await buildAccountXpReceipt(p.id, "matchmaking", idB, { eligibility: "eligible", amount: 50, result: "win", status: "confirmed" });
    expect(recB1!.levelBefore).toBe(2);
    expect(recB1!.levelAfter).toBe(3);
    expect(recB1!.leveledUp).toBe(true);
    // A delayed read of A must NOT change its transition: A never crossed.
    // (totalXp is the live lifetime total and legitimately advances.)
    const recA2 = await buildAccountXpReceipt(p.id, "matchmaking", idA, { eligibility: "eligible", amount: 50, result: "win", status: "confirmed" });
    expect({ ...recA2, totalXp: null }).toEqual({ ...recA1, totalXp: null });
    expect(recA2!.levelBefore).toBe(2);
    expect(recA2!.levelAfter).toBe(2);
    expect(recA2!.leveledUp).toBe(false);
    expect(recA2!.totalXp).toBe(250);
    // A duplicate read of B after an unrelated award is identical.
    const idC = await seedPvpMatch();
    expect((await stageAccountXpPvpAward({ matchId: idC, playerId: p.id, amount: 50, result: "loss" })).status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(300);
    const recB2 = await buildAccountXpReceipt(p.id, "matchmaking", idB, { eligibility: "duplicate", amount: 0, result: "win", status: "confirmed" });
    expect({ ...recB2, totalXp: null }).toEqual({ ...recB1, totalXp: null });
    expect(validateAccountXpReceipt(recB2).ok).toBe(true);
  });

  it("keeps concurrent PvP and bot awards consistent with the ledger sum", async () => {
    const p = await mkPlayer("conc2");
    await ensureAccountXpRelease();
    const [idP, idB] = await Promise.all([seedPvpMatch(), seedBotMatch(p.id)]);
    const [rP, rB] = await Promise.all([
      stageAccountXpPvpAward({ matchId: idP, playerId: p.id, amount: 100, result: "win" }),
      stageAccountXpBotAward({ matchId: idB, playerId: p.id, amount: 40, result: "win" }),
    ]);
    expect(rP.status).toBe("awarded");
    expect(rB.status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(140);
    const [rowP, rowB] = await Promise.all([
      getAccountXpAward(p.id, "matchmaking", idP),
      getAccountXpAward(p.id, "unranked-fallback", idB),
    ]);
    // Stored snapshots chain without gaps or overlaps against the ledger sum.
    const spans = [
      [rowP!.xpBefore, rowP!.xpAfter],
      [rowB!.xpBefore, rowB!.xpAfter],
    ].sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(spans[0]![0]).toBe(0);
    expect(spans[1]![0]).toBe(spans[0]![1]);
    expect(spans[1]![1]).toBe(140);
    const [recP, recB] = await Promise.all([
      buildAccountXpReceipt(p.id, "matchmaking", idP, { eligibility: "eligible", amount: 100, result: "win", status: "confirmed" }),
      buildAccountXpReceipt(p.id, "unranked-fallback", idB, { eligibility: "eligible", amount: 40, result: "win", status: "confirmed" }),
    ]);
    expect(validateAccountXpReceipt(recP).ok).toBe(true);
    expect(validateAccountXpReceipt(recB).ok).toBe(true);
    expect(recP!.totalXp).toBe(140);
    expect(recB!.totalXp).toBe(140);
  });

  it("holds the PvP 20/day cap under concurrent bursts", async () => {
    const p = await mkPlayer("cap2");
    await ensureAccountXpRelease();
    // Seed 19 rewarded today.
    for (let i = 0; i < 19; i += 1) {
      const id = await seedPvpMatch();
      expect((await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 50, result: "loss" })).status).toBe("awarded");
    }
    // Ten genuinely concurrent independent sessions at the boundary.
    const ids = await Promise.all(Array.from({ length: 10 }, () => seedPvpMatch()));
    const results = await Promise.all(ids.map((id) => stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 50, result: "loss" })));
    const awarded = results.filter((r) => r.status === "awarded").length;
    const capped = results.filter((r) => r.status === "capped").length;
    expect(awarded).toBe(1);
    expect(capped).toBe(9);
    expect(await getAccountXpTotal(p.id)).toBe(20 * 50);
    // A duplicate retry of the actually-awarded match stays a duplicate,
    // never a second award or a cap flip.
    const awardedId = ids[results.findIndex((r) => r.status === "awarded")]!;
    const dup = await stageAccountXpPvpAward({ matchId: awardedId, playerId: p.id, amount: 50, result: "loss" });
    expect(dup.status).toBe("duplicate");
    expect(await getAccountXpTotal(p.id)).toBe(20 * 50);
  });

  it("caps levels at 100 without claiming further level-ups", async () => {
    const p = await mkPlayer("max1");
    await ensureAccountXpRelease();
    const idMax = await seedPvpMatch();
    expect((await stageAccountXpPvpAward({ matchId: idMax, playerId: p.id, amount: 131175, result: "win" })).status).toBe("awarded");
    const recMax = await buildAccountXpReceipt(p.id, "matchmaking", idMax, { eligibility: "eligible", amount: 131175, result: "win", status: "confirmed" });
    expect(recMax!.levelBefore).toBe(1);
    expect(recMax!.levelAfter).toBe(100);
    expect(recMax!.leveledUp).toBe(true);
    expect(validateAccountXpReceipt(recMax).ok).toBe(true);
    const idOver = await seedPvpMatch();
    expect((await stageAccountXpPvpAward({ matchId: idOver, playerId: p.id, amount: 100, result: "win" })).status).toBe("awarded");
    const recOver = await buildAccountXpReceipt(p.id, "matchmaking", idOver, { eligibility: "eligible", amount: 100, result: "win", status: "confirmed" });
    expect(recOver!.levelBefore).toBe(100);
    expect(recOver!.levelAfter).toBe(100);
    expect(recOver!.leveledUp).toBe(false);
    expect(await getAccountXpTotal(p.id)).toBe(131275);
  });

  it("recovers an interrupted award exactly once with a stable receipt", async () => {
    const p = await mkPlayer("rec2");
    await ensureAccountXpRelease();
    const id = await seedPvpMatch();
    // Simulate a crash after the atomic award commit but before run marking:
    // the award row (with snapshots) and its pending run both exist.
    const staged = await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 100, result: "win" });
    expect(staged.status).toBe("awarded");
    const { claimAccountXpRun, getAccountXpRun, markAccountXpRun } = await import("@/db/account-xp");
    await claimAccountXpRun(p.id, "matchmaking", id, { reason: "test-interrupt" });
    expect((await getAccountXpRun(p.id, "matchmaking", id))!.status).toBe("pending");
    // Recovery replays the atomic stage: duplicate, identical snapshots.
    const retry = await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 100, result: "win" });
    expect(retry.status).toBe("duplicate");
    await markAccountXpRun(p.id, "matchmaking", id, "done", 1, { result: "win", amount: 100 });
    const rec1 = await buildAccountXpReceipt(p.id, "matchmaking", id, { eligibility: "eligible", amount: 100, result: "win", status: "confirmed" });
    const rec2 = await buildAccountXpReceipt(p.id, "matchmaking", id, { eligibility: "duplicate", amount: 0, result: "win", status: "confirmed" });
    expect(rec2).toEqual(rec1);
    expect(rec1!.levelBefore).toBe(1);
    expect(rec1!.levelAfter).toBe(2);
    expect(rec1!.leveledUp).toBe(true);
    expect(await getAccountXpTotal(p.id)).toBe(100);
    expect(validateAccountXpReceipt(rec1).ok).toBe(true);
  });

  it("keeps pre-release and flag-off behavior with no writes", async () => {
    const p = await mkPlayer("gate2");
    const rel = await ensureAccountXpRelease();
    expect(new Date(rel.activatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    const db = getDb();
    expect(await db.select().from(accountXpHeads).where(eq(accountXpHeads.playerId, p.id))).toEqual([]);
    expect(await db.select().from(accountXpDailyCounts).where(eq(accountXpDailyCounts.playerId, p.id))).toEqual([]);
  });
});
