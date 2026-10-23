import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { getNftByTokenId } from "@/db/nfts";
import { lockedPatronFromNft, PatronUnavailableError } from "@/server/battle/patron-source";
import { deriveChaosSchedule } from "@/lib/chaos";
import { logger } from "@/lib/logger";

// Preview only: derives this real NFT's Chaos Pulse configuration from its
// indexed traits. The fixed preview seed makes the output deterministic per
// token. This claims no match occurred and persists nothing.
export async function GET(request: Request, context: { params: Promise<{ tokenId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId } = await context.params;
    if (!/^[0-9]{1,78}$/.test(tokenId)) {
      throw new AppError("BAD_REQUEST", `Invalid token ID: ${tokenId}`);
    }
    const nft = await getNftByTokenId(tokenId);
    if (!nft) {
      throw new AppError("NOT_FOUND", `Genesis NFT ${tokenId} not found`);
    }
    // Preview derives from the same genuine locked snapshot the battle
    // uses; wrong-collection or unresolved rows fail closed, never previewed.
    let locked;
    try {
      locked = lockedPatronFromNft(nft);
    } catch (err) {
      if (err instanceof PatronUnavailableError) {
        if (/metadata not resolved|unresolved/i.test(err.message)) {
          throw new AppError("UNPROCESSABLE", `Genesis NFT ${tokenId} chaos preview pending`);
        }
        throw new AppError("NOT_FOUND", `Genesis NFT ${tokenId} not found`);
      }
      throw err;
    }
    const patron = locked.config;
    const schedule = deriveChaosSchedule({ patron, serverSeed: `preview-v1:${tokenId}` });
    return success(
      {
        preview: true,
        patron: { tokenId: patron.tokenId, theme: patron.theme, tier: patron.tier },
        schedule,
        provenance: {
          source: locked.source,
          metadataContentHash: locked.metadataContentHash,
          patronRulesetVersion: patron.rulesetVersion,
        },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("chaos preview failure", { requestId });
    }
    return failure(err, requestId);
  }
}
