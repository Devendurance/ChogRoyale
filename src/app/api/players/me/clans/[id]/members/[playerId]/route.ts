import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { removeMember } from "@/db/clans";
import { logger } from "@/lib/logger";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; playerId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id, playerId } = await params;
    return success(await removeMember(player.id, id, playerId), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan remove failure", { requestId });
    }
    return failure(err, requestId);
  }
}
