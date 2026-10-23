import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { listConversations, sendMessage } from "@/db/messages";
import { logger } from "@/lib/logger";

const MAX_BODY = 4096;
const sendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().max(1100),
  idempotencyKey: z.string().uuid(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    return success({ conversations: await listConversations(player.id) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("messages list failure", { requestId });
    }
    return failure(err, requestId);
  }
}

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
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Send needs a conversation, content and idempotency key");
    // Receipt means the server stored the message, never that it reached a device.
    const { message } = await sendMessage(player.id, parsed.data.conversationId, parsed.data.content, parsed.data.idempotencyKey);
    return success({ message }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("message send failure", { requestId });
    }
    return failure(err, requestId);
  }
}
