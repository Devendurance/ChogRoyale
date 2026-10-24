// P5e.1 gift-eligibility read. Authenticated caller checks one existing
// friend; no gifts are submitted, no enumeration, no private disclosure.
import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { canGiftToFriend } from "@/db/gifting";
import { logger } from "@/lib/logger";

const querySchema = z.object({ peerId: z.string().uuid() });

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ peerId: url.searchParams.get("peerId") });
    if (!parsed.success) throw new AppError("BAD_REQUEST", "peerId must be a player id");
    const result = await canGiftToFriend(player.id, parsed.data.peerId);
    return success(result, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("gift eligibility read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
