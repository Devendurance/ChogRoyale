import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { describeUsername } from "@/lib/usernames";
import { isUsernameAvailable } from "@/db/players";
import { logger } from "@/lib/logger";

// Public: usernames are persistent public identity, so availability reveals
// nothing private. Input is validated before any database lookup.
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get("username") ?? "";
    const verdict = describeUsername(username);
    if (!verdict.valid) {
      return success({ available: false, reason: verdict.reason, message: verdict.message }, { requestId });
    }
    const available = await isUsernameAvailable(username);
    return success(
      available
        ? { available: true as const, normalized: verdict.key }
        : { available: false as const, reason: "taken", message: "Username is already taken" },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("username availability failure", { requestId });
    }
    return failure(err, requestId);
  }
}
