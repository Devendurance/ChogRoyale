// P6c sponsorship quote. Advisory only: the mutation re-checks everything
// atomically, so a quote is never an authorization. Cost and next level
// are disclosed only when the caller may actually sponsor.
import { z } from "zod";
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { getSponsorshipQuote } from "@/db/sponsorships";
import { logger } from "@/lib/logger";

const querySchema = z.object({ recipientId: z.string().uuid(), cardId: z.string().min(1).max(60) });

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ recipientId: url.searchParams.get("recipientId"), cardId: url.searchParams.get("cardId") });
    if (!parsed.success) throw new AppError("BAD_REQUEST", "recipientId must be a uuid and cardId a non-empty string");
    return success(await getSponsorshipQuote(player.id, parsed.data.recipientId, parsed.data.cardId), { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("sponsorship quote failure", { requestId });
    }
    return failure(err, requestId);
  }
}
