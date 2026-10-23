// P1b.2 ranked season leaderboard. Ranked rows only; the casual unranked
// board is independent and unchanged. Entries expose public profile fields
// only, never player ids, DIDs, wallets or match internals.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { RANKED_MAX_LIMIT, RANKED_SEASON } from "@/lib/ranked";
import { getRankedLeaderboard, getRankedPosition } from "@/db/ranked";
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
      if (limit > RANKED_MAX_LIMIT) throw new AppError("BAD_REQUEST", `Limit exceeds ${RANKED_MAX_LIMIT}`);
    }
    if (offsetParam !== null) {
      offset = Number(offsetParam);
      if (!Number.isInteger(offset) || offset < 0) throw new AppError("BAD_REQUEST", "Invalid offset");
    }
    const [board, me] = await Promise.all([getRankedLeaderboard({ limit, offset }), getRankedPosition(player.id)]);
    return success(
      {
        kind: "ranked-season-1",
        season: RANKED_SEASON,
        ordering: "trophies, then ranked wins, then username",
        entries: board.entries.map(({ playerId, ...e }) => ({ ...e, isYou: playerId === player.id })),
        total: board.total,
        limit: board.limit,
        offset: board.offset,
        me: { position: me.position, eligible: me.eligible, trophies: me.trophies, rankedMatches: me.rankedMatches },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("ranked leaderboard failure", { requestId });
    }
    return failure(err, requestId);
  }
}
