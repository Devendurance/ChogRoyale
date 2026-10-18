import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { listTokensPage } from "@/db/nfts";
import { logger } from "@/lib/logger";

// Paginated public collection index. Cursor is the last seen tokenId;
// responses carry owner snapshots labeled cached (see owner endpoint).
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit") ?? "25";
    const cursor = url.searchParams.get("cursor");
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError("BAD_REQUEST", "limit must be an integer 1-100");
    }
    if (cursor !== null && !/^\d{1,78}$/.test(cursor)) {
      throw new AppError("BAD_REQUEST", "cursor must be a token id");
    }
    const page = await listTokensPage({ limit, cursor });
    return success(
      { tokens: page.tokens, nextCursor: page.nextCursor, freshness: "cached" as const },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("nfts list failure", { requestId });
    }
    return failure(err, requestId);
  }
}
