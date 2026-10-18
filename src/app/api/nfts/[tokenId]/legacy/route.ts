import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { parseTokenId } from "@/lib/nft-contract";
import { getNftByTokenId } from "@/db/nfts";
import { getNftLegacy } from "@/db/legacy";
import { logger } from "@/lib/logger";

function serializeEvent(e: {
  id: string;
  authorityKey: string;
  category: string;
  matchId: string | null;
  matchStatus: string | null;
  payload: unknown;
  rulesetRefs: unknown;
  source: string;
  status: string;
  occurredAt: Date | null;
}) {
  return {
    id: e.id,
    authorityKey: e.authorityKey,
    category: e.category,
    matchId: e.matchId,
    matchStatus: e.matchStatus,
    payload: e.payload,
    rulesetRefs: e.rulesetRefs,
    source: e.source,
    status: e.status,
    occurredAt: e.occurredAt,
  };
}

export async function GET(request: Request, context: { params: Promise<{ tokenId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    const tid = parseTokenId(tokenId).toString();
    const nft = await getNftByTokenId(tid);
    if (!nft) throw new AppError("NOT_FOUND", `Token ${tokenId} is not indexed`);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const legacy = await getNftLegacy(tid, {
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return success(
      {
        tokenId: tid,
        name: nft.metadata?.name ?? null,
        stats: legacy.stats,
        total: legacy.total,
        history: legacy.history.map(serializeEvent),
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("legacy read failure", { requestId });
    }
    return failure(err, requestId);
  }
}
