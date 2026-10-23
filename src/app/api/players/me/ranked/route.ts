// P1b.2 authenticated ranked standing. Reads the authoritative trophy
// ledger and balances; nothing here mutates trophies. Unawarded or
// unfinished matches simply contribute nothing yet.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { resolveAvatar } from "@/lib/profiles";
import { getMyRanked } from "@/db/ranked";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const ranked = await getMyRanked(player.id);
    return success(
      {
        username: player.username,
        displayName: player.displayName,
        avatar: resolveAvatar(player.avatarId),
        ranked,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("my ranked failure", { requestId });
    }
    return failure(err, requestId);
  }
}
