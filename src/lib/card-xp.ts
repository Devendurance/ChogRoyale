// P2a authoritative card XP, Season policy v1. Client-safe: no engine, DB
// or server imports. Provisional TEST numbers, not approved economy rules.
//Higher levels need more XP; reaching a requirement only unlocks eligibility
// to spend Gold (P2b). The player-facing progression surface reads these
// server values without deriving combat stats in the browser.
export const CARD_XP_POLICY_VERSION = 1;
export const CARD_XP_MAX_LEVEL = 10;
/** XP per verified accepted deployment of an ordinary card. */
export const CARD_XP_PER_DEPLOY = 1;
/** Per-card deployments counted per player per match; extras earn nothing. */
export const CARD_XP_PER_CARD_MATCH_CAP = 5;
/** Bounded total XP units per player per match across all cards. */
export const CARD_XP_MATCH_TOTAL_CAP = 20;
/** Cumulative XP needed to reach each level (index level-1). Level 1 is free. */
export const CARD_XP_LEVEL_REQUIREMENTS = [0, 5, 12, 22, 35, 52, 72, 96, 124, 155] as const;

export function cardLevelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < CARD_XP_MAX_LEVEL; i += 1) {
    if (xp >= CARD_XP_LEVEL_REQUIREMENTS[i]!) level = i + 1;
    else break;
  }
  return level;
}

/** XP still needed for the next level, or 0 when maxed. */
export function cardXpToNext(level: number, xp: number): number {
  if (level >= CARD_XP_MAX_LEVEL) return 0;
  return Math.max(0, CARD_XP_LEVEL_REQUIREMENTS[level]! - xp);
}

/** Eligible to spend Gold on the next upgrade (P2b): at max-1 progress with
 * the requirement met, and never past the cap. */
export function cardUpgradeEligible(level: number, xp: number): boolean {
  if (level >= CARD_XP_MAX_LEVEL) return false;
  return xp >= CARD_XP_LEVEL_REQUIREMENTS[level]!;
}

export interface CardXpEntry {
  cardId: string;
  /** Actual purchased card level. XP alone never advances this. */
  level: number;
  /** XP-unlocked potential level derived from lifetime XP. */
  xpLevel: number;
  xp: number;
  /** XP required to buy the next purchased level, null at 10. */
  xpTarget: number | null;
  /** Gold cost to buy the next purchased level, null at 10. */
  goldCost: number | null;
  /** Purchasable now: XP requirement met and enough Gold. */
  eligible: boolean;
  maxed: boolean;
}

/** Gold cost to buy each purchased level (index level-2 for levels 2-10). */
export const CARD_UPGRADE_GOLD_COSTS = [100, 180, 300, 480, 750, 1100, 1600, 2300, 3200] as const;

/** Gold cost to advance from the given purchased level, null at 10. */
export function goldCostForLevel(purchasedLevel: number): number | null {
  if (purchasedLevel < 1 || purchasedLevel >= CARD_XP_MAX_LEVEL) return null;
  return CARD_UPGRADE_GOLD_COSTS[purchasedLevel - 1]!;
}

export interface MyCardXpResponse {
  policyVersion: number;
  maxLevel: number;
  /** Derived Gold balance used when the progression read answers. */
  gold: number;
  cards: CardXpEntry[];
}
