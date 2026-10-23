import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { getNftByTokenId } from "@/db/nfts";
import { lockedPatronFromNft, PatronUnavailableError } from "@/server/battle/patron-source";
import { logger } from "@/lib/logger";

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
    // The locked snapshot is the only patron authority: wrong-collection
    // or unresolved rows fail closed here, never served as patron traits.
    let locked;
    try {
      locked = lockedPatronFromNft(nft);
    } catch (err) {
      if (err instanceof PatronUnavailableError) {
        if (/metadata not resolved|unresolved/i.test(err.message)) {
          throw new AppError("UNPROCESSABLE", `Genesis NFT ${tokenId} patron derivation pending`);
        }
        throw new AppError("NOT_FOUND", `Genesis NFT ${tokenId} not found`);
      }
      throw err;
    }
    return success(
      {
        patron: locked.config,
        provenance: {
          source: locked.source,
          chainId: locked.chainId,
          contractAddress: locked.contractAddress,
          tokenUri: nft.token.tokenUriOriginal,
          attributes: locked.attributes,
          metadataContentHash: locked.metadataContentHash,
          metadataFetchedAt: nft.metadata?.fetchedAt ?? null,
        },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("patron lookup failure", { requestId });
    }
    return failure(err, requestId);
  }
}
