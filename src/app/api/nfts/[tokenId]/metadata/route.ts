import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { parseTokenId } from "@/lib/nft-contract";
import { getNftByTokenId } from "@/db/nfts";
import { logger } from "@/lib/logger";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> }
) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    const record = await getNftByTokenId(parseTokenId(tokenId).toString());
    if (!record?.metadata) throw new AppError("NOT_FOUND", `No metadata stored for token ${tokenId}`);
    return success(
      {
        tokenId: record.token.tokenId,
        status: record.metadata.status,
        document: record.metadata.documentOriginal,
        contentHash: record.metadata.contentHash,
        sourceUrl: record.metadata.sourceUrl,
        fetchedAt: record.metadata.fetchedAt,
        error: record.metadata.error,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("nft metadata read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
