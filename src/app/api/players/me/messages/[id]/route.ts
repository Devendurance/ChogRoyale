import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { fetchMessages } from "@/db/messages";
import { logger } from "@/lib/logger";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id } = await params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (rawLimit !== null && (!Number.isFinite(limit) || (limit as number) <= 0)) {
      throw new AppError("BAD_REQUEST", "Limit must be a positive number");
    }
    return success(await fetchMessages(player.id, id, cursor, limit), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("messages fetch failure", { requestId });
    }
    return failure(err, requestId);
  }
}
