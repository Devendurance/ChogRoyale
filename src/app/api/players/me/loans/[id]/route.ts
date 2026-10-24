// P5f.1 party-only loan read. Non-parties get NOT_FOUND.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { getLoanForViewer } from "@/db/lending";
import { logger } from "@/lib/logger";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id } = await ctx.params;
    return success({ loan: await getLoanForViewer(id, player.id) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loan read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
