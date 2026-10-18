import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { parseTokenId } from "@/lib/nft-contract";
import { getNftByTokenId } from "@/db/nfts";
import { logger } from "@/lib/logger";

function serialize(record: NonNullable<Awaited<ReturnType<typeof getNftByTokenId>>>) {
  return {
    chainId: record.token.chainId,
    contractAddress: record.token.contractAddress,
    tokenId: record.token.tokenId,
    tokenUri: record.token.tokenUriOriginal,
    metadata: record.metadata
      ? {
          name: record.metadata.name,
          description: record.metadata.description,
          image: record.metadata.imageOriginal,
          attributes: record.metadata.attributesOriginal,
          contentHash: record.metadata.contentHash,
          status: record.metadata.status,
          error: record.metadata.error,
          sourceUrl: record.metadata.sourceUrl,
          fetchedAt: record.metadata.fetchedAt,
        }
      : null,
    owner: record.latestObservation
      ? {
          address: record.latestObservation.ownerAddress,
          observedAt: record.latestObservation.observedAt,
          freshness: "cached" as const,
          source: record.latestObservation.source,
        }
      : null,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> }
) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    const record = await getNftByTokenId(parseTokenId(tokenId).toString());
    if (!record) throw new AppError("NOT_FOUND", `Token ${tokenId} is not indexed`);
    return success({ nft: serialize(record) }, { requestId });
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("nft read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
