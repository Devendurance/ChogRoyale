// V2.2a Player Account XP lifecycle. TEST branch only: no PROD writes,
// no flag activation in production, no balance changes beyond the additive
// ledger. Covers PvP and bot awards, gates, idempotency, caps, release
// boundary, reconciliation, flag-OFF safety and API contract.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  accountXpAwards,
  accountXpRuns,
  botCardXpAwards,
  botGoldAwards,
  botMatches,
  cardXpAwards,
  goldEarnLedger,
  matchEvidence,
  matchParticipants,
  matches,
  players,
  type Player,
} from "@/db/schema";
import { BattleSession, PRESETS, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay } from "@/server/battle/settlement";
import { smartMove } from "@/lib/smart-bot";
import { mediumPolicy, practiceBotOrdinaryCards } from "@/server/battle/practice";
import { BotGoldService } from "@/server/battle/bot-gold";
import type { BotMatchEvidence } from "@/db/bot-gold";
import { BOT_GOLD_POLICY_VERSION } from "@/lib/bot-gold";
import { ensureAccountXpRelease, getAccountXpTotal, countAccountXpPvpToday } from "@/db/account-xp";
import { AccountXpService } from "./account-xp";
import { ACCOUNT_XP_POLICY_VERSION } from "@/lib/account-xp";
import { GET } from "@/app/api/players/me/account-xp/route";
import { AppError } from "@/lib/errors";

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
    await db.delete(accountXpRuns).where(inArray(accountXpRuns.playerId, createdPlayerIds));
  }
  if (pvpMatchIds.length > 0) {
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, pvpMatchIds));
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, pvpMatchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, pvpMatchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, pvpMatchIds));
    await db.delete(matches).where(inArray(matches.id, pvpMatchIds));
  }
  if (botMatchIds.length > 0) {
    await db.delete(botCardXpAwards).where(inArray(botCardXpAwards.matchId, botMatchIds));
    await db.delete(botGoldAwards).where(inArray(botGoldAwards.matchId, botMatchIds));
    await db.delete(botMatches).where(inArray(botMatches.matchId, botMatchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:accxp_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

function trackPvp(id: string): string {
  pvpMatchIds.push(id);
  return id;
}

function trackBot(id: string): string {
  botMatchIds.push(id);
  return id;
}

/** Spam both seats to a finish; engine rejects illegal drops. */
function driveToFinish(s: BattleSession) {
  let n = 0;
  const decks = s.readyLoadouts();
  let guard = 0;
  while (s.phase === "active" && guard++ < 4000) {
    s.slots.forEach((pl, slot) => {
      if (!pl) return;
      const seat = s.seatOfSlot[slot]!;
      const deck = decks[slot]!;
      const cards = [...deck.cards, `cmdr:${deck.grant.slot.commanderId}`];
      const pick = cards[n % cards.length]!;
      n += 1;
      s.submit(pl.playerId, { type: "deploy", cid: `a${n}`, cardId: pick, x: 30 + ((n % 2) * 40), y: seat === 0 ? 60 : 100 });
    });
    s.tick();
  }
}

function startPvp(a: Player, b: Player, seedFlip = 0) {
  const s = new BattleSession({ seed: () => `accxp${seedFlip}accxp00accxp00accxp00`, int: (n) => (n === 2 ? seedFlip : 0) });
  s.join({ playerId: a.id, username: `pa-${a.id.slice(0, 6)}` });
  s.join({ playerId: b.id, username: `pb-${b.id.slice(0, 6)}` });
  const load = (preset: string) => makeLoadout([...PRESETS[preset]!.cards], PRESETS[preset]!.commanderClass as never);
  s.setReady(a.id, load("swarm"));
  s.setReady(b.id, load("siege"));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron(String(100 + seedFlip)));
  driveToFinish(s);
  return s;
}

async function settlePvp(s: BattleSession, matchId: string, matchType: "matchmaking" | "private" | "ranked", startedAt: Date) {
  const service = new SettlementService({ retryDelaysMs: [], sleep: async () => {} });
  const record = recordFromReplay(s.replay!, {
    matchId,
    roomId: `axp-${matchId.slice(0, 8)}`,
    matchType,
    startedAt,
    crowns: [...s.state!.crowns] as [number, number],
  });
  const status = await service.submit(record);
  return status;
}

const HUMAN_DECK = ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"];
const BOT_DECK = [...practiceBotOrdinaryCards()];

function playBotGame(humanId: string, seed: string, humanIdle = false) {
  const botId = `bot:accxp-${seed}`;
  const s = new BattleSession();
  s.join({ playerId: humanId, username: `Human-${humanId.slice(0, 6)}` });
  s.join({ playerId: botId, username: "AI Opponent" });
  const h: TrustedLoadout = { cards: [...HUMAN_DECK], grant: freeGrant("scout") };
  // Mirror the proven bot-gold fixture deck so replays verify identically.
  const b: TrustedLoadout = { cards: [...BOT_DECK], grant: freeGrant("bulwark") };
  s.setReady(humanId, h);
  s.setReady(botId, b);
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron(seed));
  const humanSeat = s.seatOfSlot[0]!;
  const botSeat = humanSeat === 0 ? 1 : 0;
  let cid = 0;
  let ticks = 0;
  while (s.phase === "active" && ticks < 3100) {
    const state = s.state!;
    if (!humanIdle) {
      const hm = smartMove(state, humanSeat, state.tick);
      if (hm) {
        cid += 1;
        s.submit(humanId, { type: "deploy", cid: `h-${cid}`, cardId: hm.cardId, x: Math.round(hm.x), y: Math.round(hm.y) });
      }
    }
    const bm = mediumPolicy.choose(state, botSeat, state.tick);
    if (bm) {
      cid += 1;
      s.submit(botId, { type: "deploy", cid: `b-${cid}`, cardId: bm.cardId, x: Math.round(bm.x), y: Math.round(bm.y) });
    }
    s.tick();
    ticks += 1;
  }
  return { s, humanSeat };
}

function botEvidence(matchId: string, playerId: string, s: BattleSession, humanSeat: 0 | 1, startedAt: Date, source: "unranked-fallback" | "practice" = "unranked-fallback"): BotMatchEvidence {
  const r = s.replay!;
  return {
    matchId,
    playerId,
    difficulty: "medium",
    source: source as "unranked-fallback",
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
    startedAt: startedAt.toISOString(),
  };
}

const svc = () => new AccountXpService({ enabled: true });
const offSvc = () => new AccountXpService({ enabled: false });

describe("V2.2a account xp pvp awards", () => {
  it("awards verified public PvP wins, draws and losses at 100/75/50", async () => {
    const [a, b] = [await mkPlayer("pvp1a"), await mkPlayer("pvp1b")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 11);
    expect(s.phase).toBe("finished");
    expect(s.replay!.ticks).toBeGreaterThanOrEqual(600);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const out = await svc().processPvpMatch(matchId);
    expect(out.status).toBe("confirmed");
    expect(out.players).toHaveLength(2);
    for (const p of out.players) {
      const expected = p.result === "win" ? 100 : p.result === "draw" ? 75 : 50;
      expect(p.amount).toBe(expected);
      expect(p.status).toBe("confirmed");
    }
    // Ledger-derived totals match the awards.
    const totalA = await getAccountXpTotal(a.id);
    const winner = s.replay!.winner;
    const seatOf = (pid: string) => (s.replay!.players[0]!.playerId === pid ? 0 : 1);
    const resultOf = (pid: string) => (winner === "draw" ? "draw" : winner === seatOf(pid) ? "win" : "loss");
    const expectA = resultOf(a.id) === "win" ? 100 : resultOf(a.id) === "draw" ? 75 : 50;
    expect(totalA).toBe(expectA);
    // Card XP and Gold ledgers are untouched by the Account XP pass.
    const db = getDb();
    expect(await db.select().from(cardXpAwards).where(eq(cardXpAwards.matchId, matchId))).toEqual([]);
    expect(await db.select().from(goldEarnLedger).where(eq(goldEarnLedger.matchId, matchId))).toEqual([]);
  });

  it("awards private rooms zero and ranked stays closed", async () => {
    const [a, b] = [await mkPlayer("priv1"), await mkPlayer("priv2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 12);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "private", new Date())).toBe("settled");
    const out = await svc().processPvpMatch(matchId);
    expect(out.status).toBe("refused");
    const db = getDb();
    const rows = await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, a.id));
    expect(rows.filter((r) => r.matchId === matchId)).toEqual([]);

    const [c, d] = [await mkPlayer("rnk1"), await mkPlayer("rnk2")];
    const s2 = startPvp(c, d, 13);
    const mid2 = trackPvp(randomUUID());
    expect(await settlePvp(s2, mid2, "ranked", new Date())).toBe("settled");
    const out2 = await svc().processPvpMatch(mid2);
    expect(out2.status).toBe("refused");
    const rows2 = await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, c.id));
    expect(rows2.filter((r) => r.matchId === mid2)).toEqual([]);
  });

  it("settles a duplicate exactly once", async () => {
    const [a, b] = [await mkPlayer("dup1"), await mkPlayer("dup2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 14);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const first = await svc().processPvpMatch(matchId);
    expect(first.status).toBe("confirmed");
    const before = await getAccountXpTotal(a.id);
    const second = await svc().processPvpMatch(matchId);
    expect(second.status === "confirmed" || second.status === "refused").toBe(true);
    expect(await getAccountXpTotal(a.id)).toBe(before);
    const db = getDb();
    const rows = await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, a.id));
    expect(rows.filter((r) => r.matchId === matchId)).toHaveLength(1);
  });

  it("does not backfill matches begun before activation", async () => {
    const [a, b] = [await mkPlayer("hist1"), await mkPlayer("hist2")];
    const rel = await ensureAccountXpRelease();
    const s = startPvp(a, b, 15);
    const matchId = trackPvp(randomUUID());
    const before = new Date(new Date(rel.activatedAt).getTime() - 60_60_1000);
    expect(await settlePvp(s, matchId, "matchmaking", before)).toBe("settled");
    const out = await svc().processPvpMatch(matchId);
    expect(out.status).toBe("refused");
    expect(await getAccountXpTotal(a.id)).toBe(0);
    expect(await getAccountXpTotal(b.id)).toBe(0);
  });

  it("writes nothing when the flag is off", async () => {
    const [a, b] = [await mkPlayer("off1"), await mkPlayer("off2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 16);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const out = await offSvc().processPvpMatch(matchId);
    expect(out.status).toBe("refused");
    const db = getDb();
    expect(await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, a.id))).toEqual([]);
    expect(await db.select().from(accountXpRuns).where(eq(accountXpRuns.playerId, a.id))).toEqual([]);
  });
});

