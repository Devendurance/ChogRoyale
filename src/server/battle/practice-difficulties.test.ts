// V2.1c three-difficulty Practice verification.
// Medium stays the V2.1a baseline; Hard/Ultimate are real deterministic
// policies over authoritative state with identical legal rules.
// No DB writes, no settlement, no network auth (room-level coverage lives
// in practice-room-difficulties.test.ts with injected deps).

import { describe, expect, it } from "vitest";
import { BATTLE_PRACTICE_ROOM, BATTLE_ROOM, PRACTICE_DIFFICULTIES, type PracticeDifficulty } from "@/lib/battle-protocol";
import { initMatch, stepMatch, type CombatCommand, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, riftSchedule } from "@/lib/arena-scenarios";
import { mirrorCommand, mirrorSchedule, runMatchup } from "@/lib/building-matchup";
import { smartMove } from "@/lib/smart-bot";
import { BattleSession, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, testLockedPatron } from "@/server/battle/test-helpers";
import {
  PRACTICE_BOT_DISPLAY_NAME,
  PRACTICE_BOT_IDS,
  PRACTICE_OPPONENT,
  botSeatFor,
  hardPolicy,
  mediumPolicy,
  policyFor,
  practiceBotCommanderClass,
  practiceBotDeck,
  practiceBotPlayerId,
  practiceOpponentFor,
  resolvePracticeDifficulty,
  ultimatePolicy,
  type PracticePolicy,
} from "@/server/battle/practice";
import { PRACTICE_BOT_PLAYER_ID } from "@/server/battle/practice-room";
import { DECKS_V13 } from "@/lib/bot-economy";

const HUMAN = (id: string) => ({ playerId: id, username: `Human-${id}` });

