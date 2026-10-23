import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { searchPlayers } from "@/db/friendships";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return success({ results: await searchPlayers(player.id, q) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("friends search failure", { requestId });
    }
    return failure(err, requestId);
  }
}
