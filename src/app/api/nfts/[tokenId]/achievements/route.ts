import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { parseTokenId } from "@/lib/nft-contract";
import { getNftByTokenId } from "@/db/nfts";
import { getNftLegacy } from "@/db/legacy";
import { logger } from "@/lib/logger";

export async function GET(request: Request, context: { params: Promise<{ tokenId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    const tid = parseTokenId(tokenId).toString();
    const nft = await getNftByTokenId(tid);
    if (!nft) throw new AppError("NOT_FOUND", `Token ${tokenId} is not indexed`);
    const legacy = await getNftLegacy(tid, { limit: 1, offset: 0 });
    return success(
      {
        tokenId: tid,
        achievements: legacy.achievements,
        total: legacy.achievements.length,
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("achievements read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