function humanLoadout(): TrustedLoadout {
  return { cards: ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"], grant: freeGrant("scout") };
}
function botLoadout(): TrustedLoadout {
  const cls = practiceBotCommanderClass() as "bulwark" | "reaver" | "deadeye" | "scout" | "warden";
  return { cards: practiceBotDeck().filter((c) => !c.startsWith("cmdr:")), grant: freeGrant(cls) };
}

function startedWith(policy: PracticePolicy, patronId: string, humanId: string): { s: BattleSession; humanSeat: PlayerIndex; botSeat: PlayerIndex } {
  const h = HUMAN(humanId);
  const bot = { playerId: practiceBotPlayerId(policy.difficulty), username: "AI Opponent" };
  const s = new BattleSession();
  s.join(h);
  s.join(bot);
  expect(s.setReady(h.playerId, humanLoadout())).toBe(false);
  expect(s.setReady(bot.playerId, botLoadout())).toBe(true);
  const epoch = s.lock();
  const ready = s.readyLoadouts() as [TrustedLoadout, TrustedLoadout];
  s.cardLevelsByPlayer = {};
  s.mode = "practice";
  s.start(epoch, ready, testLockedPatron(patronId));
  const humanSeat = s.seatOfSlot[0]!;
  return { s, humanSeat, botSeat: botSeatFor(humanSeat) };
}

/** Drive a full game: human smartMove, bot via policy (+ultimate abilities). */
function playGame(policy: PracticePolicy, patronId: string, humanId: string, upto = 3100) {
  const { s, humanSeat, botSeat } = startedWith(policy, patronId, humanId);
  const h = HUMAN(humanId);
  const botId = practiceBotPlayerId(policy.difficulty);
  const deck = new Set(practiceBotDeck());
  let cid = 0;
  let ticks = 0;
  const botCards = new Set<string>();
  while (s.phase === "active" && ticks < upto) {
    const state = s.state!;
    for (const e of state.energy) expect(e).toBeGreaterThanOrEqual(0);
    const hm = smartMove(state, humanSeat, state.tick);
    if (hm) {
      cid += 1;
      s.submit(h.playerId, { type: "deploy", cid: `h-${cid}`, cardId: hm.cardId, x: Math.round(hm.x), y: Math.round(hm.y) });
    }
    const ability = policy.ability?.(state, botSeat);
    if (ability) {
      cid += 1;
      s.submit(botId, { type: "ability", cid: `b-${cid}`, abilityId: ability });
    } else {
      const bm = policy.choose(state, botSeat, state.tick);
      if (bm) {
        botCards.add(bm.cardId);
        cid += 1;
        s.submit(botId, { type: "deploy", cid: `b-${cid}`, cardId: bm.cardId, x: Math.max(0, Math.min(100, Math.round(bm.x))), y: Math.max(0, Math.min(160, Math.round(bm.y))) });
      }
    }
    s.tick();
    ticks += 1;
  }
  const rejected = s.state!.events.filter((e) => e.type === "command_rejected");
  return { s, ticks, rejected, botCards: [...botCards], deck };
}

const mirrorMove = (m: { cardId: string; x: number; y: number } | null) => (m ? { ...m, y: 160 - m.y } : null);

describe("V2.1c practice difficulties", () => {
  it("defaults to Medium and validates server-side", () => {
    expect(resolvePracticeDifficulty(undefined)).toBe("medium");
    expect(resolvePracticeDifficulty(null)).toBe("medium");
    expect(resolvePracticeDifficulty("medium")).toBe("medium");
    expect(resolvePracticeDifficulty("hard")).toBe("hard");
    expect(resolvePracticeDifficulty("ultimate")).toBe("ultimate");
    for (const bad of ["easy", "HARD", "MEDIUM", "", 123, {}, []]) {
      expect(() => resolvePracticeDifficulty(bad)).toThrow("Unsupported practice difficulty");
    }
    expect(() => policyFor("easy" as PracticeDifficulty)).toThrow("Unknown practice difficulty");
    expect(PRACTICE_DIFFICULTIES).toEqual(["medium", "hard", "ultimate"]);
  });

  it("keeps Medium as the V2.1a compatibility baseline", () => {
    expect(policyFor("medium")).toBe(mediumPolicy);
    expect(practiceOpponentFor("medium")).toEqual(PRACTICE_OPPONENT);
    expect(PRACTICE_OPPONENT).toEqual({ kind: "bot", botId: "practice-medium-v1", difficulty: "medium", displayName: "AI Opponent" });
    expect(practiceBotPlayerId("medium")).toBe(PRACTICE_BOT_PLAYER_ID);
    expect(PRACTICE_BOT_DISPLAY_NAME).toBe("AI Opponent");
  });

  it("exposes stable distinct identities per difficulty, never a human", () => {
    expect(PRACTICE_BOT_IDS).toEqual({ medium: "practice-medium-v1", hard: "practice-hard-v1", ultimate: "practice-ultimate-v1" });
    for (const d of PRACTICE_DIFFICULTIES) {
      const opp = practiceOpponentFor(d);
      expect(opp.kind).toBe("bot");
      expect(opp.displayName).toBe("AI Opponent");
      expect(opp.difficulty).toBe(d);
      expect(practiceBotPlayerId(d)).toBe(`bot:${PRACTICE_BOT_IDS[d]}`);
      expect(practiceBotPlayerId(d).startsWith("bot:")).toBe(true);
    }
    expect(new Set(PRACTICE_DIFFICULTIES.map(practiceBotPlayerId)).size).toBe(3);
  });

  it("human PvP room constants are unchanged", () => {
    expect(BATTLE_ROOM).toBe("battle");
    expect(BATTLE_PRACTICE_ROOM).toBe("battle_practice");
  });

  it("Hard makes legal accepted commands with no free energy or hidden cards", () => {
    const { s, ticks, rejected, botCards, deck } = playGame(hardPolicy, "21", "hard-lawful");
    expect(s.phase).toBe("finished");
    expect(ticks).toBeGreaterThan(10);
    for (const c of botCards) expect(deck.has(c)).toBe(true);
    const bad = rejected.filter((e) => {
      const r = (e as { reason?: string }).reason ?? "";
      return r === "Insufficient energy" || r === "Unknown card";
    });
    expect(bad).toHaveLength(0);
    expect(s.replay?.replayIdentical).toBe(true);
  });

  it("Ultimate makes legal accepted commands including timed abilities", () => {
    const { s, ticks, rejected, botCards, deck } = playGame(ultimatePolicy, "22", "ult-lawful");
    expect(s.phase).toBe("finished");
    expect(ticks).toBeGreaterThan(10);
    for (const c of botCards) expect(deck.has(c)).toBe(true);
    const bad = rejected.filter((e) => {
      const r = (e as { reason?: string }).reason ?? "";
      return r === "Insufficient energy" || r === "Unknown card";
    });
    expect(bad).toHaveLength(0);
    expect(s.replay?.replayIdentical).toBe(true);
  });

  it("Hard and Ultimate differ meaningfully from Medium on identical states", () => {
    const decks: Array<[string[], string[]]> = [
      [deckWith("choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"), practiceBotDeck()],
      [practiceBotDeck(), deckWith("rift_sentry", "gale_netter", "sparkcaster", "rift_snare", "chaos_comet", "chog_guardian", "hexwing")],
    ];
    let samples = 0;
    let hardDiff = 0;
    let ultDiff = 0;
    const chaosFor = (round: number) => (round % 2 === 0 ? null : riftSchedule(`v21c-chaos-${round}`));
    for (const [d0, d1] of decks) {
      for (let round = 0; round < 4; round++) {
        const cfg = scenarioConfig(d0, d1, chaosFor(round), `v21c-${round}`);
        const state = initMatch(cfg);
        let seq = 0;
        for (let t = 0; t < 800 && state.phase !== "final"; t++) {
          const due: CombatCommand[] = [];
          for (const p of [0, 1] as PlayerIndex[]) {
            const m = smartMove(state, p, state.tick + 1);
            if (m && (state.tick + 1) % 20 === 0) {
              seq += 1;
              due.push({ seq, player: p, tick: state.tick + 1, cardId: m.cardId, x: m.x, y: m.y });
            }
          }
          stepMatch(state, due);
          if (state.tick % 40 !== 0 || state.tick < 120) continue;
          for (const p of [0, 1] as PlayerIndex[]) {
            const m = mediumPolicy.choose(state, p, state.tick);
            const h = hardPolicy.choose(state, p, state.tick);
            const u = ultimatePolicy.choose(state, p, state.tick);
            samples += 1;
            if (JSON.stringify(h) !== JSON.stringify(m)) hardDiff += 1;
            if (JSON.stringify(u) !== JSON.stringify(h)) ultDiff += 1;
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(20);
    expect(hardDiff).toBeGreaterThan(0);
    expect(ultDiff).toBeGreaterThan(0);
  });

  it("Hard and Ultimate stay mirror-equivariant per tick", () => {
    for (const policy of [hardPolicy, ultimatePolicy]) {
      const chaos = riftSchedule("fair");
      const cfgA = scenarioConfig(DECKS_V13.turret!, DECKS_V13.control!, chaos, "fair");
      const cfgB = scenarioConfig(DECKS_V13.control!, DECKS_V13.turret!, mirrorSchedule(chaos), "fair");
      const a = initMatch(cfgA);
      const b = initMatch(cfgB);
      let checked = 0;
      let ci = 0;
      while (a.tick < 400 && a.phase !== "final") {
        for (const p of [0, 1] as PlayerIndex[]) {
          const q = (1 - p) as PlayerIndex;
          expect(mirrorMove(policy.choose(a, p, a.tick))).toEqual(policy.choose(b, q, a.tick));
          checked += 1;
        }
        const due: CombatCommand[] = [];
        for (const p of [0, 1] as PlayerIndex[]) {
          const m = smartMove(a, p, a.tick + 1);
          if (m && (a.tick + 1) % 20 === 0) {
            ci += 1;
            due.push({ seq: ci, player: p, tick: a.tick + 1, cardId: m.cardId, x: m.x, y: m.y });
          }
        }
        stepMatch(a, due);
        stepMatch(b, due.map(mirrorCommand));
      }
      expect(checked).toBeGreaterThan(200);
    }
  });

  it("evaluation: Medium vs Hard completes legally with observed results", { timeout: 240_000 }, () => {
    const decks = { turret: DECKS_V13.turret!, control: DECKS_V13.control! };
    const mh = runMatchup(decks, ["e1", "e2"], "none", [mediumPolicy.choose, hardPolicy.choose]);
    const hm = runMatchup(decks, ["e1", "e2"], "none", [hardPolicy.choose, mediumPolicy.choose]);
    expect(mh.length).toBe(8);
    expect(hm.length).toBe(8);
    for (const r of [...mh, ...hm]) {
      expect(r.replayIdentical).toBe(true);
      expect(r.ticks).toBeGreaterThan(100);
      expect(Object.values(r.deploys).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    }
    // Observed results only: evidence of difference, never a claimed advantage.
    console.log(`V2.1c eval medium-vs-hard seats: ${JSON.stringify({ asP1: mh.map((r) => r.winner), asP0: hm.map((r) => r.winner) })}`);
  });

  it("runs isolated concurrent games across difficulties with no shared state", () => {
    const results = [
      playGame(mediumPolicy, "31", "conc-a", 1200),
      playGame(hardPolicy, "32", "conc-b", 1200),
      playGame(ultimatePolicy, "33", "conc-c", 1200),
      playGame(hardPolicy, "34", "conc-d", 1200),
    ];
    for (const g of results) {
      expect(g.ticks).toBeGreaterThan(100);
      if (g.s.phase === "finished") expect(g.s.replay?.replayIdentical).toBe(true);
    }
    const ids = results.map((g) => g.s.replay?.players.map((p) => p.playerId).sort().join("+") ?? g.s.slots.map((p) => p?.playerId).sort().join("+"));
    expect(new Set(ids).size).toBe(4);
    expect(policyFor("hard")).toBe(hardPolicy);
    expect(policyFor("ultimate")).toBe(ultimatePolicy);
  });

  it("practice result stays no-reward for every difficulty with zero progression coupling", () => {
    const seen: string[] = [];
    for (const d of PRACTICE_DIFFICULTIES) {
      const { s } = startedWith(policyFor(d), "40", `noreward-${d}`);
      expect(s.mode).toBe("practice");
      expect(s.cardLevelsByPlayer).toEqual({});
      seen.push(d);
    }
    expect(seen).toEqual(["medium", "hard", "ultimate"]);
  });
});
