import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { blockPlayer, listBlocks } from "@/db/blocks";
import { logger } from "@/lib/logger";

const MAX_BODY = 4096;
const blockSchema = z.object({ playerId: z.string().uuid() });

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    return success({ blocked: await listBlocks(player.id) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("blocks read failure", { requestId });
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
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "playerId must be a player id");
    return success({ blocked: await blockPlayer(player.id, parsed.data.playerId) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("block failure", { requestId });
    }
    return failure(err, requestId);
  }
}
