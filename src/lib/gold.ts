// P2b Gold economy policy, provisional TEST numbers. Off-chain game
// currency only: no blockchain token, no $CHOG, no real-money purchases.
// Client-safe: no engine, DB or server imports.
export const GOLD_POLICY_VERSION = 1;

/** Gold earned per verified matchmaking/ranked match, by own result. */
export const GOLD_WIN_REWARD = 60;
export const GOLD_LOSS_REWARD = 30;
export const GOLD_DRAW_REWARD = 40;
/** Private rooms earn zero until farming protection is approved. */
export const GOLD_PRIVATE_REWARD = 0;

export function goldRewardForResult(result: "win" | "loss" | "draw"): number {
  if (result === "win") return GOLD_WIN_REWARD;
  if (result === "loss") return GOLD_LOSS_REWARD;
  return GOLD_DRAW_REWARD;
}

export interface GoldEarnView {
  matchId: string;
  matchType: string;
  result: "win" | "loss" | "draw";
  amount: number;
  finishedAt: string | null;
}

export interface GoldSpendView {
  idempotencyKey: string;
  cardId: string;
  fromLevel: number;
  toLevel: number;
  cost: number;
  createdAt: string | null;
}

export interface GoldBalanceResponse {
  policyVersion: number;
  balance: number;
  earned: number;
  spent: number;
  recentEarn: GoldEarnView[];
  recentSpends: GoldSpendView[];
}

export interface CardUpgradeRequest {
  cardId: string;
  /** Must equal the current purchased level; guards stale retries. */
  expectedLevel: number;
  /** Client-generated uuid; retries with the same key never double-charge. */
  idempotencyKey: string;
}

export type CardUpgradeStatus =
  | "upgraded"
  | "duplicate"
  | "invalid-card"
  | "level-mismatch"
  | "maxed"
  | "insufficient-xp"
  | "insufficient-gold"
  | "conflict-retry";

export interface CardUpgradeResponse {
  status: CardUpgradeStatus;
  cardId: string;
  purchasedLevel: number;
  goldCost: number | null;
  balance: number;
}
