import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { extractBearerToken, safePlayer } from "@/lib/auth";
import { verifyPrivyToken } from "@/lib/privy-server";
import { provisionPlayer } from "@/db/players";
import { logger } from "@/lib/logger";

// Idempotent first-login entry point. The verified Privy DID is the only
// accepted identity; request bodies are never used for authentication.
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const token = extractBearerToken(request);
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Authentication required");
    }
    const identity = await verifyPrivyToken(token);
    const player = await provisionPlayer({ privyDid: identity.privyDid });
    return success({ player: safePlayer(player) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("auth bootstrap failure", { requestId });
    }
    return failure(err, requestId);
  }
}
