// V2.1g Unranked AI fallback Gold: policy, gates, idempotency, daily cap,
// balance/spend integration, flag-OFF safety. TEST branch only: no PROD
// writes, no PROD data, no migrations beyond the TEST-applied 0023.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { botGoldAwards, botMatches, cardXpProgress, goldSpendLedger, players } from "@/db/schema";
import type { Player } from "@/db/schema";
import { BattleSession, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, testLockedPatron } from "@/server/battle/test-helpers";
import { smartMove } from "@/lib/smart-bot";
import { mediumPolicy, practiceBotOrdinaryCards, type PracticePolicy } from "@/server/battle/practice";
import { getGoldBalance, getGoldTotals, upgradeCard } from "@/db/gold";
import {
  BOT_GOLD_DAILY_CAP,
  BOT_GOLD_MIN_HUMAN_DEPLOYS,
  BOT_GOLD_MIN_TICKS,
  BOT_GOLD_POLICY_VERSION,
  botGoldForResult,
  botGoldGate,
} from "@/lib/bot-gold";
import {
  countBotGoldToday,
  getBotMatchEvidence,
  recordBotMatchEvidence,
  type BotMatchEvidence,
} from "@/db/bot-gold";
import { BotGoldService } from "@/server/battle/bot-gold";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const createdMatchIds: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (createdMatchIds.length > 0) {
    await db.delete(botGoldAwards).where(inArray(botGoldAwards.matchId, createdMatchIds));
    await db.delete(botMatches).where(inArray(botMatches.matchId, createdMatchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:botgold_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

function trackMatch(id: string): string {
  createdMatchIds.push(id);
  return id;
}

const HUMAN_DECK = ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"];

function loadouts(cls: "scout" | "bulwark" = "scout"): { h: TrustedLoadout; b: TrustedLoadout } {
  return {
    h: { cards: [...HUMAN_DECK], grant: freeGrant(cls) },
    b: { cards: [...practiceBotOrdinaryCards()], grant: freeGrant("bulwark") },
  };
}

/** Real authoritative game, human smartMove vs Medium bot. */
function playGame(policy: PracticePolicy, patronSeed: string, humanId: string, humanIdle = false, upto = 3100) {
  const botId = `bot:botgold-${policy.difficulty}-${patronSeed}`;
  const s = new BattleSession();
  s.join({ playerId: humanId, username: `Human-${humanId.slice(0, 6)}` });
  s.join({ playerId: botId, username: "AI Opponent" });
  const { h, b } = loadouts();
  s.setReady(humanId, h);
  s.setReady(botId, b);
  const epoch = s.lock();
  const ready = s.readyLoadouts() as [TrustedLoadout, TrustedLoadout];
  s.cardLevelsByPlayer = {};
  s.mode = "practice";
  s.start(epoch, ready, testLockedPatron(patronSeed));
  const humanSeat = s.seatOfSlot[0]!;
  const botSeat = humanSeat === 0 ? 1 : 0;
  let cid = 0;
  let ticks = 0;
  while (s.phase === "active" && ticks < upto) {
    const state = s.state!;
    if (!humanIdle) {
      const hm = smartMove(state, humanSeat, state.tick);
      if (hm) {
        cid += 1;
        s.submit(humanId, { type: "deploy", cid: `h-${cid}`, cardId: hm.cardId, x: Math.round(hm.x), y: Math.round(hm.y) });
      }
    }
    const bm = policy.choose(state, botSeat, state.tick);
    if (bm) {
      cid += 1;
      s.submit(botId, { type: "deploy", cid: `b-${cid}`, cardId: bm.cardId, x: Math.round(bm.x), y: Math.round(bm.y) });
    }
    s.tick();
    ticks += 1;
  }
  return { s, humanSeat };
}

function evidenceFor(matchId: string, playerId: string, s: BattleSession, humanSeat: 0 | 1, difficulty: "medium" | "hard" = "medium"): BotMatchEvidence {
  const r = s.replay!;
  return {
    matchId,
    playerId,
    difficulty,
    source: "unranked-fallback",
    policyVersion: BOT_GOLD_POLICY_VERSION,
    config: r.config,
    commands: r.commands,
    humanSeat,
    liveHash: r.liveHash,
    replayHash: r.replayHash,
    replayIdentical: r.replayIdentical,
    winnerSeat: r.winner === "draw" ? null : r.winner,
    ticks: r.ticks,
    humanDeploys: 99,
    xpEligible: false,
    startedAt: new Date(Date.now() - r.ticks * 100).toISOString(),
  };
}

describe("V2.1g bot gold policy", () => {
  it("pays 20/10/15 under policy v1 with a 5-per-day cap", () => {
    expect(BOT_GOLD_POLICY_VERSION).toBe(1);
    expect(botGoldForResult("win")).toBe(20);
    expect(botGoldForResult("loss")).toBe(10);
    expect(botGoldForResult("draw")).toBe(15);
    expect(BOT_GOLD_DAILY_CAP).toBe(5);
    expect(BOT_GOLD_MIN_TICKS).toBe(600);
    expect(BOT_GOLD_MIN_HUMAN_DEPLOYS).toBe(3);
  });

  it("gates short matches and thin participation at the boundary", () => {
    expect(botGoldGate(599, 10)).toBe("short-match");
    expect(botGoldGate(600, 10)).toBe("eligible");
    expect(botGoldGate(3000, 2)).toBe("too-few-deploys");
    expect(botGoldGate(3000, 3)).toBe("eligible");
  });
});

describe("V2.1g bot gold awards", () => {
  it("confirms a real completed fallback match with the result-mapped amount", async () => {
    const p = await mkPlayer("happy");
    const { s, humanSeat } = playGame(mediumPolicy, "41", p.id);
    expect(s.phase).toBe("finished");
    expect(s.replay?.replayIdentical).toBe(true);
    const mid = trackMatch(randomUUID());
    const svc = new BotGoldService();
    const out = await svc.processEvidence(evidenceFor(mid, p.id, s, humanSeat));
    expect(out.status).toBe("confirmed");
    expect(out.source).toBe("unranked-fallback");
    expect(out.policyVersion).toBe(BOT_GOLD_POLICY_VERSION);
    const expectedResult = s.replay!.winner === "draw" ? "draw" : s.replay!.winner === humanSeat ? "win" : "loss";
    expect(out.amount).toBe(botGoldForResult(expectedResult));
    expect(out.rewardedToday).toBe(1);
    expect(out.dailyCap).toBe(BOT_GOLD_DAILY_CAP);
    const totals = await getGoldTotals(p.id);
    expect(totals.earned).toBe(out.amount);
    expect(totals.balance).toBe(out.amount);
  });

  it("refuses thin participation with zero writes", async () => {
    const p = await mkPlayer("thin");
    const { s, humanSeat } = playGame(mediumPolicy, "42", p.id, true);
    expect(s.phase).toBe("finished");
    const mid = trackMatch(randomUUID());
    const out = await new BotGoldService().processEvidence(evidenceFor(mid, p.id, s, humanSeat));
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("too-few-deploys");
    expect(out.amount).toBe(0);
    expect((await getDb().select().from(botGoldAwards).where(eq(botGoldAwards.matchId, mid)))).toEqual([]);
  });

  it("refuses tampered replays with zero writes", async () => {
    const p = await mkPlayer("tamper");
    const { s, humanSeat } = playGame(mediumPolicy, "43", p.id);
    const mid = trackMatch(randomUUID());
    const ev = evidenceFor(mid, p.id, s, humanSeat);
    const cmds = ev.commands as Array<Record<string, unknown>>;
    const deploy = cmds.find((c) => typeof c.cardId === "string" && !(c.cardId as string).startsWith("cmdr:"));
    expect(deploy).toBeDefined();
    deploy!.cardId = "boulderback";
    const out = await new BotGoldService().processEvidence(ev);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("replay-mismatch");
  });

  it("never pays solo Practice evidence", async () => {
    const p = await mkPlayer("solo");
    const { s, humanSeat } = playGame(mediumPolicy, "44", p.id);
    const mid = trackMatch(randomUUID());
    const db = getDb();
    await db.insert(botMatches).values({
      matchId: mid,
      playerId: p.id,
      difficulty: "medium",
      source: "practice",
      policyVersion: BOT_GOLD_POLICY_VERSION,
      config: s.replay!.config as never,
      commands: s.replay!.commands as never,
      humanSeat,
      liveHash: s.replay!.liveHash,
      replayHash: s.replay!.replayHash,
      replayIdentical: s.replay!.replayIdentical,
      winnerSeat: s.replay!.winner === "draw" ? null : s.replay!.winner,
      ticks: s.replay!.ticks,
      humanDeploys: 99,
      status: "pending",
    });
    const out = await new BotGoldService().processMatch(mid);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("practice-earns-zero");
    expect(out.amount).toBe(0);
  });

  it("earns exactly once across retries and restarts", async () => {
    const p = await mkPlayer("idem");
    const { s, humanSeat } = playGame(mediumPolicy, "45", p.id);
    const mid = trackMatch(randomUUID());
    const svc = new BotGoldService();
    const first = await svc.processEvidence(evidenceFor(mid, p.id, s, humanSeat));
    expect(first.status).toBe("confirmed");
    const second = await svc.processEvidence(evidenceFor(mid, p.id, s, humanSeat));
    expect(second.status).toBe("confirmed");
    expect(second.eligibility).toBe("duplicate");
    expect(second.amount).toBe(first.amount);
    // A fresh process reconciling the stored row also earns nothing new.
    const third = await new BotGoldService().reconcile(50);
    expect(third.awarded).toBe(0);
    const rows = await getDb().select().from(botGoldAwards).where(eq(botGoldAwards.matchId, mid));
    expect(rows).toHaveLength(1);
  });

  it("enforces the UTC daily cap, including under concurrency", async () => {
    const p = await mkPlayer("capper");
    const { s, humanSeat } = playGame(mediumPolicy, "46", p.id);
    const svc = new BotGoldService();
    const base = evidenceFor("unused", p.id, s, humanSeat);
    const ids = Array.from({ length: 6 }, () => trackMatch(randomUUID()));
    const results = await Promise.all(ids.map((id) => svc.processEvidence({ ...base, matchId: id })));
    const confirmed = results.filter((r) => r.status === "confirmed");
    const capped = results.filter((r) => r.status === "capped");
    expect(confirmed).toHaveLength(5);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.amount).toBe(0);
    expect(await countBotGoldToday(p.id)).toBe(5);
  });

  it("rolls the cap over at the UTC day boundary", async () => {
    const p = await mkPlayer("rollover");
    const { s, humanSeat } = playGame(mediumPolicy, "47", p.id);
    const svc = new BotGoldService();
    const base = evidenceFor("unused", p.id, s, humanSeat);
    for (let i = 0; i < 5; i++) {
      const r = await svc.processEvidence({ ...base, matchId: trackMatch(randomUUID()) });
      expect(r.status).toBe("confirmed");
    }
    // Backdate yesterday's awards out of today's UTC window.
    await getDb().execute(sql`update ${botGoldAwards} set awarded_at = (date_trunc('day', now() at time zone 'utc') - interval '1 day') where player_id = ${p.id}::uuid`);
    expect(await countBotGoldToday(p.id)).toBe(0);
    const fresh = await svc.processEvidence({ ...base, matchId: trackMatch(randomUUID()) });
    expect(fresh.status).toBe("confirmed");
    expect(fresh.rewardedToday).toBe(1);
  });

  it("reconciles stored evidence after a restart and marks failures", async () => {
    const p = await mkPlayer("recon");
    const { s, humanSeat } = playGame(mediumPolicy, "48", p.id);
    const mid = trackMatch(randomUUID());
    await recordBotMatchEvidence(evidenceFor(mid, p.id, s, humanSeat));
    // A new service instance (as after a restart) picks the pending row up.
    const r = await new BotGoldService().reconcile(50);
    expect(r.processed).toBeGreaterThanOrEqual(1);
    expect(r.awarded).toBeGreaterThanOrEqual(1);
    expect((await getBotMatchEvidence(mid))?.status).toBe("awarded");
    // Tampered evidence reconciles to refused with no award.
    const bad = trackMatch(randomUUID());
    const ev = evidenceFor(bad, p.id, s, humanSeat);
    (ev.commands as Array<Record<string, unknown>>)[0] = { seq: 999999, player: 0, tick: 1, cardId: "choglings", x: 50, y: 20 };
    await recordBotMatchEvidence(ev);
    const r2 = await new BotGoldService().reconcile(50);
    expect((await getBotMatchEvidence(bad))?.status).toBe("refused");
    expect(await getDb().select().from(botGoldAwards).where(eq(botGoldAwards.matchId, bad))).toEqual([]);
    void r2;
  });

  it("counts bot Gold in balances, history and real card upgrades", async () => {
    const p = await mkPlayer("spender");
    const { s, humanSeat } = playGame(mediumPolicy, "49", p.id);
    const svc = new BotGoldService();
    const base = evidenceFor("unused", p.id, s, humanSeat);
    const db = getDb();
    // Two UTC days of capped fallback earnings fund L2 deterministically.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 5; i++) {
        const r = await svc.processEvidence({ ...base, matchId: trackMatch(randomUUID()) });
        expect(r.status).toBe("confirmed");
      }
      await db.execute(sql`update ${botGoldAwards} set awarded_at = (date_trunc('day', now() at time zone 'utc') - interval '1 day') where player_id = ${p.id}::uuid`);
    }
    const totals = await getGoldTotals(p.id);
    expect(totals.earned).toBeGreaterThanOrEqual(100);
    const bal = await getGoldBalance(p.id);
    expect(bal.earned).toBe(totals.earned);
    expect(bal.recentEarn.some((e) => e.matchType === "unranked-fallback")).toBe(true);
    // Spend the bot Gold on a real upgrade: the atomic spend path counts it.
    await db.insert(cardXpProgress).values({ playerId: p.id, cardId: "choglings", xp: 200, level: 2, purchasedLevel: 1 }).onConflictDoNothing();
    const up = await upgradeCard(p.id, { cardId: "choglings", expectedLevel: 1, idempotencyKey: randomUUID() });
    expect(up.status).toBe("upgraded");
    expect((await getGoldTotals(p.id)).spent).toBe(100);
  });

  it("writes no bot participants and ignores bot games in the PvP gate", async () => {
    const p = await mkPlayer("clean");
    const { s, humanSeat } = playGame(mediumPolicy, "50", p.id);
    const mid = trackMatch(randomUUID());
    await new BotGoldService().processEvidence(evidenceFor(mid, p.id, s, humanSeat));
    const db = getDb();
    const { matchParticipants, matches } = await import("@/db/schema");
    expect(await db.select().from(matchParticipants).where(eq(matchParticipants.playerId, p.id))).toEqual([]);
    expect(await db.select().from(matches).where(eq(matches.id, mid as never))).toEqual([]);
    const { getGoldAwardableMatch } = await import("@/db/gold");
    expect(await getGoldAwardableMatch(mid)).toEqual({ ok: false, reason: "unknown-match" });
  });
});
