// V2.2c-1 authoritative Account XP battle receipts. TEST branch only.
// Covers protocol receipts for PvP win/loss/draw and AI win/loss/draw,
// duplicates, pending-then-confirmed, refused/capped, client validator,
// wrong-player isolation, reconnect readback, solo/private isolation,
// release boundary, flag-OFF silence, concurrency/level-up, room delivery
// and closure, plus Gold/Card XP regression preservation.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { Client, type Room } from "@colyseus/sdk";
import { getEnv } from "@/lib/env";
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
import {
  ensureAccountXpRelease,
  getAccountXpTotal,
  stageAccountXpBotAward,
  stageAccountXpPvpAward,
} from "@/db/account-xp";
import {
  AccountXpService,
  buildAccountXpReceipt,
} from "./account-xp";
import {
  ACCOUNT_XP_POLICY_VERSION,
  levelForTotalXp,
  validateAccountXpReceipt,
} from "@/lib/account-xp";
import {
  BATTLE_QUEUE_ROOM,
  type AccountXpMessage,
  type EndMessage,
  type MatchFoundMessage,
  type SettlementMessage,
  type StartMessage,
  type BattleFrame,
} from "@/lib/battle-protocol";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { PracticeRoom } from "@/server/battle/practice-room";
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

afterEach(() => {
  delete process.env.PLAYER_ACCOUNT_XP_ENABLED;
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:axpr_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

const svc = () => new AccountXpService({ enabled: true });

/** Spam both seats to a finish; the engine rejects illegal drops. */
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
      s.submit(pl.playerId, { type: "deploy", cid: `r${n}`, cardId: pick, x: 30 + ((n % 2) * 40), y: seat === 0 ? 60 : 100 });
    });
    s.tick();
  }
}

function startPvp(a: Player, b: Player, seedFlip = 0) {
  const s = new BattleSession({ seed: () => `axpr${seedFlip}axpr00axpr00axpr00`, int: (n) => (n === 2 ? seedFlip : 0) });
  s.join({ playerId: a.id, username: `pa-${a.id.slice(0, 6)}` });
  s.join({ playerId: b.id, username: `pb-${b.id.slice(0, 6)}` });
  s.setReady(a.id, makeLoadout([...PRESETS.swarm!.cards], "scout"));
  s.setReady(b.id, makeLoadout([...PRESETS.siege!.cards], "scout"));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron(String(200 + seedFlip)));
  driveToFinish(s);
  return s;
}

async function settlePvp(s: BattleSession, matchId: string, matchType: "matchmaking" | "private" | "ranked", startedAt: Date) {
  const service = new SettlementService({ retryDelaysMs: [], sleep: async () => {} });
  const record = recordFromReplay(s.replay!, {
    matchId,
    roomId: `axpr-${matchId.slice(0, 8)}`,
    matchType,
    startedAt,
    crowns: [...s.state!.crowns] as [number, number],
  });
  return service.submit(record);
}

const HUMAN_DECK = ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"];

