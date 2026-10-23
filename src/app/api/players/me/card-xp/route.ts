// P2a authenticated ordinary-card progression. Reads the authoritative XP
// ledger and progress rows; nothing here mutates XP. Cards with no verified
// usage report zero progress, which is honest absence, not fabrication.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { resolveAvatar } from "@/lib/profiles";
import { getMyCardXp } from "@/db/card-xp";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const cards = await getMyCardXp(player.id);
    return success(
      {
        username: player.username,
        displayName: player.displayName,
        avatar: resolveAvatar(player.avatarId),
        cards,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("my card xp failure", { requestId });
    }
    return failure(err, requestId);
  }
}
