import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { getTraitCatalog, countIndexedTokens, countMetadataByStatus } from "@/db/nfts";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const [catalog, indexed, meta] = await Promise.all([
      getTraitCatalog(),
      countIndexedTokens(),
      countMetadataByStatus(),
    ]);
    return success(
      {
        traitTypes: catalog.types,
        generatedAt: catalog.generatedAt,
        coverage: { indexedTokens: indexed, metadataResolved: meta.resolved, metadataFailed: meta.failed },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("nfts traits failure", { requestId });
    }
    return failure(err, requestId);
  }
}