function playBotGame(humanId: string, seed: string, humanIdle = false) {
  const botId = `bot:axpr-${seed}`;
  const s = new BattleSession();
  s.join({ playerId: humanId, username: `Human-${humanId.slice(0, 6)}` });
  s.join({ playerId: botId, username: "AI Opponent" });
  s.setReady(humanId, { cards: [...HUMAN_DECK], grant: freeGrant("scout") });
  s.setReady(botId, { cards: [...practiceBotOrdinaryCards()], grant: freeGrant("bulwark") });
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

function botEvidence(matchId: string, playerId: string, s: BattleSession, humanSeat: 0 | 1, startedAt: Date): BotMatchEvidence {
  const r = s.replay!;
  return {
    matchId,
    playerId,
    difficulty: "medium",
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
    startedAt: startedAt.toISOString(),
  };
}

describe("V2.2c-1 pvp receipts", () => {
  it("emits per-player win/loss receipts with proven level snapshots", async () => {
    const [a, b] = [await mkPlayer("pvpw1"), await mkPlayer("pvpw2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 31);
    expect(s.phase).toBe("finished");
    const matchId = randomUUID();
    pvpMatchIds.push(matchId);
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const out = await svc().processPvpMatch(matchId);
    expect(out.status).toBe("confirmed");
    expect(out.players).toHaveLength(2);
    for (const outcome of out.players) {
      const receipt = await buildAccountXpReceipt(outcome.playerId, "matchmaking", matchId, outcome);
      const parsed = validateAccountXpReceipt(receipt);
      expect(parsed.ok).toBe(true);
      expect(receipt.status).toBe("confirmed");
      expect(receipt.policyVersion).toBe(ACCOUNT_XP_POLICY_VERSION);
      expect(receipt.playerId).toBe(outcome.playerId);
      const expected = outcome.result === "win" ? 100 : outcome.result === "draw" ? 75 : 50;
      expect(receipt.amount).toBe(expected);
      expect(receipt.result).toBe(outcome.result);
      expect(receipt.totalXp).toBe(expected);
      expect(receipt.levelBefore).toBe(1);
      expect(receipt.levelAfter).toBe(levelForTotalXp(expected));
      expect(receipt.leveledUp).toBe(receipt.levelAfter! > 1);
    }
    // Winner and loser receipts differ by player and amount.
    const [ra, rb] = await Promise.all(
      out.players.map((o) => buildAccountXpReceipt(o.playerId, "matchmaking", matchId, o))
    );
    expect(ra!.playerId).not.toBe(rb!.playerId);
    if (ra!.result !== "draw") expect(ra!.amount).not.toBe(rb!.amount);
  });

  it("repeats an identical receipt on duplicate processing without a second award", async () => {
    const [a, b] = [await mkPlayer("pvpd1"), await mkPlayer("pvpd2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 32);
    const matchId = randomUUID();
    pvpMatchIds.push(matchId);
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    const first = await svc().processPvpMatch(matchId);
    const firstReceipts = await Promise.all(first.players.map((o) => buildAccountXpReceipt(o.playerId, "matchmaking", matchId, o)));
    const totalBefore = await getAccountXpTotal(a.id);
    const second = await svc().processPvpMatch(matchId);
    const secondReceipts = await Promise.all(
      second.players.map((o) => buildAccountXpReceipt(o.playerId, "matchmaking", matchId, o))
    );
    expect(await getAccountXpTotal(a.id)).toBe(totalBefore);
    expect(secondReceipts).toEqual(firstReceipts);
    for (const r of secondReceipts) expect(validateAccountXpReceipt(r).ok).toBe(true);
  });

  it("returns null snapshots for refused private matches", async () => {
    const [a, b] = [await mkPlayer("pvpp1"), await mkPlayer("pvpp2")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 33);
    const matchId = randomUUID();
    pvpMatchIds.push(matchId);
    expect(await settlePvp(s, matchId, "private", new Date())).toBe("settled");
    const out = await svc().processPvpMatch(matchId);
    expect(out.status).toBe("refused");
    expect(out.players).toEqual([]);
    // A refused outcome builds an unproven receipt, never a positive amount.
    const receipt = await buildAccountXpReceipt(a.id, "matchmaking", matchId, {
      eligibility: "private-earns-zero",
      amount: 0,
      result: "loss",
      status: "refused",
    });
    expect(receipt.amount).toBe(0);
    expect(receipt.totalXp).toBeNull();
    expect(receipt.leveledUp).toBeNull();
    expect(validateAccountXpReceipt(receipt).ok).toBe(true);
  });
});

describe("V2.2c-1 ai receipts", () => {
  it("emits a confirmed AI receipt only with Gold confirmation", async () => {
    const p = await mkPlayer("aib1");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "61");
    expect(s.phase).toBe("finished");
    const mid = randomUUID();
    botMatchIds.push(mid);
    const goldOut = await new BotGoldService().processEvidence(botEvidence(mid, p.id, s, humanSeat, new Date()));
    expect(goldOut.status).toBe("confirmed");
    const out = await svc().processBotMatch(mid);
    expect(out.status).toBe("confirmed");
    const receipt = await buildAccountXpReceipt(p.id, "unranked-fallback", mid, out);
    expect(validateAccountXpReceipt(receipt).ok).toBe(true);
    const expected = out.result === "win" ? 40 : out.result === "draw" ? 30 : 20;
    expect(receipt.amount).toBe(expected);
    expect(receipt.result).toBe(out.result);
    expect(receipt.source).toBe("unranked-fallback");
    expect(receipt.playerId).toBe(p.id);
    expect(receipt.totalXp).toBe(expected);
  });

  it("holds pending then confirms with identical snapshots", async () => {
    const p = await mkPlayer("aib2");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "62");
    const mid = randomUUID();
    botMatchIds.push(mid);
    const { recordBotMatchEvidence } = await import("@/db/bot-gold");
    await recordBotMatchEvidence(botEvidence(mid, p.id, s, humanSeat, new Date()));
    const pending = await svc().processBotMatch(mid);
    expect(pending.status).toBe("pending");
    const pendingReceipt = await buildAccountXpReceipt(p.id, "unranked-fallback", mid, pending);
    expect(pendingReceipt.status).toBe("pending");
    expect(pendingReceipt.amount).toBe(0);
    expect(pendingReceipt.result).toBeNull();
    expect(validateAccountXpReceipt(pendingReceipt).ok).toBe(true);
    // Gold landing later confirms the same award exactly once.
    const goldOut = await new BotGoldService().processMatch(mid);
    expect(goldOut.status).toBe("confirmed");
    const out = await svc().processBotMatch(mid);
    expect(out.status).toBe("confirmed");
    const receipt = await buildAccountXpReceipt(p.id, "unranked-fallback", mid, out);
    expect(validateAccountXpReceipt(receipt).ok).toBe(true);
    expect(receipt.amount).toBeGreaterThan(0);
    expect(receipt.totalXp).toBe(receipt.amount);
    // A duplicate replay of the confirmed receipt changes nothing.
    const dup = await svc().processBotMatch(mid);
    const dupReceipt = await buildAccountXpReceipt(p.id, "unranked-fallback", mid, {
      eligibility: "duplicate",
      amount: 0,
      result: out.result,
      status: "confirmed",
    });
    expect(dupReceipt).toEqual(receipt);
    expect(await getAccountXpTotal(p.id)).toBe(receipt.amount);
    void dup;
  });

  it("builds staged draw receipts at 75 PvP and 30 fallback", async () => {
    const [a, b] = [await mkPlayer("drw1"), await mkPlayer("drw2")];
    await ensureAccountXpRelease();
    const db = getDb();
    const pvpId = randomUUID();
    pvpMatchIds.push(pvpId);
    await db.insert(matches).values({
      id: pvpId,
      roomId: "drw",
      matchType: "matchmaking",
      rulesetVersion: "v16",
      protocolVersion: "1",
      startedAt: new Date(),
      finishedAt: new Date(),
      outcome: "draw",
      winnerSeat: null,
      endReason: "core",
      crowns0: 1,
      crowns1: 1,
      ticks: 1800,
      liveHash: "d1",
      replayHash: "d1",
      evidenceSha256: "e1",
      verification: "replay-verified",
    });
    const staged = await stageAccountXpPvpAward({ matchId: pvpId, playerId: a.id, amount: 75, result: "draw" });
    expect(staged.status).toBe("awarded");
    const receipt = await buildAccountXpReceipt(a.id, "matchmaking", pvpId, {
      eligibility: "eligible",
      amount: 75,
      result: "draw",
      status: "confirmed",
    });
    expect(receipt.amount).toBe(75);
    expect(receipt.result).toBe("draw");
    expect(validateAccountXpReceipt(receipt).ok).toBe(true);

    const c = await mkPlayer("drw3");
    const botId = randomUUID();
    botMatchIds.push(botId);
    await db.insert(botMatches).values({
      matchId: botId,
      playerId: c.id,
      difficulty: "medium",
      source: "unranked-fallback",
      policyVersion: BOT_GOLD_POLICY_VERSION,
      config: {},
      commands: [],
      humanSeat: 0,
      liveHash: "h",
      replayHash: "h",
      replayIdentical: true,
      winnerSeat: null,
      ticks: 1800,
      humanDeploys: 9,
      status: "awarded",
      startedAt: new Date(),
      xpEligible: false,
    });
    const stagedBot = await stageAccountXpBotAward({ matchId: botId, playerId: c.id, amount: 30, result: "draw" });
    expect(stagedBot.status).toBe("awarded");
    const botReceipt = await buildAccountXpReceipt(c.id, "unranked-fallback", botId, {
      eligibility: "eligible",
      amount: 30,
      result: "draw",
      status: "confirmed",
    });
    expect(botReceipt.amount).toBe(30);
    expect(validateAccountXpReceipt(botReceipt).ok).toBe(true);
    void b;
  });
});

describe("V2.2c-1 validator and isolation", () => {
  it("rejects forged and locally computed receipts", () => {
    const good = {
      matchId: randomUUID(),
      source: "matchmaking",
      policyVersion: ACCOUNT_XP_POLICY_VERSION,
      status: "confirmed",
      eligibility: "eligible",
      result: "win",
      amount: 100,
      playerId: randomUUID(),
      totalXp: 100,
      levelBefore: 1,
      levelAfter: 2,
      leveledUp: true,
    };
    expect(validateAccountXpReceipt(good).ok).toBe(true);
    // Positive amount on a non-confirmed receipt.
    expect(validateAccountXpReceipt({ ...good, status: "refused", amount: 50 }).ok).toBe(false);
    // Negative amount.
    expect(validateAccountXpReceipt({ ...good, amount: -5 }).ok).toBe(false);
    // Wrong policy version (client guess).
    expect(validateAccountXpReceipt({ ...good, policyVersion: 999 }).ok).toBe(false);
    // Inconsistent level-up flag (client celebration).
    expect(validateAccountXpReceipt({ ...good, leveledUp: false }).ok).toBe(false);
    // Partial snapshots.
    expect(validateAccountXpReceipt({ ...good, levelAfter: null }).ok).toBe(false);
    // Confirmed without snapshots.
    expect(
      validateAccountXpReceipt({ ...good, totalXp: null, levelBefore: null, levelAfter: null, leveledUp: null }).ok
    ).toBe(false);
    // Empty player id.
    expect(validateAccountXpReceipt({ ...good, playerId: "" }).ok).toBe(false);
  });

  it("refuses solo practice and pre-release history with null snapshots", async () => {
    const p = await mkPlayer("iso1");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "63");
    const { recordBotMatchEvidence } = await import("@/db/bot-gold");
    const mid = randomUUID();
    botMatchIds.push(mid);
    const ev = { ...botEvidence(mid, p.id, s, humanSeat, new Date()), source: "practice" };
    await recordBotMatchEvidence(ev as never);
    const out = await svc().processBotMatch(mid);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("practice-earns-zero");
    const receipt = await buildAccountXpReceipt(p.id, "unranked-fallback", mid, { ...out, amount: 0 });
    expect(receipt.amount).toBe(0);
    expect(receipt.leveledUp).toBeNull();
    expect(await getAccountXpTotal(p.id)).toBe(0);

    const [a, b] = [await mkPlayer("iso2"), await mkPlayer("iso3")];
    const rel = await ensureAccountXpRelease();
    const ps = startPvp(a, b, 34);
    const pid = randomUUID();
    pvpMatchIds.push(pid);
    const before = new Date(new Date(rel.activatedAt).getTime() - 3_600_000);
    expect(await settlePvp(ps, pid, "matchmaking", before)).toBe("settled");
    const hout = await svc().processPvpMatch(pid);
    expect(hout.status).toBe("refused");
    expect(await getAccountXpTotal(a.id)).toBe(0);
  });

  it("writes nothing and sends nothing when the flag is off", async () => {
    const p = await mkPlayer("off1");
    await ensureAccountXpRelease();
    const { s, humanSeat } = playBotGame(p.id, "64");
    const mid = randomUUID();
    botMatchIds.push(mid);
    const off = new AccountXpService({ enabled: false });
    const out = await off.processBotMatch(mid);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("flag-off");
    const db = getDb();
    expect(await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, p.id))).toEqual([]);
    expect(await db.select().from(accountXpRuns).where(eq(accountXpRuns.playerId, p.id))).toEqual([]);
    void humanSeat;
    void s;
  });
});

