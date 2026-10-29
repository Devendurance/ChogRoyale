// V2.2a Player Account XP policy (levels 1-100). Permanent account
// progression, separate from Card XP, Gold, trophies and combat stats.
// Client-safe: no engine, DB or server imports. Account XP never upgrades
// cards, spends Gold, changes damage/HP, unlocks ranked, grants trophies,
// passes or affects matchmaking.

/** Account XP policy version. Stored on every award row. */
export const ACCOUNT_XP_POLICY_VERSION = 1;

/** Maximum account level. XP may keep accumulating, level stays 100. */
export const ACCOUNT_XP_MAX_LEVEL = 100;

/** Human public Unranked awards per verified result. */
export const ACCOUNT_XP_PVP_WIN = 100;
export const ACCOUNT_XP_PVP_DRAW = 75;
export const ACCOUNT_XP_PVP_LOSS = 50;

/** Verified Unranked AI fallback awards per confirmed result. */
export const ACCOUNT_XP_BOT_WIN = 40;
export const ACCOUNT_XP_BOT_DRAW = 30;
export const ACCOUNT_XP_BOT_LOSS = 20;

/** Minimum actual combat: 60 seconds at 10 ticks per second. */
export const ACCOUNT_XP_MIN_TICKS = 600;

/** Minimum accepted ordinary-card deployments per rewarded player. */
export const ACCOUNT_XP_MIN_DEPLOYS = 3;

/** Maximum Account-XP-rewarded public PvP matches per player per UTC day. */
export const ACCOUNT_XP_PVP_DAILY_CAP = 20;

/**
 * Release gate. Account XP stays off by default; no writes when off.
 * The bot path additionally requires the live bot Gold gate elsewhere.
 */
export function accountXpReleaseEnabled(env: {
  PLAYER_ACCOUNT_XP_ENABLED?: string;
}): boolean {
  return env.PLAYER_ACCOUNT_XP_ENABLED === "1";
}

/**
 * Cumulative XP required to reach a level.
 * For level L, n = L - 1: total = 100*n + 25*n*(n-1)/2.
 * Level 1 = 0. Level 100 = 131,175.
 */
export function accountXpThresholdForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) return 0;
  if (level > ACCOUNT_XP_MAX_LEVEL) level = ACCOUNT_XP_MAX_LEVEL;
  const n = level - 1;
  return 100 * n + (25 * n * (n - 1)) / 2;
}

/** Level for a lifetime total. Never below 1, never above 100. */
export function levelForTotalXp(totalXp: number): number {
  const total = Math.max(0, Math.floor(totalXp));
  let level = 1;
  // Linear scan over 100 levels is trivial and exact.
  for (let l = 2; l <= ACCOUNT_XP_MAX_LEVEL; l += 1) {
    if (total >= accountXpThresholdForLevel(l)) level = l;
    else break;
  }
  return level;
}

export interface AccountXpProgress {
  level: number;
  totalXp: number;
  currentLevelThreshold: number;
  nextLevelThreshold: number | null;
  xpIntoLevel: number;
  xpToNext: number | null;
  maxLevel: boolean;
}

/** Level projection for a lifetime total, including max-level behavior. */
export function accountXpProgressForTotal(totalXp: number): AccountXpProgress {
  const total = Math.max(0, Math.floor(totalXp));
  const level = levelForTotalXp(total);
  const currentLevelThreshold = accountXpThresholdForLevel(level);
  if (level >= ACCOUNT_XP_MAX_LEVEL) {
    return {
      level,
      totalXp: total,
      currentLevelThreshold,
      nextLevelThreshold: null,
      xpIntoLevel: total - currentLevelThreshold,
      xpToNext: null,
      maxLevel: true,
    };
  }
  const nextLevelThreshold = accountXpThresholdForLevel(level + 1);
  return {
    level,
    totalXp: total,
    currentLevelThreshold,
    nextLevelThreshold,
    xpIntoLevel: total - currentLevelThreshold,
    xpToNext: nextLevelThreshold - total,
    maxLevel: false,
  };
}

/** Award amount for a verified result on a source. */
export function accountXpForResult(
  source: "matchmaking" | "unranked-fallback",
  result: "win" | "loss" | "draw"
): number {
  if (source === "unranked-fallback") {
    if (result === "win") return ACCOUNT_XP_BOT_WIN;
    if (result === "loss") return ACCOUNT_XP_BOT_LOSS;
    return ACCOUNT_XP_BOT_DRAW;
  }
  if (result === "win") return ACCOUNT_XP_PVP_WIN;
  if (result === "loss") return ACCOUNT_XP_PVP_LOSS;
  return ACCOUNT_XP_PVP_DRAW;
}

export type AccountXpSource = "matchmaking" | "unranked-fallback";

/** Why a match earned Account XP or did not. */
export type AccountXpEligibility =
  | "eligible"
  | "flag-off"
  | "practice-earns-zero"
  | "private-earns-zero"
  | "ranked-closed"
  | "ineligible-type"
  | "unverified"
  | "replay-mismatch"
  | "short-match"
  | "too-few-deploys"
  | "fake-bot-participant"
  | "awaiting-gold"
  | "pre-release"
  | "duplicate"
  | "capped";

/**
 * PvP-side gate on verified authoritative evidence. Ranked stays closed
 * until its own release; only matchmaking may earn in V1.
 */
export function accountXpPvpGate(args: {
  matchType: string;
  verification: string;
  ticks: number;
  acceptedDeploys: number;
}): AccountXpEligibility {
  if (args.matchType === "private") return "private-earns-zero";
  if (args.matchType === "ranked") return "ranked-closed";
  if (args.matchType === "practice") return "practice-earns-zero";
  if (args.matchType !== "matchmaking") return "ineligible-type";
  if (args.verification !== "replay-verified") return "unverified";
  if (args.ticks < ACCOUNT_XP_MIN_TICKS) return "short-match";
  if (args.acceptedDeploys < ACCOUNT_XP_MIN_DEPLOYS) return "too-few-deploys";
  return "eligible";
}

/** Bot-side gate: replay and gameplay checks mirror the Gold path. */
export function accountXpBotGate(args: {
  source: string;
  ticks: number;
  acceptedDeploys: number;
  goldConfirmed: boolean;
}): AccountXpEligibility {
  if (args.source !== "unranked-fallback") return "practice-earns-zero";
  if (!args.goldConfirmed) return "awaiting-gold";
  if (args.ticks < ACCOUNT_XP_MIN_TICKS) return "short-match";
  if (args.acceptedDeploys < ACCOUNT_XP_MIN_DEPLOYS) return "too-few-deploys";
  return "eligible";
}
