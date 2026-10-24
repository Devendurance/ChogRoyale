import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { declineInvite } from "@/db/clans";
import { logger } from "@/lib/logger";

export async function POST(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { inviteId } = await params;
    return success(await declineInvite(player.id, inviteId), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan decline failure", { requestId });
    }
    return failure(err, requestId);
  }
}