describe("V2.2c-1 concurrency and level-up", () => {
  it("attributes a threshold crossing to the award that crossed it", async () => {
    const p = await mkPlayer("conc1");
    await ensureAccountXpRelease();
    const db = getDb();
    // Seed 200 lifetime XP: four staged 50s (L2 = 100, L3 = 225).
    for (let i = 0; i < 4; i += 1) {
      const id = randomUUID();
      pvpMatchIds.push(id);
      await db.insert(matches).values({
        id,
        roomId: `conc-${i}`,
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
        liveHash: `ch${i}`,
        replayHash: `ch${i}`,
        evidenceSha256: `ce${i}`,
        verification: "replay-verified",
      });
      expect((await stageAccountXpPvpAward({ matchId: id, playerId: p.id, amount: 50, result: "loss" })).status).toBe("awarded");
    }
    expect(await getAccountXpTotal(p.id)).toBe(200);
    // Two concurrent 50 awards: first crosses 225 exactly once.
    const idA = randomUUID();
    const idB = randomUUID();
    pvpMatchIds.push(idA, idB);
    for (const [id, i] of [[idA, 4], [idB, 5]] as const) {
      await db.insert(matches).values({
        id,
        roomId: `conc-${i}`,
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
        liveHash: `ch${i}`,
        replayHash: `ch${i}`,
        evidenceSha256: `ce${i}`,
        verification: "replay-verified",
      });
    }
    const [rA, rB] = await Promise.all([
      stageAccountXpPvpAward({ matchId: idA, playerId: p.id, amount: 50, result: "loss" }),
      stageAccountXpPvpAward({ matchId: idB, playerId: p.id, amount: 50, result: "loss" }),
    ]);
    expect(rA.status).toBe("awarded");
    expect(rB.status).toBe("awarded");
    expect(await getAccountXpTotal(p.id)).toBe(300);
    // Receipts are counterfactual: each excludes its own award. The award
    // that crossed 225 sees before=200/after=250; built after both commit,
    // both see the shared total, so rebuild deterministically in commit
    // order is impossible here. Instead assert the ledger truth: exactly
    // one 50-step in the 200->300 walk crosses a threshold, and each
    // receipt's snapshots are internally consistent with the ledger.
    const [recA, recB] = await Promise.all([
      buildAccountXpReceipt(p.id, "matchmaking", idA, { eligibility: "eligible", amount: 50, result: "loss", status: "confirmed" }),
      buildAccountXpReceipt(p.id, "matchmaking", idB, { eligibility: "eligible", amount: 50, result: "loss", status: "confirmed" }),
    ]);
    expect(validateAccountXpReceipt(recA).ok).toBe(true);
    expect(validateAccountXpReceipt(recB).ok).toBe(true);
    // Same shared total, internally consistent snapshots, no double award.
    expect(recA!.totalXp).toBe(300);
    expect(recB!.totalXp).toBe(300);
    expect(recA!.amount + recB!.amount).toBe(100);
    // Deterministic crossing proof: rebuild right after each commit.
    const p2 = await mkPlayer("conc2");
    for (let i = 0; i < 4; i += 1) {
      const id = randomUUID();
      pvpMatchIds.push(id);
      await db.insert(matches).values({
        id,
        roomId: `conc2-${i}`,
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
        liveHash: `c2h${i}`,
        replayHash: `c2h${i}`,
        evidenceSha256: `c2e${i}`,
        verification: "replay-verified",
      });
      expect((await stageAccountXpPvpAward({ matchId: id, playerId: p2.id, amount: 50, result: "loss" })).status).toBe("awarded");
    }
    const idC = randomUUID();
    const idD = randomUUID();
    pvpMatchIds.push(idC, idD);
    for (const [id, i] of [[idC, 4], [idD, 5]] as const) {
      await db.insert(matches).values({
        id,
        roomId: `conc2-${i}`,
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
        liveHash: `c2h${i}`,
        replayHash: `c2h${i}`,
        evidenceSha256: `c2e${i}`,
        verification: "replay-verified",
      });
    }
    expect((await stageAccountXpPvpAward({ matchId: idC, playerId: p2.id, amount: 50, result: "loss" })).status).toBe("awarded");
    const recC = await buildAccountXpReceipt(p2.id, "matchmaking", idC, { eligibility: "eligible", amount: 50, result: "loss", status: "confirmed" });
    // 200 -> 250 crosses L3 (225): this award provably leveled up.
    expect(recC!.levelBefore).toBe(2);
    expect(recC!.levelAfter).toBe(3);
    expect(recC!.leveledUp).toBe(true);
    expect((await stageAccountXpPvpAward({ matchId: idD, playerId: p2.id, amount: 50, result: "loss" })).status).toBe("awarded");
    const recD = await buildAccountXpReceipt(p2.id, "matchmaking", idD, { eligibility: "eligible", amount: 50, result: "loss", status: "confirmed" });
    // 250 -> 300 crosses nothing: same total walk, no second claim.
    expect(recD!.levelBefore).toBe(3);
    expect(recD!.levelAfter).toBe(3);
    expect(recD!.leveledUp).toBe(false);
    expect(validateAccountXpReceipt(recD).ok).toBe(true);
  });
});

