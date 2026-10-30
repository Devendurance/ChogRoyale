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

/** Receipt delivery state for one player's award outcome. */
export type AccountXpReceiptStatus = "confirmed" | "pending" | "refused" | "capped";

/** Server-owned receipt shape mirroring `AccountXpMessage` (protocol).
 * Snapshots are counterfactual against the additive ledger: levelBefore
 * derives from lifetime XP excluding this award, levelAfter including it.
 * Duplicates repeat identical snapshots and never imply a second award. */
export interface AccountXpReceipt {
  matchId: string;
  source: AccountXpSource;
  policyVersion: number;
  status: AccountXpReceiptStatus;
  eligibility: AccountXpEligibility | "unknown";
  result: "win" | "loss" | "draw" | null;
  amount: number;
  playerId: string;
  totalXp: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  leveledUp: boolean | null;
}

/** Strict client-side validator for server-issued Account XP receipts.
 * Rejects anything forged, locally computed, or internally inconsistent.
 * Positive amounts are accepted only on confirmed receipts. */
export function validateAccountXpReceipt(value: unknown): { ok: true; receipt: AccountXpReceipt } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (typeof value !== "object" || value === null) return fail("not-an-object");
  const v = value as Record<string, unknown>;
  if (typeof v.matchId !== "string" || v.matchId.length === 0) return fail("bad-match-id");
  if (v.source !== "matchmaking" && v.source !== "unranked-fallback") return fail("bad-source");
  if (v.policyVersion !== ACCOUNT_XP_POLICY_VERSION) return fail("bad-policy-version");
  if (v.status !== "confirmed" && v.status !== "pending" && v.status !== "refused" && v.status !== "capped") return fail("bad-status");
  if (typeof v.eligibility !== "string" || v.eligibility.length === 0) return fail("bad-eligibility");
  if (v.result !== null && v.result !== "win" && v.result !== "loss" && v.result !== "draw") return fail("bad-result");
  if (!Number.isInteger(v.amount) || (v.amount as number) < 0) return fail("bad-amount");
  // Confirmed-only positive reward amounts: no other status may carry XP.
  if (v.status !== "confirmed" && v.amount !== 0) return fail("unconfirmed-amount");
  if (typeof v.playerId !== "string" || v.playerId.length === 0) return fail("bad-player-id");
  const nullableInt = (x: unknown): boolean => x === null || (Number.isInteger(x) && (x as number) >= 0);
  if (!nullableInt(v.totalXp) || !nullableInt(v.levelBefore) || !nullableInt(v.levelAfter)) return fail("bad-snapshot");
  if (v.leveledUp !== null && v.leveledUp !== true && v.leveledUp !== false) return fail("bad-leveled-up");
  const snapshots = v.totalXp !== null && v.levelBefore !== null && v.levelAfter !== null;
  if (!snapshots && (v.levelBefore !== null || v.levelAfter !== null || v.totalXp !== null || v.leveledUp !== null)) {
    return fail("partial-snapshot");
  }
  if (snapshots && v.leveledUp !== ((v.levelAfter as number) > (v.levelBefore as number))) return fail("leveled-up-mismatch");
  if (v.status === "confirmed" && !snapshots) return fail("confirmed-without-snapshot");
  return {
    ok: true,
    receipt: {
      matchId: v.matchId as string,
      source: v.source as AccountXpSource,
      policyVersion: ACCOUNT_XP_POLICY_VERSION,
      status: v.status as AccountXpReceiptStatus,
      eligibility: v.eligibility as AccountXpReceipt["eligibility"],
      result: v.result as AccountXpReceipt["result"],
      amount: v.amount as number,
      playerId: v.playerId as string,
      totalXp: v.totalXp as number | null,
      levelBefore: v.levelBefore as number | null,
      levelAfter: v.levelAfter as number | null,
      leveledUp: v.leveledUp as boolean | null,
    },
  };
}

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
