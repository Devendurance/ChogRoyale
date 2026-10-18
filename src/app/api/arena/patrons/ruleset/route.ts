import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { patronRulesetSummary } from "@/lib/patrons";
import { countPatronAssignments } from "@/db/patrons";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const [ruleset, persisted] = await Promise.all([patronRulesetSummary(), countPatronAssignments()]);
    return success({ ruleset, persisted }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("patron ruleset failure", { requestId });
    }
    return failure(err, requestId);
  }
}
