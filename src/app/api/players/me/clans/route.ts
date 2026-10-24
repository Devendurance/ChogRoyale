import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { createClan, getMyClan } from "@/db/clans";
import { logger } from "@/lib/logger";

const MAX_BODY = 2048;
const createSchema = z.object({
  name: z.string().min(1).max(64),
  tag: z.string().min(1).max(16),
  description: z.string().max(600).nullish(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    return success(await getMyClan(player.id), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan read failure", { requestId });
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "A clan name and tag are required");
    return success(await createClan(player.id, parsed.data), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("clan create failure", { requestId });
    }
    return failure(err, requestId);
  }
}
