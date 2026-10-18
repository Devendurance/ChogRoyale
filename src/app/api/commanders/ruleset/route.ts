import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { rulesetSummary } from "@/lib/commanders";
import { countCommanders } from "@/db/commanders";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const [summary, persisted] = await Promise.all([rulesetSummary(), countCommanders()]);
    return success({ ruleset: summary, persisted }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("commanders ruleset failure", { requestId });
    }
    return failure(err, requestId);
  }
}
