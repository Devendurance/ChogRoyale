import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { rulesetSummary, freeCommanderTemplates } from "@/lib/commanders";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const summary = rulesetSummary();
    return success(
      {
        rulesetVersion: summary.version,
        classes: summary.classes,
        freeStarters: freeCommanderTemplates(),
        powerBudget: summary.powerBudget,
        fairnessNotes: summary.fairnessNotes,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("commanders classes failure", { requestId });
    }
    return failure(err, requestId);
  }
}
