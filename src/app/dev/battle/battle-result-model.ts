// Pure finale view model. Reads only the server EndMessage, the abort reason
// and the settlement message. Nothing here invents a score, reward or record.
import type { EndMessage, MatchMode, PracticeDifficulty, SettlementMessage, StartMessage } from "@/lib/battle-protocol";

export type FinaleResult = "win" | "loss" | "draw" | "abort";
export type SettlementState = "waiting" | "recorded" | "pending" | "disabled" | "refused";

export interface FinaleView {
  result: FinaleResult;
  /** Practice is a server-owned mode, not a PvP settlement variant. */
  practice: boolean;
  title: string;
  kicker: string;
  mine: number;
  theirs: number;
  /** Which ribbon carries the winner badge. Null for a draw or an abort. */
  winner: "mine" | "theirs" | null;
  context: string;
  settlement: { state: SettlementState; text: string } | null;
  /** Explicit copy for the no-reward Practice foundation slice. */
  noRewards: string | null;
  /** Lead-in before the finale appears, so a Core's crown flight lands first. */
  revealDelayMs: number;
}

const PRACTICE_NO_REWARDS = "No rewards or progression are awarded in Practice.";
export const PRACTICE_OPPONENT = "AI Opponent";

const PRACTICE_DIFFICULTY_NAMES: Record<PracticeDifficulty, string> = {
  medium: "Medium",
  hard: "Hard",
  ultimate: "Ultimate",
};

/** Format only a difficulty that the server contract explicitly supports. */
export function practiceDifficultyLabel(difficulty: PracticeDifficulty | null | undefined): string | null {
  if (!difficulty || !(difficulty in PRACTICE_DIFFICULTY_NAMES)) return null;
  return PRACTICE_DIFFICULTY_NAMES[difficulty];
}

/** Resolve the player-facing opponent identity without trusting a bot username. */
export function opponentNameFor(start: Pick<StartMessage, "mode" | "opponent" | "practiceOpponent">, practice = start.mode === "practice"): string {
  // The bot display name is a protocol identity, not a player-controlled
  // username. Keep the player-facing label stable even if an older or
  // malformed payload carries a different string.
  return practice ? PRACTICE_OPPONENT : start.opponent;
}

const REASONS: Record<string, string> = { core: "Core broken", crowns: "Crown lead", overtime: "Overtime tiebreak", timeout: "Time expired" };

export function settlementView(value: SettlementMessage | null): { state: SettlementState; text: string } {
  if (!value) return { state: "waiting", text: "Waiting for result confirmation" };
  if (value.status === "settled" || value.status === "already-settled") return { state: "recorded", text: "Result recorded" };
  if (value.status === "pending") return { state: "pending", text: "Result pending. Retrying in the background." };
  if (value.status === "disabled") return { state: "disabled", text: "Result recording is unavailable on this server." };
  return { state: "refused", text: "Result could not be verified." };
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function finaleView(
  end: EndMessage | null,
  abort: string | null,
  me: number,
  settlement: SettlementMessage | null,
  ticksPerSecond: number,
  mode: MatchMode = "private",
): FinaleView {
  const practice = mode === "practice" || end?.practice?.noReward === true;
  if (!end) {
    return {
      result: "abort",
      practice,
      title: "Battle interrupted",
      kicker: practice ? "Practice · AI Opponent" : "Connection ended",
      mine: 0,
      theirs: 0,
      winner: null,
      context: abort || "The match ended early.",
      settlement: null,
      noRewards: practice ? PRACTICE_NO_REWARDS : null,
      revealDelayMs: 150,
    };
  }
  const mine = end.crowns[me] ?? 0;
  const theirs = end.crowns[1 - me] ?? 0;
  const seconds = Math.floor(end.ticks / Math.max(1, ticksPerSecond));
  return {
    result: end.result,
    practice,
    title: end.result === "win" ? "Victory" : end.result === "loss" ? "Defeat" : "Draw",
    kicker: practice ? "Practice complete · AI Opponent" : "Battle complete",
    mine,
    theirs,
    winner: end.result === "win" ? "mine" : end.result === "loss" ? "theirs" : null,
    context: `${REASONS[end.reason ?? ""] ?? "Battle complete"} · ${clock(seconds)}`,
    settlement: practice ? null : settlementView(settlement),
    noRewards: practice ? PRACTICE_NO_REWARDS : null,
    revealDelayMs: end.reason === "core" ? 1500 : 700,
  };
}

/** Crowns light one step at a time on both ribbons together. */
export function tallyAt(step: number, final: number): number {
  return Math.max(0, Math.min(final, Math.floor(step)));
}
