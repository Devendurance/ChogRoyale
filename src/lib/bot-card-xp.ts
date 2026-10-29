// V2.1i Verified Unranked AI Card XP, provisional V1 numbers. Off-chain
// game currency only: no blockchain token, no $CHOG, no real-money purchases.
// Client-safe: no engine, DB or server imports.
//
// One accepted human ordinary-card deployment earns 1 XP. A third accepted
// deployment of the same card earns 1 more XP. Cap: 2 XP per card per match,
// 6 XP total per match. Commander cards, abilities, rejected or bot-owned
// deployments, spawned-only ids, unknown ids and undeployed deck cards
// earn nothing. Medium and Hard share this policy.

/** Bot Card XP policy version. Stored on every award row. */
export const BOT_CARD_XP_POLICY_VERSION = 1;

/**
 * Release gate for fallback Card XP. XP stays off by default and cannot be
 * enabled independently of the already-approved bot Gold gate.
 */
export function botCardXpReleaseEnabled(env: {
  UNRANKED_BOT_CARD_XP_ENABLED?: string;
  UNRANKED_BOT_GOLD_REWARDS_ENABLED?: string;
}): boolean {
  return env.UNRANKED_BOT_CARD_XP_ENABLED === "1" && env.UNRANKED_BOT_GOLD_REWARDS_ENABLED === "1";
}

/** Accepted deployments to earn the first XP on a card. */
export const BOT_CARD_XP_FIRST_XP_AT = 1;
/** Accepted deployments to earn the second XP on a card. */
export const BOT_CARD_XP_SECOND_XP_AT = 3;
/** Maximum XP one card can earn in one match. */
export const BOT_CARD_XP_PER_CARD_CAP = 2;
/** Maximum bot XP one match can award across all cards. */
export const BOT_CARD_XP_MATCH_TOTAL_CAP = 6;

/** XP for an accepted-deployment count on one card. */
export function botXpForDeployments(deployments: number): number {
  if (deployments < BOT_CARD_XP_FIRST_XP_AT) return 0;
  if (deployments < BOT_CARD_XP_SECOND_XP_AT) return 1;
  return BOT_CARD_XP_PER_CARD_CAP;
}

export interface BotCardXpUnit {
  cardId: string;
  deployments: number;
  xp: number;
}

/**
 * Deterministic per-match allocation: cards sorted ascending, prefix-filled
 * until the match cap. Repeat farming cannot spike one match.
 */
export function allocateBotCardXp(counts: Array<{ cardId: string; deployments: number }>): BotCardXpUnit[] {
  const units: BotCardXpUnit[] = [];
  let remaining = BOT_CARD_XP_MATCH_TOTAL_CAP;
  for (const { cardId, deployments } of [...counts].sort((a, b) => (a.cardId < b.cardId ? -1 : 1))) {
    if (remaining <= 0) break;
    const xp = Math.min(botXpForDeployments(deployments), remaining);
    if (xp <= 0) continue;
    remaining -= xp;
    units.push({ cardId, deployments, xp });
  }
  return units;
}

/** Why a fallback match earned bot Card XP or did not. */
export type BotCardXpEligibility =
  | "eligible"
  | "practice-earns-zero"
  | "not-xp-eligible"
  | "short-match"
  | "too-few-deploys"
  | "replay-mismatch"
  | "duplicate"
  | "awaiting-gold"
  | "capped";

/** Authoritative XP outcome for one fallback match. */
export interface BotCardXpResult {
  matchId: string;
  source: "unranked-fallback";
  eligibility: BotCardXpEligibility;
  policyVersion: number;
  /** Confirmed XP across all cards. Zero unless status is confirmed. */
  totalXp: number;
  status: "confirmed" | "pending" | "refused" | "capped";
  awardedCards: BotCardXpUnit[];
  /** Bot matches rewarded to this player today (UTC, shared Gold allowance). */
  rewardedToday: number;
  dailyCap: number;
}
