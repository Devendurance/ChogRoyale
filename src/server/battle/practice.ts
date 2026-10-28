// V2.1a Practice foundation: server-owned human-vs-AI.
// One human (Privy-verified, real saved deck/commander) plus one internal
// bot seat. The bot is never a DB player, never a Privy identity, never a
// players row, and never routed through PvP settlement.
// V2.1a ships MEDIUM only (smartMove). HARD/ULTIMATE are typed interfaces
// for a later slice and throw if selected.

import { smartMove } from "@/lib/smart-bot";
import { DECKS_V13 } from "@/lib/bot-economy";
import { isCommanderCard } from "@/lib/combat";
import type { CombatState, PlayerIndex } from "@/lib/combat";
import type { PracticeDifficulty, PracticeOpponent } from "@/lib/battle-protocol";

/** Authored Practice bot identity. Stable across lobby/start/reconnect/end. */
export const PRACTICE_BOT_ID = "practice-medium-v1" as const;
export const PRACTICE_BOT_DIFFICULTY: PracticeDifficulty = "medium";
export const PRACTICE_BOT_DISPLAY_NAME = "AI Opponent" as const;

/** Server-owned opponent descriptor. The UX shows displayName only. */
export const PRACTICE_OPPONENT: PracticeOpponent = {
  kind: "bot",
  botId: PRACTICE_BOT_ID,
  difficulty: PRACTICE_BOT_DIFFICULTY,
  displayName: PRACTICE_BOT_DISPLAY_NAME,
};

/**
 * Actual eligible legal bot deck from the existing catalog (turret archetype,
 * free Bulwark commander). 8 engine cards: 7 ordinary + commander last.
 * Validated by validateDeck in tests and at room start.
 */
export function practiceBotDeck(): string[] {
  return [...DECKS_V13.turret!];
}

/** Ordinary (non-commander) cards of the bot deck, for evidence checks. */
export function practiceBotOrdinaryCards(): string[] {
  return practiceBotDeck().filter((c) => !isCommanderCard(c));
}

/** Free commander class fielded by the bot. */
export function practiceBotCommanderClass(): string {
  const cmd = practiceBotDeck().find((c) => isCommanderCard(c)) ?? "cmdr:free-bulwark";
  return cmd.replace(/^cmdr:free-/, "");
}

// --- Difficulty policy interfaces (V2.1a: MEDIUM only) ---

export type PracticeMove = { cardId: string; x: number; y: number } | null;

export interface PracticePolicy {
  difficulty: PracticeDifficulty;
  /** Pure move choice from authoritative state. Null = hold this tick. */
  choose(state: CombatState, seat: PlayerIndex, laneSeed: number): PracticeMove;
}

/** MEDIUM: deterministic smartMove adapter. Same legal inputs as a human. */
export const mediumPolicy: PracticePolicy = {
  difficulty: "medium",
  choose: (state, seat, laneSeed) => {
    const m = smartMove(state, seat, laneSeed);
    return m ? { cardId: m.cardId, x: Math.round(m.x), y: Math.round(m.y) } : null;
  },
};

/** HARD: typed for V2.1b+, not implemented in V2.1a. */
export const hardPolicy: PracticePolicy = {
  difficulty: "hard",
  choose: () => {
    throw new Error("Practice HARD is not implemented in V2.1a");
  },
};

/** ULTIMATE: typed for a later slice, not implemented in V2.1a. */
export const ultimatePolicy: PracticePolicy = {
  difficulty: "ultimate",
  choose: () => {
    throw new Error("Practice ULTIMATE is not implemented in V2.1a");
  },
};

export function policyFor(difficulty: PracticeDifficulty): PracticePolicy {
  switch (difficulty) {
    case "medium":
      return mediumPolicy;
    case "hard":
      return hardPolicy;
    case "ultimate":
      return ultimatePolicy;
    default:
      throw new Error(`Unknown practice difficulty: ${String(difficulty)}`);
  }
}

/** Resolve the bot seat from the shuffled seats. The human seat is known. */
export function botSeatFor(humanSeat: PlayerIndex): PlayerIndex {
  return humanSeat === 0 ? 1 : 0;
}
