// V2.2 FINAL PREFLIGHT: cold-start award serialization. Two independent
// awards for a fresh player (no heads row) race the initial heads INSERT;
// the loser must serialize on the winner's committed row, never strand an
// awardless claim, and never let a retry misclassify the outcome.
// A planted orphan claim (aborted-winner residue) must heal into exactly
// one award, never into a confirmed duplicate. TEST branch only.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
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
  const p = await provisionPlayer({ privyDid: `did:privy:axcs_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

async function seedPvpMatch(): Promise<string> {
  const id = randomUUID();
  pvpMatchIds.push(id);
  await getDb().insert(matches).values({
    id,
    roomId: `cs-${id.slice(0, 8)}`,
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
    liveHash: `ch${id.slice(0, 8)}`,
    replayHash: `ch${id.slice(0, 8)}`,
    evidenceSha256: `ce${id.slice(0, 8)}`,
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

/** Every claim must have exactly one matching award (no orphans). */
async function expectNoOrphanClaims(pId: string) {
  const db = getDb();
  const rows = await db.execute(sql`
    select c.match_id from account_xp_award_claims c
    left join account_xp_awards a
      on a.player_id = c.player_id and a.source = c.source and a.match_id = c.match_id
    where c.player_id = ${pId}::uuid and a.match_id is null
  `);
  expect(rows.rows).toEqual([]);
}

/** Heads total must equal the ledger sum exactly. */
async function expectHeadEqualsLedger(pId: string) {
  const db = getDb();
  const head = await db.select().from(accountXpHeads).where(eq(accountXpHeads.playerId, pId));
  const total = await getAccountXpTotal(pId);
  expect(head).toHaveLength(1);
  expect(Number(head[0]!.totalXp)).toBe(total);
}

describe("V2.2 FINAL cold-start serialization", () => {
  it("awards concurrent PvP vs PvP first awards exactly once with no orphans", async () => {
    const p = await mkPlayer("cc-pp");
    await ensureAccountXpRelease();
    const [idA, idB] = await Promise.all([seedPvpMatch(), seedPvpMatch()]);
    const [rA, rB] = await Promise.all([
      stageAccountXpPvpAward({ matchId: idA, playerId: p.id, amount: 100, result: "win" }),
      stageAccountXpPvpAward({ matchId: idB, playerId: p.id, amount: 50, result: "loss" }),
    ]);
    expect([rA.status, rB.status].sort()).toEqual(["awarded", "awarded"]);
    expect(await getAccountXpTotal(p.id)).toBe(150);
    await expectHeadEqualsLedger(p.id);
    await expectNoOrphanClaims(p.id);
    // Snapshots form one gapless chain from zero regardless of commit order.
    const [rowA, rowB] = await Promise.all([
      getAccountXpAward(p.id, "matchmaking", idA),
      getAccountXpAward(p.id, "matchmaking", idB),
    ]);
    const spans = [
      [rowA!.xpBefore, rowA!.xpAfter],
      [rowB!.xpBefore, rowB!.xpAfter],
    ].sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(spans[0]![0]).toBe(0);
    expect(spans[1]![0]).toBe(spans[0]![1]);
    expect(spans[1]![1]).toBe(150);
  });

  it("awards concurrent PvP vs AI first awards exactly once with no orphans", async () => {
    const p = await mkPlayer("cc-pb");
    await ensureAccountXpRelease();
    const [idP, idB] = await Promise.all([seedPvpMatch(), seedBotMatch(p.id)]);
    const [rP, rB] = await Promise.all([
      stageAccountXpPvpAward({ matchId: idP, playerId: p.id, amount: 100, result: "win" }),
      stageAccountXpBotAward({ matchId: idB, playerId: p.id, amount: 40, result: "win" }),
    ]);
    expect(rP.status).toBe("awarded");
    expect(rB.status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(140);
    await expectHeadEqualsLedger(p.id);
    await expectNoOrphanClaims(p.id);
  });

  it("survives repeated simultaneous first-award bursts without drift", async () => {
    for (let round = 0; round < 5; round += 1) {
      const p = await mkPlayer(`cc-burst-${round}`);
      await ensureAccountXpRelease();
      const ids = await Promise.all([seedPvpMatch(), seedPvpMatch(), seedBotMatch(p.id)]);
      const results = await Promise.all([
        stageAccountXpPvpAward({ matchId: ids[0]!, playerId: p.id, amount: 100, result: "win" }),
        stageAccountXpPvpAward({ matchId: ids[1]!, playerId: p.id, amount: 50, result: "loss" }),
        stageAccountXpBotAward({ matchId: ids[2]!, playerId: p.id, amount: 40, result: "win" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["awarded", "awarded", "awarded"]);
      expect(await getAccountXpTotal(p.id)).toBe(190);
      await expectHeadEqualsLedger(p.id);
      await expectNoOrphanClaims(p.id);
    }
  });

  it("heals a planted orphan claim into exactly one award, never a duplicate", async () => {
    const p = await mkPlayer("cc-orphan");
    await ensureAccountXpRelease();
    const id = await seedPvpMatch();
    // Simulate aborted-winner residue: a committed claim with no award.
    await getDb().insert(accountXpAwardClaims).values({ playerId: p.id, source: "matchmaking", matchId: id });
    const out = await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 100, result: "win" });
    // A missing award row must never be classified as a confirmed duplicate.
    expect(out.status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(100);
    await expectHeadEqualsLedger(p.id);
    await expectNoOrphanClaims(p.id);
    const row = await getAccountXpAward(p.id, "matchmaking", id);
    expect(row!.xpBefore).toBe(0);
    expect(row!.xpAfter).toBe(100);
    // A genuine retry afterwards is a duplicate with identical snapshots.
    const dup = await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 100, result: "win" });
    expect(dup.status).toBe("duplicate");
    expect(await getAccountXpTotal(p.id)).toBe(100);
  });

  it("an aborted statement poisons nothing and the retry awards exactly once", async () => {
    const p = await mkPlayer("cc-abort");
    await ensureAccountXpRelease();
    // Bogus FK target aborts the whole atomic statement (claim included).
    await expect(
      stageAccountXpPvpAward({ matchId: randomUUID(), playerId: p.id, amount: 100, result: "win" })
    ).rejects.toThrow();
    expect(await getAccountXpTotal(p.id)).toBe(0);
    await expectNoOrphanClaims(p.id);
    const id = await seedPvpMatch();
    const out = await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 100, result: "win" });
    expect(out.status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(100);
    await expectHeadEqualsLedger(p.id);
  });
});
