import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { chaosRulesetSummary } from "@/lib/chaos";
import { countPulseSchedules } from "@/db/chaos";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const [ruleset, persisted] = await Promise.all([chaosRulesetSummary(), countPulseSchedules()]);
    return success({ ruleset, persisted }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("chaos ruleset failure", { requestId });
    }
    return failure(err, requestId);
  }
}
