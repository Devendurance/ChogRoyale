// V2.1i/j release preflight: concurrent PvP and bot XP must converge.
// Ledgers are append-only, so totals only move forward. The shared recompute
// keeps a progress row only when the recomputed total is at or ahead of the
// stored total, so a stale snapshot cannot overwrite a fresher total. No
// locks are taken, so multi-card batches cannot deadlock. Uses isolated TEST
// fixtures and independent connections with deterministic barriers.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { routeDalToTestDb, getDb, createDb } from "@/db/client";
import { requireTestDatabaseUrl } from "@/db/test-db";
import { provisionPlayer } from "@/db/players";
import {
  cardXpAwards,
  cardXpProgress,
  cardXpRuns,
  matches,
  botMatches,
  botCardXpAwards,
  players,
} from "@/db/schema";
import { applyCardXpTotals, getMyCardXp, reconcileCardXp, stageCardXp } from "@/db/card-xp";
import { cardLevelForXp } from "@/lib/card-xp";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws as never;

beforeAll(() => { routeDalToTestDb(); });

const pids: string[] = [];
const mids: string[] = [];
const bmids: string[] = [];

async function clean() {
  const db = getDb();
  if (bmids.length) {
    await db.delete(botCardXpAwards).where(inArray(botCardXpAwards.matchId, bmids));
    await db.delete(botMatches).where(inArray(botMatches.matchId, bmids));
  }
  if (mids.length) {
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, mids));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, mids));
    await db.delete(matches).where(inArray(matches.id, mids));
  }
  if (pids.length) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, pids));
    await db.delete(players).where(inArray(players.id, pids));
  }
}

afterAll(async () => { await clean(); });

async function player(tag: string) {
  const p = await provisionPlayer({ privyDid: `did:privy:xpconc_${tag}_${randomUUID().slice(0, 8)}` });
  pids.push(p.id);
  return p;
}

async function seedMatch(): Promise<string> {
  const id = randomUUID(); mids.push(id);
  await getDb().insert(matches).values({
    id, roomId: `conc-${id.slice(0, 8)}`, matchType: "matchmaking", rulesetVersion: "v-test", protocolVersion: "b3.1",
    startedAt: new Date(), finishedAt: new Date(), settledAt: new Date(),
    outcome: "win", winnerSeat: 0, endReason: "core", crowns0: 3, crowns1: 0, ticks: 1800,
    liveHash: "h", replayHash: "h", evidenceSha256: "e", verification: "replay-verified",
  });
  return id;
}

async function seedBotMatch(playerId: string): Promise<string> {
  const id = `conc-bot-${randomUUID().slice(0, 8)}`; bmids.push(id);
  await getDb().insert(botMatches).values({
    matchId: id, playerId, difficulty: "medium", source: "unranked-fallback", policyVersion: 1,
    config: {}, commands: [], humanSeat: 0, liveHash: "h", replayHash: "h", replayIdentical: true,
    winnerSeat: 0, ticks: 1800, humanDeploys: 5, xpEligible: true, status: "awarded",
  } as never);
  return id;
}

async function sums(playerId: string, cardId: string): Promise<{ pvp: number; bot: number; total: number }> {
  const db = getDb();
  const r = await db.execute(sql`
    select coalesce((select sum(xp) from card_xp_awards where player_id = ${playerId}::uuid and card_id = ${cardId}), 0)::int as pvp,
           coalesce((select sum(xp) from bot_card_xp_awards where player_id = ${playerId}::uuid and card_id = ${cardId}), 0)::int as bot
  `);
  const row = (r.rows as Array<{ pvp: number; bot: number }>)[0]!;
  return { pvp: Number(row.pvp), bot: Number(row.bot), total: Number(row.pvp) + Number(row.bot) };
}