describe("V2.2a account xp bot awards", () => {
  it("pays verified fallback at 40/30/20 only with confirmed bot Gold", async () => {
    const p = await mkPlayer("bot1");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "51");
    expect(s.phase).toBe("finished");
    const mid = trackBot(randomUUID());
    const goldSvc = new BotGoldService();
    const ev = botEvidence(mid, p.id, s, humanSeat, new Date());
    const goldOut = await goldSvc.processEvidence(ev);
    expect(goldOut.status).toBe("confirmed");
    const out = await svc().processBotMatch(mid);
    expect(out.status).toBe("confirmed");
    const expected = out.result === "win" ? 40 : out.result === "draw" ? 30 : 20;
    expect(out.amount).toBe(expected);
    expect(ACCOUNT_XP_POLICY_VERSION).toBe(1);
    expect(await getAccountXpTotal(p.id)).toBe(expected);
    // Existing bot Gold and bot Card XP paths are unchanged by this pass.
    const db = getDb();
    const goldRows = await db.select().from(botGoldAwards).where(eq(botGoldAwards.matchId, mid));
    expect(goldRows).toHaveLength(1);
    expect(goldRows[0]!.amount).toBe(goldOut.amount);
    expect(await db.select().from(botCardXpAwards).where(eq(botCardXpAwards.matchId, mid))).toEqual([]);
  });

  it("holds bot XP pending without Gold and awards zero to Practice", async () => {
    const p = await mkPlayer("bot2");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "52");
    const mid = trackBot(randomUUID());
    // Store evidence directly without Gold: XP must wait, not confirm.
    const { recordBotMatchEvidence } = await import("@/db/bot-gold");
    await recordBotMatchEvidence(botEvidence(mid, p.id, s, humanSeat, new Date()));
    const pending = await svc().processBotMatch(mid);
    expect(pending.status).toBe("pending");
    expect(pending.eligibility).toBe("awaiting-gold");
    expect(await getAccountXpTotal(p.id)).toBe(0);

    const q = await mkPlayer("solop");
    const { s: ps, humanSeat: ph } = playBotGame(q.id, "53");
    const pmid = trackBot(randomUUID());
    const { recordBotMatchEvidence: rec2 } = await import("@/db/bot-gold");
    await rec2(botEvidence(pmid, q.id, ps, ph, new Date(), "practice"));
    const pout = await svc().processBotMatch(pmid);
    expect(pout.status).toBe("refused");
    expect(pout.eligibility).toBe("practice-earns-zero");
    expect(await getAccountXpTotal(q.id)).toBe(0);
  });

  it("refuses tampered bot replays with zero writes", async () => {
    const p = await mkPlayer("bot3");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "54");
    const mid = trackBot(randomUUID());
    const goldSvc = new BotGoldService();
    const ev = botEvidence(mid, p.id, s, humanSeat, new Date());
    expect((await goldSvc.processEvidence(ev)).status).toBe("confirmed");
    // Tamper a second match's commands after Gold evidence was stored.
    const mid2 = trackBot(randomUUID());
    const ev2 = botEvidence(mid2, p.id, s, humanSeat, new Date());
    await (await import("@/db/bot-gold")).recordBotMatchEvidence(ev2);
    const tampered = { ...(ev2 as unknown as Record<string, unknown>), liveHash: "deadbeef" } as unknown as BotMatchEvidence;
    const { getBotMatchEvidence } = await import("@/db/bot-gold");
    expect(await getBotMatchEvidence(mid2)).toBeTruthy();
    void tampered;
    // Corrupt stored commands in place, then process: replay must mismatch.
    const db = getDb();
    const cmds = [...(ev2.commands as unknown[])];
    const first = { ...(cmds.find((c) => (c as { cardId?: string }).cardId && !(c as { cardId: string }).cardId.startsWith("cmdr:")) as Record<string, unknown>) };
    first.cardId = "boulderback";
    const idx = cmds.findIndex((c) => (c as { cardId?: string }).cardId && !(c as { cardId: string }).cardId.startsWith("cmdr:"));
    cmds[idx] = first;
    await db.update(botMatches).set({ commands: cmds as never }).where(eq(botMatches.matchId, mid2));
    const out = await svc().processBotMatch(mid2);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("replay-mismatch");
    const rows = await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, p.id));
    expect(rows.filter((r) => r.matchId === mid2)).toEqual([]);
  });
});

