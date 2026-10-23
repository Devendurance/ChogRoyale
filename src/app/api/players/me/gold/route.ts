// P2b authenticated Gold balance and history. Derived from the earn and
// spend ledgers; reads never mutate balances.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { resolveAvatar } from "@/lib/profiles";
import { getGoldBalance } from "@/db/gold";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const gold = await getGoldBalance(player.id);
    return success(
      {
        username: player.username,
        displayName: player.displayName,
        avatar: resolveAvatar(player.avatarId),
        gold,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("my gold failure", { requestId });
    }
    return failure(err, requestId);
  }
}
