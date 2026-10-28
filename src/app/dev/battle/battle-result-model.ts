// Pure finale view model. Reads only the server EndMessage, the abort reason
// and the settlement message. Nothing here invents a score, reward or record.
import type { EndMessage, MatchMode, PracticeDifficulty, SettlementMessage, StartMessage } from "@/lib/battle-protocol";

export type FinaleResult = "win" | "loss" | "draw" | "abort";
export type SettlementState = "waiting" | "recorded" | "pending" | "disabled" | "refused";
export type FinaleOrigin = "human" | "practice" | "unranked-fallback";

export interface FinaleView {
  result: FinaleResult;
  /** The server-owned source of this result, including the Unranked fallback. */
  origin: FinaleOrigin;
  /** True for either server-owned AI origin, not for human PvP. */
  practice: boolean;
  title: string;
  kicker: string;
  mine: number;
  theirs: number;
  /** Which ribbon carries the winner badge. Null for a draw or an abort. */
  winner: "mine" | "theirs" | null;
  context: string;
  settlement: { state: SettlementState; text: string } | null;
  /** Explicit copy for either server-owned AI origin. */
  noRewards: string | null;
  /** Result action copy. The caller still decides whether a callback exists. */
  againLabel: "Battle Again" | "Find Opponent Again" | null;
  /** Lead-in before the finale appears, so a Core's crown flight lands first. */
  revealDelayMs: number;
}

export const PRACTICE_NO_REWARDS = "No rewards or progression are awarded in Practice.";
export const UNRANKED_FALLBACK_NO_REWARDS = "No rewards earned in this AI battle.";
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
export function opponentNameFor(
  start: Pick<StartMessage, "mode" | "opponent" | "practiceOpponent">,
  practice = start.mode === "practice" || start.practiceOpponent?.source === "practice" || start.practiceOpponent?.source === "unranked-fallback",
): string {
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

function finaleOriginFor(
  end: EndMessage | null,
  mode: MatchMode,
  opponentSource?: "practice" | "unranked-fallback",
): FinaleOrigin {
  const source = end?.practice?.source ?? opponentSource;
  if (source === "unranked-fallback") return "unranked-fallback";
  if (source === "practice" || end?.practice?.noReward === true || mode === "practice") return "practice";
  return "human";
}

export function finaleView(
  end: EndMessage | null,
  abort: string | null,
  me: number,
  settlement: SettlementMessage | null,
  ticksPerSecond: number,
  mode: MatchMode = "private",
  opponentSource?: "practice" | "unranked-fallback",
): FinaleView {
  const origin = finaleOriginFor(end, mode, opponentSource);
  const practice = origin !== "human";
  const noRewards = origin === "practice" ? PRACTICE_NO_REWARDS : origin === "unranked-fallback" ? UNRANKED_FALLBACK_NO_REWARDS : null;
  const againLabel = origin === "practice" ? "Battle Again" : origin === "unranked-fallback" ? "Find Opponent Again" : null;
  if (!end) {
    return {
      result: "abort",
      origin,
      practice,
      title: "Battle interrupted",
      kicker: origin === "practice" ? "Practice · AI Opponent" : origin === "unranked-fallback" ? "Unranked · AI Opponent" : "Connection ended",
      mine: 0,
      theirs: 0,
      winner: null,
      context: abort || "The match ended early.",
      settlement: null,
      noRewards,
      againLabel,
      revealDelayMs: 150,
    };
  }
  const mine = end.crowns[me] ?? 0;
  const theirs = end.crowns[1 - me] ?? 0;
  const seconds = Math.floor(end.ticks / Math.max(1, ticksPerSecond));
  return {
    result: end.result,
    origin,
    practice,
    title: end.result === "win" ? "Victory" : end.result === "loss" ? "Defeat" : "Draw",
    kicker: origin === "practice" ? "Practice complete · AI Opponent" : origin === "unranked-fallback" ? "Unranked · AI Opponent" : "Battle complete",
    mine,
    theirs,
    winner: end.result === "win" ? "mine" : end.result === "loss" ? "theirs" : null,
    context: `${REASONS[end.reason ?? ""] ?? "Battle complete"} · ${clock(seconds)}`,
    settlement: practice ? null : settlementView(settlement),
    noRewards,
    againLabel,
    revealDelayMs: end.reason === "core" ? 1500 : 700,
  };
}

/** Crowns light one step at a time on both ribbons together. */
export function tallyAt(step: number, final: number): number {
  return Math.max(0, Math.min(final, Math.floor(step)));
}