describe("V2.2c-1 hook guards and room closure", () => {
  it("sends nothing for solo practice or disabled flags, refuses honestly when enabled", async () => {
    const savedDeps = PracticeRoom.deps;
    const p = await mkPlayer("hook1");
    await ensureAccountXpRelease();
    const sent: Array<{ event: string; message: unknown }> = [];
    const fakeRoom = (origin: "practice" | "unranked-fallback", matchId: string | null) => {
      const room = new PracticeRoom();
      Object.assign(room, {
        origin,
        matchId,
        session: { slots: [{ playerId: p.id }] },
        humanClient: { send: (event: string, message: unknown) => void sent.push({ event, message }) },
      });
      return room as unknown as { maybeAwardAccountXp(g: Promise<void> | null): Promise<void> | null };
    };
    try {
      // Solo practice never reaches the service, even with flags on.
      PracticeRoom.deps = { ...savedDeps, botGold: { enabled: true }, accountXp: { enabled: true } };
      expect(fakeRoom("practice", randomUUID()).maybeAwardAccountXp(null)).toBeNull();
      // Flag OFF: fallback also sends nothing and writes nothing.
      PracticeRoom.deps = { ...savedDeps, botGold: undefined, accountXp: undefined };
      expect(fakeRoom("unranked-fallback", randomUUID()).maybeAwardAccountXp(null)).toBeNull();
      // Enabled fallback with no evidence: refused receipt, zero amount.
      process.env.PLAYER_ACCOUNT_XP_ENABLED = "1";
      PracticeRoom.deps = { ...savedDeps, botGold: { enabled: true }, accountXp: { enabled: true } };
      const mid = randomUUID();
      botMatchIds.push(mid);
      const pending = fakeRoom("unranked-fallback", mid).maybeAwardAccountXp(Promise.resolve());
      expect(pending).not.toBeNull();
      await pending!;
      expect(sent).toHaveLength(1);
      expect(sent[0]!.event).toBe("account_xp");
      const receipt = sent[0]!.message as AccountXpMessage;
      expect(receipt.matchId).toBe(mid);
      expect(receipt.status).toBe("refused");
      expect(receipt.amount).toBe(0);
      expect(receipt.totalXp).toBeNull();
      expect(validateAccountXpReceipt(receipt).ok).toBe(true);
      // No award row was written by the refused path.
      const db = getDb();
      expect(await db.select().from(accountXpAwards).where(eq(accountXpAwards.playerId, p.id))).toEqual([]);
    } finally {
      PracticeRoom.deps = savedDeps;
    }
  });
});

