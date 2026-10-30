// V2.2a authenticated Account XP progression. Read-only. Returns the
// server-authoritative level projection derived from the additive awards
// ledger. Missing migrations report unavailable instead of fabricating a
// progression record. Never exposes another player's award data.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ACCOUNT_XP_POLICY_VERSION, ACCOUNT_XP_PVP_DAILY_CAP, accountXpProgressForTotal, accountXpReleaseEnabled } from "@/lib/account-xp";
import {
  accountXpTablesPresent,
  countAccountXpPvpToday,
  getAccountXpAward,
  getAccountXpAwards,
  getAccountXpRun,
  getAccountXpTotal,
} from "@/db/account-xp";
import { buildAccountXpReceipt } from "@/server/battle/account-xp";

/** Narrow per-match receipt lookup for reconnect recovery.
 * `?matchId=X&source=matchmaking|unranked-fallback` returns the caller's
 * own receipt state for that match: confirmed (with award and level
 * snapshots), pending (awarded outcome not yet known), refused/capped
 * (terminal, zero XP), or unknown (no run and no award for this player).
 * Scoped to the authenticated player; other players' matches read unknown.
 * A missing WebSocket message is never equivalent to zero earned XP. */
async function matchReceipt(playerId: string, matchId: string, source: string) {
  if (source !== "matchmaking" && source !== "unranked-fallback") {
    throw new AppError("BAD_REQUEST", "Unknown receipt source");
  }
  const [run, award] = await Promise.all([
    getAccountXpRun(playerId, source, matchId),
    getAccountXpAward(playerId, source, matchId),
  ]);
  if (award) {
    const details = (run?.details as { result?: unknown; reason?: unknown } | null) ?? null;
    const receipt = await buildAccountXpReceipt(playerId, source, matchId, {
      eligibility: typeof details?.reason === "string" ? (details.reason as never) : "eligible",
      amount: award.amount,
      result: award.result,
      status: "confirmed",
    });
    return { matchId, source, status: "confirmed" as const, receipt };
  }
  if (!run) {
    return { matchId, source, status: "unknown" as const, receipt: null };
  }
  if (run.status === "pending") {
    return { matchId, source, status: "pending" as const, receipt: null };
  }
  if (run.status === "refused" || run.status === "capped") {
    return { matchId, source, status: run.status, receipt: null };
  }
  return { matchId, source, status: "unknown" as const, receipt: null };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    if (!(await accountXpTablesPresent())) {
      throw new AppError("SERVICE_UNAVAILABLE", "Account XP is not available yet");
    }
    const url = new URL(request.url, "http://localhost");
    const lookupMatchId = url.searchParams.get("matchId");
    const lookupSource = url.searchParams.get("source");
    if (lookupMatchId || lookupSource) {
      if (!lookupMatchId || !lookupSource) {
        throw new AppError("BAD_REQUEST", "Receipt lookup needs matchId and source");
      }
      const receipt = await matchReceipt(player.id, lookupMatchId, lookupSource);
      return success(receipt, { requestId });
    }
    const [totalXp, awards, pvpRewardedToday] = await Promise.all([
      getAccountXpTotal(player.id),
      getAccountXpAwards(player.id, 10),
      countAccountXpPvpToday(player.id),
    ]);
    const progress = accountXpProgressForTotal(totalXp);
    return success(
      {
        policyVersion: ACCOUNT_XP_POLICY_VERSION,
        level: progress.level,
        totalXp: progress.totalXp,
        currentLevelThreshold: progress.currentLevelThreshold,
        nextLevelThreshold: progress.nextLevelThreshold,
        xpIntoLevel: progress.xpIntoLevel,
        xpToNext: progress.xpToNext,
        maxLevel: progress.maxLevel,
        maxAccountLevel: 100,
        enabled: accountXpReleaseEnabled(process.env as { PLAYER_ACCOUNT_XP_ENABLED?: string }),
        pvpDailyCap: ACCOUNT_XP_PVP_DAILY_CAP,
        pvpRewardedToday,
        awards,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("my account xp failure", { requestId });
    }
    return failure(err, requestId);
  }
}
