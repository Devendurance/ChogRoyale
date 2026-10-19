// B3.3c casual unranked leaderboard. Matchmaking matches only; private
// rooms never count. No trophies, rewards or prestige: this is a dev-alpha
// standings view over verified settled results. Entries expose public
// profile fields only, never player ids, DIDs, wallets or match internals.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { CASUAL_MAX_LIMIT, CASUAL_MIN_MATCHES, getCasualLeaderboard, getCasualPosition } from "@/db/progression";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    let limit: number | undefined;
    let offset: number | undefined;
    if (limitParam !== null) {
      limit = Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1) throw new AppError("BAD_REQUEST", "Invalid limit");
      if (limit > CASUAL_MAX_LIMIT) throw new AppError("BAD_REQUEST", `Limit exceeds ${CASUAL_MAX_LIMIT}`);
    }
    if (offsetParam !== null) {
      offset = Number(offsetParam);
      if (!Number.isInteger(offset) || offset < 0) throw new AppError("BAD_REQUEST", "Invalid offset");
    }
    const [board, me] = await Promise.all([getCasualLeaderboard({ limit, offset }), getCasualPosition(player.id)]);
    return success(
      {
        kind: "casual-unranked",
        minMatches: CASUAL_MIN_MATCHES,
        ordering: "matchmaking wins, then win rate, then crowns, then username",
        entries: board.entries.map(({ playerId, ...e }) => ({ ...e, isYou: playerId === player.id })),
        total: board.total,
        limit: board.limit,
        offset: board.offset,
        me: { position: me.position, eligible: me.eligible },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("casual leaderboard failure", { requestId });
    }
    return failure(err, requestId);
  }
}
