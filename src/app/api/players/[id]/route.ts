import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { findPlayerById } from "@/db/players";
import { toPublicProfile } from "@/lib/profiles";
import { logger } from "@/lib/logger";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request.headers);
  try {
    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.length > 64) {
      throw new AppError("BAD_REQUEST", "Invalid player id");
    }
    const player = await findPlayerById(id);
    const profile = player ? toPublicProfile(player) : null;
    if (!profile) {
      throw new AppError("NOT_FOUND", "Player not found");
    }
    return success({ player: profile }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("public profile failure", { requestId });
    }
    return failure(err, requestId);
  }
}
