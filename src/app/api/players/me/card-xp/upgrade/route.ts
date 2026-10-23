// P2b paid single-level card upgrade. Well-formed requests always answer
// 200 with a domain status; only malformed bodies, unknown cards with bad
// shapes, and auth failures use error codes. Retries with the same
// idempotency key return the recorded spend without charging again.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { upgradeCard } from "@/db/gold";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("BAD_REQUEST", "Malformed JSON body");
    }
    const { cardId, expectedLevel, idempotencyKey } = (body ?? {}) as Record<string, unknown>;
    if (typeof cardId !== "string" || cardId.length === 0 || cardId.length > 60) {
      throw new AppError("BAD_REQUEST", "cardId must be a non-empty string");
    }
    if (!Number.isInteger(expectedLevel)) {
      throw new AppError("BAD_REQUEST", "expectedLevel must be an integer");
    }
    if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) {
      throw new AppError("BAD_REQUEST", "idempotencyKey must be a uuid");
    }
    const result = await upgradeCard(player.id, { cardId, expectedLevel: expectedLevel as number, idempotencyKey });
    return success(result, { requestId });
  } catch (err) {
    if (err instanceof Error && err.message === "malformed idempotency key") {
      return failure(new AppError("BAD_REQUEST", "idempotencyKey must be a uuid"), requestId);
    }
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("card upgrade failure", { requestId });
    }
    return failure(err, requestId);
  }
}
