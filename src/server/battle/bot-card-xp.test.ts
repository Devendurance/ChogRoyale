import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  botCardXpAwards,
  botCardXpRuns,
  botGoldAwards,
  botMatches,
  cardXpProgress,
  players,
  type Player,
} from "@/db/schema";
import {
  BOT_CARD_XP_MATCH_TOTAL_CAP,
  BOT_CARD_XP_PER_CARD_CAP,
  allocateBotCardXp,
  botCardXpReleaseEnabled,
  botXpForDeployments,
} from "@/lib/bot-card-xp";
import { commanderCardId, type CombatCommand } from "@/lib/combat";
import { botGoldForResult, BOT_GOLD_POLICY_VERSION } from "@/lib/bot-gold";
import { BattleSession, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, testLockedPatron } from "@/server/battle/test-helpers";
import { smartMove } from "@/lib/smart-bot";
import { mediumPolicy, practiceBotOrdinaryCards, type PracticePolicy } from "@/server/battle/practice";
import {
  extractBotDeployments,
  botCardXpService,
  BotCardXpService,
} from "@/server/battle/bot-card-xp";
import {
  recordBotMatchEvidence,
  stageBotGoldAward,
  type BotMatchEvidence,
} from "@/db/bot-gold";
import { getBotXpAwards } from "@/db/bot-card-xp";
import { getMyCardXp } from "@/db/card-xp";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const createdMatchIds: string[] = [];

