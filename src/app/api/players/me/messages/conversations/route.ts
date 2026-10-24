import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { getOrCreateConversation } from "@/db/messages";
import { logger } from "@/lib/logger";

const MAX_BODY = 1024;
const openSchema = z.object({ peerId: z.string().uuid() });

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const len = Number(request.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AppError("BAD_REQUEST", "Request body too large");
    const text = await request.text();
    if (text.length > MAX_BODY) throw new AppError("BAD_REQUEST", "Request body too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("BAD_REQUEST", "Body must be JSON");
    }
    const parsed = openSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "A valid peer id is required");
    const { conversationId } = await getOrCreateConversation(player.id, parsed.data.peerId);
    return success({ conversationId }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("conversation open failure", { requestId });
    }
    return failure(err, requestId);
  }
}
