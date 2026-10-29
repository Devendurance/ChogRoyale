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
  getAccountXpAwards,
  getAccountXpTotal,
} from "@/db/account-xp";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    if (!(await accountXpTablesPresent())) {
      throw new AppError("SERVICE_UNAVAILABLE", "Account XP is not available yet");
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
