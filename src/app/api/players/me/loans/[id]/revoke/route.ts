// P5f.1 owner revocation. Idempotent: already-terminal loans return current.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { revokeLoan } from "@/db/lending";
import { logger } from "@/lib/logger";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id } = await ctx.params;
    return success({ loan: await revokeLoan(player.id, id) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("loan revoke failure", { requestId });
    }
    return failure(err, requestId);
  }
}