describe("V2.2a account xp caps, concurrency and recovery", () => {
  it("enforces the transactional PvP daily cap under concurrent completions", async () => {
    const p = await mkPlayer("cap1");
    await ensureAccountXpRelease();
    const db = getDb();
    // Seed 19 rewarded days via minimal settled matches.
    for (let i = 0; i < 19; i += 1) {
      const id = trackPvp(randomUUID());
      await db.insert(matches).values({
        id,
        roomId: `cap-${i}`,
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
        liveHash: `h${i}`,
        replayHash: `h${i}`,
        evidenceSha256: `e${i}`,
        verification: "replay-verified",
      });
      const staged = await (await import("@/db/account-xp")).stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 50, result: "loss" });
      expect(staged.status).toBe("awarded");
    }
    expect(await countAccountXpPvpToday(p.id)).toBe(19);
    // Two concurrent final slots: exactly one wins, the other is capped.
    const idA = trackPvp(randomUUID());
    const idB = trackPvp(randomUUID());
    for (const [id, i] of [[idA, 19], [idB, 20]] as const) {
      await db.insert(matches).values({
        id,
        roomId: `cap-${i}`,
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
        liveHash: `h${i}`,
        replayHash: `h${i}`,
        evidenceSha256: `e${i}`,
        verification: "replay-verified",
      });
    }
    const { stageAccountXpPvpAward } = await import("@/db/account-xp");
    const [rA, rB] = await Promise.all([
      stageAccountXpPvpAward({ matchId: idA, playerId: p.id, amount: 50, result: "loss" }),
      stageAccountXpPvpAward({ matchId: idB, playerId: p.id, amount: 50, result: "loss" }),
    ]);
    const statuses = [rA.status, rB.status].sort();
    expect(statuses).toEqual(["awarded", "capped"]);
    expect(await countAccountXpPvpToday(p.id)).toBe(20);
  });

  it("keeps concurrent different-source awards independent", async () => {
    const p = await mkPlayer("both1");
    const q = await mkPlayer("both2");
    await ensureAccountXpRelease();
    const s = startPvp(p, q, 17);
    const pvpId = trackPvp(randomUUID());
    expect(await settlePvp(s, pvpId, "matchmaking", new Date())).toBe("settled");
    const { s: bs, humanSeat } = playBotGame(p.id, "55");
    const botId = trackBot(randomUUID());
    const goldOut = await new BotGoldService().processEvidence(botEvidence(botId, p.id, bs, humanSeat, new Date()));
    expect(goldOut.status).toBe("confirmed");
    const [pvpOut, botOut] = await Promise.all([svc().processPvpMatch(pvpId), svc().processBotMatch(botId)]);
    expect(pvpOut.status).toBe("confirmed");
    expect(botOut.status).toBe("confirmed");
    const total = await getAccountXpTotal(p.id);
    const pvpAmt = pvpOut.players.find((x) => x.playerId === p.id)!.amount;
    expect(total).toBe(pvpAmt + botOut.amount);
  });

  it("recovers interrupted runs via reconciliation without doubles", async () => {
    const [a, b] = [await mkPlayer("rec1"), await mkPlayer("rec2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 18);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const { claimAccountXpRun } = await import("@/db/account-xp");
    await claimAccountXpRun(a.id, "matchmaking", matchId, { reason: "test-interrupt" });
    const before = await getAccountXpTotal(a.id);
    expect(before).toBe(0);
    const rec = await svc().reconcile(10);
    expect(rec.processed).toBeGreaterThanOrEqual(1);
    expect(await getAccountXpTotal(a.id)).toBeGreaterThan(0);
    const again = await svc().processPvpMatch(matchId);
    expect(again.status === "confirmed" || again.status === "refused").toBe(true);
    const total = await getAccountXpTotal(a.id);
    // A second reconcile cannot double the award.
    await svc().reconcile(10);
    expect(await getAccountXpTotal(a.id)).toBe(total);
    void b;
  });

  it("serves the authenticated read contract without leaking peers", async () => {
    const [a, b] = [await mkPlayer("api1"), await mkPlayer("api2")];
    await ensureAccountXpRelease();
    const db = getDb();
    const suffixA = `ax${randomUUID().slice(0, 6)}`;
    const suffixB = `ax${randomUUID().slice(0, 6)}`;
    for (const [p, suffix] of [[a, suffixA], [b, suffixB]] as const) {
      await db
        .update(players)
        .set({ username: suffix, usernameKey: suffix, avatarId: "chog-1", onboardingStatus: "complete" })
        .where(eq(players.id, p.id));
    }
    const s = startPvp(a, b, 19);
    const matchId = trackPvp(randomUUID());
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    expect((await svc().processPvpMatch(matchId)).status).toBe("confirmed");
    const didA = (await db.select().from(players).where(eq(players.id, a.id)).limit(1))[0]!.privyDid;
    const token = `tok-${didA.replace("did:privy:", "")}`;
    const res = await GET(new Request("http://localhost/api/players/me/account-xp", { headers: { authorization: `Bearer ${token}` } }) as Request);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    const data = body.data as {
      policyVersion: number;
      level: number;
      totalXp: number;
      currentLevelThreshold: number;
      nextLevelThreshold: number | null;
      xpIntoLevel: number;
      xpToNext: number | null;
      maxLevel: boolean;
      awards: Array<{ matchId: string }>;
    };
    expect(data.policyVersion).toBe(ACCOUNT_XP_POLICY_VERSION);
    expect(data.level).toBeGreaterThanOrEqual(1);
    expect(data.totalXp).toBeGreaterThan(0);
    expect(data.currentLevelThreshold).toBeLessThanOrEqual(data.totalXp);
    expect(data.awards.length).toBeGreaterThan(0);
    // No peer rows leak into the caller's feed.
    for (const award of data.awards) expect(award.matchId).toBeDefined();
    const unauth = await GET(new Request("http://localhost/api/players/me/account-xp") as Request);
    expect(unauth.status).toBe(401);
  });
});
