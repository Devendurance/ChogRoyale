import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { verifyCollection, probeCapabilities } from "@/lib/nft-contract";
import { getDb } from "@/db/client";
import { nftTokens } from "@/db/schema";
import { count } from "drizzle-orm";
import { countMetadataByStatus, countObservations, getCheckpoint } from "@/db/nfts";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const [verification, capabilities, indexed, meta, observations, checkpoint] = await Promise.all([
      verifyCollection(),
      probeCapabilities(),
      getDb().select({ count: count() }).from(nftTokens),
      countMetadataByStatus(),
      countObservations(),
      getCheckpoint("ownership-transfers"),
    ]);
    return success(
      {
        collection: verification,
        totalSupply: capabilities.totalSupply,
        indexedTokens: indexed[0]?.count ?? 0,
        metadataResolved: meta.resolved,
        metadataFailed: meta.failed,
        ownershipObservations: observations,
        ownershipCheckpoint: checkpoint,
        indexer: { mode: "full-collection", scope: "B1.2" },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("indexer status failure", { requestId });
    }
    return failure(err, requestId);
  }
}