describe("V2.1i/j concurrent XP integrity", () => {
  it("PvP award vs bot award converge on the combined total", async () => {
    const p = await player("pvpbot");
    const card = "choglings";
    await getDb().insert(cardXpProgress).values({ playerId: p.id, cardId: card, xp: 0, level: 1, purchasedLevel: 3 });
    const m1 = await seedMatch();
    const b1 = await seedBotMatch(p.id);
    await getDb().insert(cardXpAwards).values({ matchId: m1, playerId: p.id, cardId: card, deployments: 5, xp: 5, policyVersion: 1 });
    await getDb().insert(botCardXpAwards).values({ matchId: b1, playerId: p.id, cardId: card, deployments: 2, xp: 2, policyVersion: 1 });

    // Genuinely overlapping recomputes through independent connections with a
    // deterministic barrier: both workers start together after ledgers commit.
    const url = requireTestDatabaseUrl();
    const dbA = createDb(url);
    const dbB = createDb(url);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const pair = [{ playerId: p.id, cardId: card }];
    const wA = (async () => { await gate; return applyCardXpTotals(pair, dbA); })();
    const wB = (async () => { await gate; return applyCardXpTotals(pair, dbB); })();
    release();
    const results = await Promise.all([wA, wB]);
    expect(results.length).toBe(2);

    const s = await sums(p.id, card);
    expect(s).toMatchObject({ pvp: 5, bot: 2, total: 7 });
    const prog = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    const row = prog.find((r) => r.cardId === card)!;
    expect(Number(row.xp)).toBe(7);
    expect(Number(row.level)).toBe(cardLevelForXp(7));
    expect(Number(row.purchasedLevel)).toBe(3);
    const me = await getMyCardXp(p.id);
    expect(me.cards.find((c) => c.cardId === card)).toMatchObject({ xp: 7, xpLevel: cardLevelForXp(7), level: 3 });
  }, 120_000);

  it("two bot awards converge without double counting", async () => {
    const p = await player("twobot");
    const card = "rift_runner";
    await getDb().insert(cardXpProgress).values({ playerId: p.id, cardId: card, xp: 0, level: 1, purchasedLevel: 2 });
    const b1 = await seedBotMatch(p.id);
    const b2 = await seedBotMatch(p.id);
    await getDb().insert(botCardXpAwards).values({ matchId: b1, playerId: p.id, cardId: card, deployments: 1, xp: 1, policyVersion: 1 });
    await getDb().insert(botCardXpAwards).values({ matchId: b2, playerId: p.id, cardId: card, deployments: 3, xp: 2, policyVersion: 1 });

    const url2 = requireTestDatabaseUrl();
    const dbA2 = createDb(url2);
    const dbB2 = createDb(url2);
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => { release2 = r; });
    const pair2 = [{ playerId: p.id, cardId: card }];
    const wA2 = (async () => { await gate2; return applyCardXpTotals(pair2, dbA2); })();
    const wB2 = (async () => { await gate2; return applyCardXpTotals(pair2, dbB2); })();
    release2();
    const results = await Promise.all([wA2, wB2]);
    expect(results.length).toBe(2);
    const s = await sums(p.id, card);
    expect(s).toMatchObject({ pvp: 0, bot: 3, total: 3 });
    const prog = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    expect(Number(prog.find((r) => r.cardId === card)!.xp)).toBe(3);
    expect(Number(prog.find((r) => r.cardId === card)!.purchasedLevel)).toBe(2);
  }, 120_000);

  it("duplicate retried award stays idempotent", async () => {
    const p = await player("dup");
    const card = "chaos_archer";
    const m1 = await seedMatch();
    await stageCardXp(m1, [{ playerId: p.id, cardId: card, deployments: 4, xp: 4 }], "done");
    // Duplicate stage is a no-op (same PK, DoNothing), concurrent applies see identical totals.
    await stageCardXp(m1, [{ playerId: p.id, cardId: card, deployments: 4, xp: 4 }], "done");
    const url3 = requireTestDatabaseUrl();
    const pair3 = [{ playerId: p.id, cardId: card }];
    let release3!: () => void;
    const gate3 = new Promise<void>((r) => { release3 = r; });
    const wA3 = (async () => { await gate3; return applyCardXpTotals(pair3, createDb(url3)); })();
    const wB3 = (async () => { await gate3; return applyCardXpTotals(pair3, createDb(url3)); })();
    release3();
    const results = await Promise.all([wA3, wB3]);
    expect(results.length).toBe(2);
    const s = await sums(p.id, card);
    expect(s.total).toBe(4);
    const prog = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    expect(Number(prog.find((r) => r.cardId === card)!.xp)).toBe(4);
  }, 120_000);

  it("interrupted award heals through reconcile with the same totals", async () => {
    const p = await player("rec");
    const card = "chaos_bolt";
    const m1 = await seedMatch();
    await stageCardXp(m1, [{ playerId: p.id, cardId: card, deployments: 5, xp: 5 }], "done");
    // Simulate lost progress write with ledger intact and run open.
    const db = getDb();
    await db.delete(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    await db.update(cardXpRuns).set({ applied: false }).where(eq(cardXpRuns.matchId, m1));
    const rec = await reconcileCardXp(50, async (id) => {
      const r = await applyCardXpTotals([{ playerId: p.id, cardId: card }]);
      // Mark the PvP run applied to mirror applyCardXp's marker step.
      await db.execute(sql`update card_xp_runs set applied = true where match_id = ${id}::uuid and applied = false`);
      return { status: r.units > 0 ? "awarded" : "already-awarded" };
    });
    expect(rec.processed).toBeGreaterThanOrEqual(1);
    const s = await sums(p.id, card);
    expect(s.total).toBe(5);
    const me = await getMyCardXp(p.id);
    expect(me.cards.find((c) => c.cardId === card)).toMatchObject({ xp: 5, xpLevel: cardLevelForXp(5) });
  }, 120_000);

  it("applyCardXpTotals never downgrades a fresher total", async () => {
    const p = await player("nodowngrade");
    const card = "choglings";
    const m1 = await seedMatch();
    const b1 = await seedBotMatch(p.id);
    await getDb().insert(cardXpAwards).values({ matchId: m1, playerId: p.id, cardId: card, deployments: 5, xp: 5, policyVersion: 1 });
    await getDb().insert(botCardXpAwards).values({ matchId: b1, playerId: p.id, cardId: card, deployments: 2, xp: 2, policyVersion: 1 });
    await applyCardXpTotals([{ playerId: p.id, cardId: card }]);
    let prog = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    expect(Number(prog.find((r) => r.cardId === card)!.xp)).toBe(7);
    // Simulate a stale recompute that only sees the PvP ledger (bot row not yet visible).
    await getDb().delete(botCardXpAwards).where(eq(botCardXpAwards.matchId, b1));
    await applyCardXpTotals([{ playerId: p.id, cardId: card }]);
    prog = await getDb().select().from(cardXpProgress).where(eq(cardXpProgress.playerId, p.id));
    expect(Number(prog.find((r) => r.cardId === card)!.xp)).toBe(7);
    expect(Number(prog.find((r) => r.cardId === card)!.level)).toBe(cardLevelForXp(7));
  }, 120_000);

  it("a stale snapshot cannot overwrite a fresher total on independent sessions", async () => {
    const p = await player("stale");
    const card = "sparkcaster";
    const m1 = await seedMatch();
    const b1 = await seedBotMatch(p.id);
    await getDb().insert(cardXpAwards).values({ matchId: m1, playerId: p.id, cardId: card, deployments: 5, xp: 5, policyVersion: 1 });
    await getDb().insert(cardXpProgress).values({ playerId: p.id, cardId: card, xp: 5, level: 2, purchasedLevel: 3 });

    const pool = new Pool({ connectionString: requireTestDatabaseUrl() });
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      // c1 simulates a recompute whose snapshot was taken before the bot row committed:
      // it read 5, then later tries to write hardcoded stale 5.
      await c1.query("BEGIN");
      const s1 = await c1.query("select coalesce((select sum(xp) from card_xp_awards where player_id=$1 and card_id=$2),0)::int + coalesce((select sum(xp) from bot_card_xp_awards where player_id=$1 and card_id=$2),0)::int as xp", [p.id, card]);
      expect(Number(s1.rows[0].xp)).toBe(5);
      // c2 (independent session) commits the bot row and the fresh total 7.
      await c2.query("insert into bot_card_xp_awards(match_id,player_id,card_id,deployments,xp,policy_version) values($1,$2::uuid,$3,2,2,1)", [b1, p.id, card]);
      await c2.query("insert into card_xp_progress(player_id,card_id,xp,level,updated_at) values($1::uuid,$2,7,2,now()) on conflict(player_id,card_id) do update set xp=excluded.xp, level=excluded.level, updated_at=now() where card_xp_progress.xp <= excluded.xp", [p.id, card]);
      // c1 now writes stale 5 with the same guarded pattern production uses: must be blocked.
      await c1.query("insert into card_xp_progress(player_id,card_id,xp,level,updated_at) values($1::uuid,$2,5,2,now()) on conflict(player_id,card_id) do update set xp=excluded.xp, level=excluded.level, updated_at=now() where card_xp_progress.xp <= excluded.xp", [p.id, card]);
      await c1.query("COMMIT");
      const cur = await c2.query("select xp, level, purchased_level from card_xp_progress where player_id=$1 and card_id=$2", [p.id, card]);
      expect(Number(cur.rows[0].xp)).toBe(7);
      expect(Number(cur.rows[0].level)).toBe(cardLevelForXp(7));
      expect(Number(cur.rows[0].purchased_level)).toBe(3);
      const s = await sums(p.id, card);
      expect(s.total).toBe(7);
    } finally {
      c1.release(); c2.release(); await pool.end();
    }
  }, 120_000);
});
