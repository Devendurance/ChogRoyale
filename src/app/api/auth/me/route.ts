import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer, safePlayer } from "@/lib/auth";
import { getRoles } from "@/db/players";
import { logger } from "@/lib/logger";

// Read-only self profile. Never creates records; suspended/banned accounts
// receive 403 via requireActivePlayer.
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const roles = await getRoles(player.id);
    return success({ player: { ...safePlayer(player), roles } }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("auth me failure", { requestId });
    }
    return failure(err, requestId);
  }
}
