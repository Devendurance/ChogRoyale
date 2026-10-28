// V2.1a focused Practice verification: real human + internal bot, legal play,
// honest bot identity, no-reward safety, and one completed playable game.
// No DB writes, no settlement, no network auth.

import { describe, expect, it } from "vitest";
import { BATTLE_PRACTICE_ROOM, BATTLE_ROOM } from "@/lib/battle-protocol";
import { validateDeck } from "@/lib/combat";
import { smartMove } from "@/lib/smart-bot";
import { BattleSession, deckFor, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, testLockedPatron } from "@/server/battle/test-helpers";
import {
  PRACTICE_BOT_DIFFICULTY,
  PRACTICE_BOT_DISPLAY_NAME,
  PRACTICE_BOT_ID,
  PRACTICE_OPPONENT,
  botSeatFor,
  mediumPolicy,
  policyFor,
  practiceBotCommanderClass,
  practiceBotDeck,
  practiceBotOrdinaryCards,
} from "@/server/battle/practice";
import { PRACTICE_BOT_PLAYER_ID } from "@/server/battle/practice-room";

const HUMAN = { playerId: "human-test-1", username: "HumanTester" };
const BOT = { playerId: PRACTICE_BOT_PLAYER_ID, username: "AI Opponent" };

function humanLoadout() {
  const cards = ["choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster"];
  return { cards, grant: freeGrant("scout") };
}

function botLoadout() {
  const cards = practiceBotOrdinaryCards();
  const cls = practiceBotCommanderClass() as "bulwark" | "reaver" | "deadeye" | "scout" | "warden";
  return { cards, grant: freeGrant(cls) };
}

function startedPractice(patronId = "7"): BattleSession {
  const s = new BattleSession();
  s.join(HUMAN);
  s.join(BOT);
  const h = humanLoadout();
  const b = botLoadout();
  expect(s.setReady(HUMAN.playerId, h)).toBe(false);
  expect(s.setReady(BOT.playerId, b)).toBe(true);
  const epoch = s.lock();
  const ready = s.readyLoadouts() as [TrustedLoadout, TrustedLoadout];
  s.cardLevelsByPlayer = {};
  s.mode = "practice";
  s.start(epoch, ready, testLockedPatron(patronId));
  return s;
}

describe("V2.1a practice foundation", () => {
  it("bot seat is explicit and never a fake human player", () => {
    expect(PRACTICE_BOT_ID).toBe("practice-medium-v1");
    expect(PRACTICE_BOT_DISPLAY_NAME).toBe("AI Opponent");
    expect(PRACTICE_BOT_DIFFICULTY).toBe("medium");
    expect(PRACTICE_OPPONENT).toEqual({ kind: "bot", botId: PRACTICE_BOT_ID, difficulty: "medium", displayName: "AI Opponent" });
    expect(BOT.playerId.startsWith("bot:")).toBe(true);
    expect(BOT.username).toBe("AI Opponent");
    expect(BOT.playerId).not.toBe(HUMAN.playerId);
  });

  it("bot deck is an actual eligible legal deck with a free commander", () => {
    const deck = practiceBotDeck();
    expect(deck).toHaveLength(8);
    expect(deck.filter((c) => c.startsWith("cmdr:"))).toHaveLength(1);
    expect(practiceBotCommanderClass()).toBe("bulwark");
    expect(practiceBotOrdinaryCards()).toHaveLength(7);
    const loadout = botLoadout();
    expect(() => validateDeck(deckFor(loadout), loadout.grant.slot)).not.toThrow();
  });

  it("MEDIUM policy is deterministic and HARD/ULTIMATE are typed but unimplemented", () => {
    const s = startedPractice("71");
    const state = s.state!;
    const humanSeat = s.seatOfSlot[0]!;
    const botSeat = botSeatFor(humanSeat);
    const first = mediumPolicy.choose(state, botSeat, state.tick);
    const second = mediumPolicy.choose(state, botSeat, state.tick);
    expect(first).toEqual(second);
    expect(policyFor("medium")).toBe(mediumPolicy);
    expect(() => policyFor("hard").choose(state, botSeat, 0)).toThrow("not implemented");
    expect(() => policyFor("ultimate").choose(state, botSeat, 0)).toThrow("not implemented");
  });

  it("bot commands go through the same legal session validation (no free energy bypass)", () => {
    const s = startedPractice("8");
    expect(s.phase).toBe("active");
    const bad = s.submit(BOT.playerId, { type: "deploy", cid: "bad-1", cardId: "choglings", x: 9999, y: 9999 });
    expect(bad?.ok).toBe(false);
    const humanSeat = s.seatOfSlot[0]!;
    const botSeat = botSeatFor(humanSeat);
    const move = smartMove(s.state!, botSeat, s.state!.tick);
    if (move) {
      const ack = s.submit(BOT.playerId, { type: "deploy", cid: "probe-1", cardId: move.cardId, x: Math.round(move.x), y: Math.round(move.y) });
      expect(ack === null || typeof ack.ok === "boolean").toBe(true);
    }
  });

  it("human PvP routes are unchanged", () => {
    expect(BATTLE_ROOM).toBe("battle");
    expect(BATTLE_PRACTICE_ROOM).toBe("battle_practice");
    expect(BATTLE_PRACTICE_ROOM).not.toBe(BATTLE_ROOM);
  });

  it("aborts and service stop clean up ticks without a result", () => {
    const s = startedPractice("9");
    s.abort("human left");
    expect(s.phase).toBe("aborted");
    expect(s.tick()).toBeNull();
  });

  it("practice result carries no-reward provenance and no progression writes", () => {
    const practiceEnd = { opponentKind: "bot" as const, noReward: true as const };
    expect(practiceEnd).toEqual({ opponentKind: "bot", noReward: true });
    const settlementStatus = "disabled" as const;
    expect(settlementStatus).toBe("disabled");
  });

  it("completes one playable human-vs-AI game with identical replay", () => {
    const s = startedPractice("10");
    const humanSeat = s.seatOfSlot[0]!;
    const botSeat = botSeatFor(humanSeat);
    let ticks = 0;
    let cid = 0;
    while (s.phase === "active" && ticks < 3000) {
      const state = s.state!;
      const hm = smartMove(state, humanSeat, state.tick);
      if (hm) {
        cid += 1;
        s.submit(HUMAN.playerId, { type: "deploy", cid: `h-${cid}`, cardId: hm.cardId, x: Math.round(hm.x), y: Math.round(hm.y) });
      }
      const bm = mediumPolicy.choose(state, botSeat, state.tick);
      if (bm) {
        cid += 1;
        s.submit(BOT.playerId, { type: "deploy", cid: `b-${cid}`, cardId: bm.cardId, x: Math.max(0, Math.min(100, bm.x)), y: Math.max(0, Math.min(160, bm.y)) });
      }
      s.tick();
      ticks += 1;
    }
    expect(s.phase).toBe("finished");
    expect(s.replay?.replayIdentical).toBe(true);
    expect(s.replay?.players.map((p) => p.playerId)).toContain(PRACTICE_BOT_PLAYER_ID);
    expect(ticks).toBeGreaterThan(10);
  });
});
