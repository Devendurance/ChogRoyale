import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { invitePlayer } from "@/db/clans";
import { logger } from "@/lib/logger";

const MAX_BODY = 1024;
const inviteSchema = z.object({ playerId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id } = await params;
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
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "A valid player id is required");
    return success(await invitePlayer(player.id, id, parsed.data.playerId), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan invite failure", { requestId });
    }
    return failure(err, requestId);
  }
}