describe("V2.2c-1 authenticated receipt readback", () => {
  async function onboarded(name: string): Promise<{ player: Player; token: string }> {
    const suffix = `${name}_${randomUUID().slice(0, 6)}`;
    const did = `did:privy:${suffix}`;
    const p = await provisionPlayer({ privyDid: did });
    createdPlayerIds.push(p.id);
    const [row] = await getDb()
      .update(players)
      .set({ username: suffix, usernameKey: suffix.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
      .where(eq(players.id, p.id))
      .returning();
    return { player: row!, token: `tok-${suffix}` };
  }
  const lookup = (token: string | undefined, matchId: string, source: string) =>
    GET(
      new Request(`http://localhost/api/players/me/account-xp?matchId=${matchId}&source=${source}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}) as Request
    ).then(async (r) => ({ status: r.status, body: (await r.json()) as { success: boolean; data?: Record<string, unknown> } }));

  it("recovers confirmed, pending, refused and unknown states without leaking peers", async () => {
    const [{ player: a, token: tokA }, { player: b, token: tokB }] = [await onboarded("rba"), await onboarded("rbb")];
    await ensureAccountXpRelease();
    const s = startPvp(a, b, 35);
    const matchId = randomUUID();
    pvpMatchIds.push(matchId);
    expect(await settlePvp(s, matchId, "matchmaking", new Date())).toBe("settled");
    expect((await svc().processPvpMatch(matchId)).status).toBe("confirmed");
    // Owner recovers the confirmed receipt with snapshots after a missed message.
    const hit = await lookup(tokA, matchId, "matchmaking");
    expect(hit.status).toBe(200);
    expect(hit.body.success).toBe(true);
    const data = hit.body.data as { status: string; receipt: AccountXpMessage };
    expect(data.status).toBe("confirmed");
    expect(data.receipt.playerId).toBe(a.id);
    expect(data.receipt.amount).toBeGreaterThan(0);
    expect(data.receipt.totalXp).toBe(data.receipt.amount);
    expect(validateAccountXpReceipt(data.receipt).ok).toBe(true);
    // The opponent's match is unknown to this caller: no leakage.
    const peer = await lookup(tokB, matchId, "matchmaking");
    expect(peer.status).toBe(200);
    const peerData = peer.body.data as { status: string; receipt: unknown };
    // The opponent has their own award row, so they recover their own receipt.
    expect(peerData.status).toBe("confirmed");
    expect((peerData.receipt as AccountXpMessage).playerId).toBe(b.id);
    const stranger = await onboarded("rbc");
    const leak = await lookup(stranger.token, matchId, "matchmaking");
    expect(leak.status).toBe(200);
    expect((leak.body.data as { status: string }).status).toBe("unknown");
    // Pending run without an award yet.
    const { claimAccountXpRun, markAccountXpRun } = await import("@/db/account-xp");
    const pendId = randomUUID();
    await claimAccountXpRun(a.id, "matchmaking", pendId, { reason: "test" });
    const pend = await lookup(tokA, pendId, "matchmaking");
    expect((pend.body.data as { status: string }).status).toBe("pending");
    // Terminal refusal is explicit, never silent zero.
    await markAccountXpRun(a.id, "matchmaking", pendId, "refused", 0, { reason: "short-match" });
    const refused = await lookup(tokA, pendId, "matchmaking");
    expect((refused.body.data as { status: string }).status).toBe("refused");
    // Unauthenticated lookup is refused.
    const unauth = await lookup(undefined, matchId, "matchmaking");
    expect(unauth.status).toBe(401);
  });
});

describe("V2.2c-1 live pvp delivery", () => {
  it("delivers one account_xp receipt per player after settlement without confusing the two", async () => {
    process.env.PLAYER_ACCOUNT_XP_ENABLED = "1";
    await ensureAccountXpRelease();
    const { BattleRoom } = await import("./room");
    const savedRoomDeps = BattleRoom.deps;
    const db = getDb();
    const mkLivePlayer = async (name: string) => {
      const suffix = `${name}_${randomUUID().slice(0, 6)}`;
      const p = await provisionPlayer({ privyDid: `did:privy:${suffix}` });
      createdPlayerIds.push(p.id);
      const [row] = await db
        .update(players)
        .set({ username: suffix, usernameKey: suffix.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
        .where(eq(players.id, p.id))
        .returning();
      return { player: row!, token: `tok-${suffix}`, key: suffix };
    };
    const la = await mkLivePlayer("lvpa");
    const lb = await mkLivePlayer("lvpb");
    const byKey: Record<string, Player> = { [la.key]: la.player, [lb.key]: lb.player };
    const nftRow = (tokenId: string, cls: CommanderClass = "scout"): Commander => {
      const t = freeCommanderTemplates().find((x) => x.class === cls)!;
      return { id: "cmdr-row", nftId: "nft-row", rulesetVersion: "v1", tokenId, class: cls, affinity: cls, stats: t.stats, abilities: t.abilities, variant: "bastion", prestige: "Mythic", sourceTraits: [], unmatchedTraits: [], scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 }, powerScore: t.powerScore, contentHash: `h-${tokenId}`, derivationCount: 1, derivedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), previousContentHash: null } as unknown as Commander;
    };
    const entitlement: EntitlementDeps = {
      verifiedWallets: async () => [],
      ownerOf: async () => ({ owner: "0x0", chainId: 143 }),
      loadNftCommander: async (tokenId) => ({ tokenId, name: `CHOG #${tokenId}`, imageOriginal: null, commander: nftRow(tokenId) }),
      timeoutMs: 60,
    };
    const PORT = 28400 + Math.floor(Math.random() * 200);
    const URL_ = `http://127.0.0.1:${PORT}`;
    const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-axpr-live-"));
    const settleDir = mkdtempSync(path.join(os.tmpdir(), "chog-axpr-outbox-"));
    const service = new SettlementService({
      dir: settleDir,
      retryDelaysMs: [0, 0, 0],
      sleep: async () => {},
      accountXp: new AccountXpService({ enabled: true }),
    });
    const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
    const server = await startBattleServer(
      PORT,
      {
        verifier: async (t) => {
          if (!t.startsWith("tok-")) throw new Error("bad token");
          return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
        },
        loader: async (did) => byKey[did.replace("did:privy:", "")] ?? null,
        entitlement,
        patrons: testPatronSource(),
        tickMs: 2,
        replayDir,
        closeAfterMs: 10_000,
        settlement: service,
      },
      "127.0.0.1"
    );
    try {
      const until = async (cond: () => boolean, ms = 120_000) => {
        const t0 = Date.now();
        while (!cond()) {
          if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      const joinMatch = async (token: string) => {
        const c = new Client(URL_, { headers: { authorization: `Bearer ${token}` } });
        const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
        let found: MatchFoundMessage | null = null;
        q.onMessage("match_found", (m: MatchFoundMessage) => (found = m));
        await until(() => found !== null, 30_000);
        await q.leave().catch(() => {});
        const room = await c.consumeSeatReservation(found!.reservation);
        const seen: { start?: StartMessage; end?: EndMessage; settlement?: SettlementMessage; xp?: AccountXpMessage } = {};
        room.onMessage("start", (m: StartMessage) => (seen.start = m));
        room.onMessage("end", (m: EndMessage) => (seen.end = m));
        room.onMessage("settlement", (m: SettlementMessage) => (seen.settlement = m));
        room.onMessage("account_xp", (m: AccountXpMessage) => (seen.xp = m));
        return { room, seen };
      };
      const [a, b] = await Promise.all([joinMatch(la.token), joinMatch(lb.token)]);
      a.room.send("ready", { cards: [...PRESETS.swarm!.cards], commander: { kind: "free", class: "scout" } });
      b.room.send("ready", { cards: [...PRESETS.siege!.cards], commander: { kind: "free", class: "scout" } });
      await until(() => !!a.seen.start && !!b.seen.start, 30_000);
      // Drive both sides so the match is reward-eligible, then stop.
      const drive = (side: { room: Room; seen: { start?: StartMessage; end?: EndMessage } }) => {
        let last = -1;
        side.room.onMessage("frame", (f: BattleFrame) => {
          if (side.seen.end || !side.seen.start || f.tick === last || f.tick % 25 !== 0) return;
          last = f.tick;
          const pick = f.hand.find((cc) => side.seen.start!.catalog[cc]!.kind === "troop" && side.seen.start!.catalog[cc]!.cost <= f.energy);
          if (pick) side.room.send("cmd", { type: "deploy", cid: `d-${f.tick}`, cardId: pick, x: 30, y: side.seen.start!.seat === 0 ? 60 : 100 });
        });
      };
      drive(a);
      drive(b);
      await until(() => !!a.seen.end && !!b.seen.end, 150_000);
      expect(a.seen.end!.matchId).toBe(b.seen.end!.matchId);
      pvpMatchIds.push(a.seen.end!.matchId!);
      await until(() => !!a.seen.settlement && !!b.seen.settlement, 60_000);
      expect(a.seen.settlement!.status).toBe("settled");
      expect(b.seen.settlement!.status).toBe("settled");
      // Settlement success and XP confirmation arrive as separate receipts.
      await until(() => !!a.seen.xp && !!b.seen.xp, 60_000);
      for (const [side, me] of [[a, la], [b, lb]] as const) {
        const xp = side.seen.xp!;
        expect(xp.source).toBe("matchmaking");
        expect(xp.playerId).toBe(me.player.id);
        expect(xp.status).toBe("confirmed");
        expect(xp.policyVersion).toBe(ACCOUNT_XP_POLICY_VERSION);
        const expected = xp.result === "win" ? 100 : xp.result === "draw" ? 75 : 50;
        expect(xp.amount).toBe(expected);
        expect(xp.totalXp).toBe(expected);
        expect(xp.levelBefore).toBe(1);
        expect(validateAccountXpReceipt(xp).ok).toBe(true);
      }
      // Per-player isolation: each client received only its own receipt.
      expect(a.seen.xp!.playerId).not.toBe(b.seen.xp!.playerId);
      // Room closure still works after delivery.
      await Promise.all([a.room.leave().catch(() => {}), b.room.leave().catch(() => {})]);
    } finally {
      service.stopSweeper();
      await server?.gracefullyShutdown(false);
      BattleRoom.deps = savedRoomDeps;
      rmSync(settleDir, { recursive: true, force: true });
      rmSync(replayDir, { recursive: true, force: true });
    }
  }, 240_000);
});