async function cleanFixtures() {
  const db = getDb();
  if (createdMatchIds.length > 0) {
    await db.delete(botCardXpAwards).where(inArray(botCardXpAwards.matchId, createdMatchIds));
    await db.delete(botCardXpRuns).where(inArray(botCardXpRuns.matchId, createdMatchIds));
    await db.delete(botGoldAwards).where(inArray(botGoldAwards.matchId, createdMatchIds));
    await db.delete(botMatches).where(inArray(botMatches.matchId, createdMatchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
}

afterAll(async () => {
  await cleanFixtures();
  resetDbCache();
});

async function player(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:botxp_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

const HUMAN_DECK = ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"];

function loadouts(): { human: TrustedLoadout; bot: TrustedLoadout } {
  return {
    human: { cards: [...HUMAN_DECK], grant: freeGrant("scout") },
    bot: { cards: [...practiceBotOrdinaryCards()], grant: freeGrant("bulwark") },
  };
}

function playGame(policy: PracticePolicy, patronSeed: string, humanId: string): { session: BattleSession; humanSeat: 0 | 1 } {
  const botId = `bot:botxp-${policy.difficulty}-${patronSeed}`;
  const session = new BattleSession();
  session.join({ playerId: humanId, username: `Human-${humanId.slice(0, 6)}` });
  session.join({ playerId: botId, username: "AI Opponent" });
  const { human, bot } = loadouts();
  session.setReady(humanId, human);
  session.setReady(botId, bot);
  const epoch = session.lock();
  session.start(epoch, session.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron(patronSeed));
  const humanSeat = session.seatOfSlot[0]!;
  const botSeat = humanSeat === 0 ? 1 : 0;
  let commandId = 0;
  let ticks = 0;
  while (session.phase === "active" && ticks < 3100) {
    const state = session.state!;
    const humanMove = smartMove(state, humanSeat, state.tick);
    if (humanMove) {
      commandId += 1;
      session.submit(humanId, { type: "deploy", cid: `h-${commandId}`, cardId: humanMove.cardId, x: Math.round(humanMove.x), y: Math.round(humanMove.y) });
    }
    const botMove = policy.choose(state, botSeat, state.tick);
    if (botMove) {
      commandId += 1;
      session.submit(botId, { type: "deploy", cid: `b-${commandId}`, cardId: botMove.cardId, x: Math.round(botMove.x), y: Math.round(botMove.y) });
    }
    session.tick();
    ticks += 1;
  }
  return { session, humanSeat };
}

function evidenceFor(matchId: string, playerId: string, session: BattleSession, humanSeat: 0 | 1, xpEligible = true): BotMatchEvidence {
  const replay = session.replay!;
  return {
    matchId,
    playerId,
    difficulty: "medium",
    source: "unranked-fallback",
    policyVersion: BOT_GOLD_POLICY_VERSION,
    config: replay.config,
    commands: replay.commands,
    humanSeat,
    liveHash: replay.liveHash,
    replayHash: replay.replayHash,
    replayIdentical: replay.replayIdentical,
    winnerSeat: replay.winner === "draw" ? null : replay.winner,
    ticks: replay.ticks,
    humanDeploys: 99,
    xpEligible,
    startedAt: new Date(Date.now() - replay.ticks * 100).toISOString(),
  };
}

async function trackEvidence(ev: BotMatchEvidence): Promise<void> {
  createdMatchIds.push(ev.matchId);
  await recordBotMatchEvidence(ev);
}

function acceptedCommand(seq: number, player: 0 | 1, cardId: string): CombatCommand {
  return { seq, player, tick: seq, cardId, x: 20, y: player === 0 ? 20 : 140 };
}

describe("V2.1i bot Card XP policy", () => {
  it("awards only on the first and third accepted deployment of a card", () => {
    expect(botXpForDeployments(0)).toBe(0);
    expect(botXpForDeployments(1)).toBe(1);
    expect(botXpForDeployments(2)).toBe(1);
    expect(botXpForDeployments(3)).toBe(2);
    expect(botXpForDeployments(99)).toBe(BOT_CARD_XP_PER_CARD_CAP);
  });

  it("keeps the release flag off by default and requires bot Gold", () => {
    expect(botCardXpReleaseEnabled({})).toBe(false);
    expect(botCardXpReleaseEnabled({ UNRANKED_BOT_CARD_XP_ENABLED: "1" })).toBe(false);
    expect(botCardXpReleaseEnabled({ UNRANKED_BOT_GOLD_REWARDS_ENABLED: "1" })).toBe(false);
    expect(botCardXpReleaseEnabled({
      UNRANKED_BOT_CARD_XP_ENABLED: "1",
      UNRANKED_BOT_GOLD_REWARDS_ENABLED: "1",
    })).toBe(true);
  });

  it("caps a fallback match at six XP with deterministic card ordering", () => {
    const units = allocateBotCardXp([
      { cardId: "zeta", deployments: 3 },
      { cardId: "alpha", deployments: 3 },
      { cardId: "beta", deployments: 3 },
      { cardId: "gamma", deployments: 3 },
    ]);
    expect(units).toEqual([
      { cardId: "alpha", deployments: 3, xp: 2 },
      { cardId: "beta", deployments: 3, xp: 2 },
      { cardId: "gamma", deployments: 3, xp: 2 },
    ]);
    expect(units.reduce((sum, unit) => sum + unit.xp, 0)).toBe(BOT_CARD_XP_MATCH_TOTAL_CAP);
  });

  it("counts only accepted ordinary cards from the server-assigned human seat", () => {
    const commands: CombatCommand[] = [
      acceptedCommand(1, 1, "choglings"),
      acceptedCommand(2, 0, "choglings"),
      acceptedCommand(3, 0, commanderCardId("free-scout")),
      { kind: "ability", seq: 4, player: 0, tick: 4, abilityId: "scout-pathfinder" },
      acceptedCommand(5, 0, "rift_runner"),
    ];
    const counts = extractBotDeployments(commands, new Set([5]), 0);
    expect([...counts.entries()]).toEqual([["choglings", 1]]);
  });
});

describe("V2.1i bot Card XP ledger", () => {
  it("requires confirmed Gold, writes shared progression, and is idempotent", async () => {
    const p = await player("confirmed");
    const { session, humanSeat } = playGame(mediumPolicy, "41", p.id);
    expect(session.phase).toBe("finished");
    const matchId = randomUUID();
    const ev = evidenceFor(matchId, p.id, session, humanSeat);
    await trackEvidence(ev);
    const result = session.replay!.winner === "draw" ? "draw" : session.replay!.winner === humanSeat ? "win" : "loss";
    await stageBotGoldAward({
      matchId,
      playerId: p.id,
      amount: botGoldForResult(result),
      result,
      difficulty: "medium",
      policyVersion: BOT_GOLD_POLICY_VERSION,
    });

    const service = new BotCardXpService();
    const first = await service.processMatch(matchId);
    expect(first.status).toBe("confirmed");
    expect(first.totalXp).toBeGreaterThan(0);
    expect(first.totalXp).toBeLessThanOrEqual(BOT_CARD_XP_MATCH_TOTAL_CAP);
    const rows = await getBotXpAwards(matchId, p.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.reduce((sum, row) => sum + row.xp, 0)).toBe(first.totalXp);

    const second = await service.processMatch(matchId);
    expect(second.status).toBe("confirmed");
    expect(second.eligibility).toBe("duplicate");
    expect(second.totalXp).toBe(first.totalXp);
    const progress = await getMyCardXp(p.id);
    expect(progress.cards.reduce((sum, card) => sum + card.xp, 0)).toBe(first.totalXp);
  }, 240_000);

  it("does not backfill evidence recorded before the XP flag", async () => {
    const p = await player("preflag");
    const { session, humanSeat } = playGame(mediumPolicy, "42", p.id);
    const matchId = randomUUID();
    await trackEvidence(evidenceFor(matchId, p.id, session, humanSeat, false));
    const out = await new BotCardXpService().processMatch(matchId);
    expect(out.status).toBe("refused");
    expect(out.eligibility).toBe("not-xp-eligible");
    expect(await getBotXpAwards(matchId, p.id)).toEqual([]);
  }, 240_000);

  it("closes a pending XP run when the shared Gold outcome is capped", async () => {
    const p = await player("capped");
    const { session, humanSeat } = playGame(mediumPolicy, "43", p.id);
    const matchId = randomUUID();
    await trackEvidence(evidenceFor(matchId, p.id, session, humanSeat));
    const service = new BotCardXpService();
    expect((await service.processMatch(matchId)).status).toBe("pending");
    await getDb().update(botMatches).set({ status: "capped" }).where(eq(botMatches.matchId, matchId));
    const out = await service.processMatch(matchId);
    expect(out.status).toBe("capped");
    expect(out.eligibility).toBe("capped");
    expect((await getDb().select().from(botCardXpRuns).where(eq(botCardXpRuns.matchId, matchId))).map((r) => r.status)).toEqual(["capped"]);
  }, 240_000);
});

describe("V2.1i bot Card XP service lifecycle", () => {
  it("uses one process-level service so restart recovery and shutdown share the sweeper", () => {
    expect(botCardXpService()).toBe(botCardXpService());
  });
});
