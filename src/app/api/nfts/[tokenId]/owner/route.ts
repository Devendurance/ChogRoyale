import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { parseTokenId, readOwner } from "@/lib/nft-contract";
import { getNftByTokenId, upsertNftToken, recordOwnershipObservation } from "@/db/nfts";
import { logger } from "@/lib/logger";

// Cached observation by default. ?fresh=1 performs a live ownerOf read and
// stores a new observation. Only live reads may gate ownership-sensitive
// actions; cached values are informational.
export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> }
) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    const id = parseTokenId(tokenId);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      const record = await getNftByTokenId(id.toString());
      const obs = record?.latestObservation ?? null;
      if (!obs) throw new AppError("NOT_FOUND", `No ownership observation for token ${tokenId}`);
      return success(
        { tokenId: id.toString(), owner: obs.ownerAddress, observedAt: obs.observedAt, freshness: "cached" as const },
        { requestId }
      );
    }
    const { owner } = await readOwner(id);
    const token = await upsertNftToken({ tokenId: id.toString() });
    const obs = await recordOwnershipObservation({ nftId: token.id, ownerAddress: owner });
    return success(
      { tokenId: id.toString(), owner: obs.ownerAddress, observedAt: obs.observedAt, freshness: "live" as const },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("nft owner read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
