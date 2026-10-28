// V2.1g Unranked AI fallback Gold policy, provisional V1 numbers. Off-chain
// game currency only: no blockchain token, no $CHOG, no real-money purchases.
// Client-safe: no engine, DB or server imports. Solo Practice always earns
// zero; only server-verified Unranked fallback matches qualify.

/** Bot Gold policy version. Stored on every award row for future changes. */
export const BOT_GOLD_POLICY_VERSION = 1;

/** Reduced fallback Gold per verified match, by the human's own result. */
export const BOT_GOLD_WIN_REWARD = 20;
export const BOT_GOLD_LOSS_REWARD = 10;
export const BOT_GOLD_DRAW_REWARD = 15;

/** Maximum rewarded fallback matches per player per UTC calendar day. */
export const BOT_GOLD_DAILY_CAP = 5;

/** Minimum actual combat: 60 seconds at 10 ticks per second. */
export const BOT_GOLD_MIN_TICKS = 600;

/** Minimum accepted human ordinary-card deployments in the match. */
export const BOT_GOLD_MIN_HUMAN_DEPLOYS = 3;

/** Minimum-gameplay gates on verified authoritative evidence. Replay integrity is checked separately. */
export function botGoldGate(ticks: number, acceptedHumanDeploys: number): "eligible" | "short-match" | "too-few-deploys" {
  if (ticks < BOT_GOLD_MIN_TICKS) return "short-match";
  if (acceptedHumanDeploys < BOT_GOLD_MIN_HUMAN_DEPLOYS) return "too-few-deploys";
  return "eligible";
}

export function botGoldForResult(result: "win" | "loss" | "draw"): number {
  if (result === "win") return BOT_GOLD_WIN_REWARD;
  if (result === "loss") return BOT_GOLD_LOSS_REWARD;
  return BOT_GOLD_DRAW_REWARD;
}

/** Why a fallback match earned Gold or did not. */
export type BotGoldEligibility =
  | "eligible"
  | "practice-earns-zero"
  | "short-match"
  | "too-few-deploys"
  | "replay-mismatch"
  | "duplicate"
  | "capped";

/** Authoritative reward outcome for one fallback match. */
export interface BotGoldResult {
  matchId: string;
  source: "unranked-fallback";
  eligibility: BotGoldEligibility;
  policyVersion: number;
  /** Confirmed spendable Gold. Zero unless status is confirmed. */
  amount: number;
  status: "confirmed" | "pending" | "refused" | "capped";
  /** Bot matches rewarded to this player today (UTC), including this one when confirmed. */
  rewardedToday: number;
  dailyCap: number;
}
