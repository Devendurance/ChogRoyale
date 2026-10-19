// B3.3c verified player stats. Identity comes only from the verified
// token; aggregates are computed live over durable settlement rows.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { resolveAvatar } from "@/lib/profiles";
import { CASUAL_MIN_MATCHES, getCasualPosition, getPlayerStats } from "@/db/progression";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const [stats, casual] = await Promise.all([getPlayerStats(player.id), getCasualPosition(player.id)]);
    return success(
      {
        username: player.username,
        displayName: player.displayName,
        avatar: resolveAvatar(player.avatarId),
        stats,
        casual: {
          eligible: casual.eligible,
          minMatches: CASUAL_MIN_MATCHES,
          position: casual.position,
          matchmakingMatches: casual.matchmakingMatches,
        },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("player stats failure", { requestId });
    }
    return failure(err, requestId);
  }
}
