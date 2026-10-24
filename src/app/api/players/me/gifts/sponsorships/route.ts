// P6c Gold-funded upgrade sponsorship. Well-formed requests always answer
// 200 with a domain status; only malformed bodies and auth failures use
// error codes. Retries with the same idempotency key return the original
// outcome without charging again or advancing twice. The sponsor's Gold
// cost and the recipient's next level are server-calculated; the client
// supplies no amounts, XP values or levels of authority.
import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireOnboardedPlayer } from "@/lib/auth";
import { listSponsorshipsReceived, listSponsorshipsSent, sponsorUpgrade } from "@/db/sponsorships";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireOnboardedPlayer(request);
    const role = new URL(request.url).searchParams.get("role");
    if (role !== null && role !== "sent" && role !== "received") {
      throw new AppError("BAD_REQUEST", "role must be sent or received");
    }
    const sent = role === "received" ? [] : await listSponsorshipsSent(player.id);
    const received = role === "sent" ? [] : await listSponsorshipsReceived(player.id);
    return success({ sent, received }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("sponsorship list failure", { requestId });
    }
    return failure(err, requestId);
  }
}

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
    const { recipientId, cardId, expectedLevel, idempotencyKey } = (body ?? {}) as Record<string, unknown>;
    if (typeof recipientId !== "string" || !UUID_RE.test(recipientId)) {
      throw new AppError("BAD_REQUEST", "recipientId must be a uuid");
    }
    if (typeof cardId !== "string" || cardId.length === 0 || cardId.length > 60) {
      throw new AppError("BAD_REQUEST", "cardId must be a non-empty string");
    }
    if (!Number.isInteger(expectedLevel)) {
      throw new AppError("BAD_REQUEST", "expectedLevel must be an integer");
    }
    if (typeof idempotencyKey !== "string" || !UUID_RE.test(idempotencyKey)) {
      throw new AppError("BAD_REQUEST", "idempotencyKey must be a uuid");
    }
    const result = await sponsorUpgrade(player.id, {
      recipientId,
      cardId,
      expectedLevel: expectedLevel as number,
      idempotencyKey,
    });
    return success(result, { requestId });
  } catch (err) {
    if (err instanceof Error && err.message === "malformed idempotency key") {
      return failure(new AppError("BAD_REQUEST", "idempotencyKey must be a uuid"), requestId);
    }
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("sponsorship failure", { requestId });
    }
    return failure(err, requestId);
  }
}
