// Authenticated Training Camp progress. Read-only: the browser can never
// claim a stage. Completion happens inside the authoritative tutorial room.
import { AppError, failure, getRequestId, success } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getTutorialSnapshot } from "@/server/tutorial";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const tutorial = await getTutorialSnapshot(player.id);
    if (tutorial.access === "schema-unavailable") {
      throw new AppError("SERVICE_UNAVAILABLE", "Training Camp progress is not available yet");
    }
    return success({ tutorial }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("my tutorial progress failure", { requestId });
    }
    return failure(err, requestId);
  }
}
