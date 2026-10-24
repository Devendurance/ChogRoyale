import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { getClan, updateClan } from "@/db/clans";
import { logger } from "@/lib/logger";

const MAX_BODY = 2048;
const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(600).nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const { id } = await params;
    return success(await getClan(player.id, id), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan details failure", { requestId });
    }
    return failure(err, requestId);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Nothing valid to update");
    return success(await updateClan(player.id, id, parsed.data), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan update failure", { requestId });
    }
    return failure(err, requestId);
  }
}
