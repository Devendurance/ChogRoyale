import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { getNftByTokenId } from "@/db/nfts";
import { derivePatronConfig } from "@/lib/patrons";
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
    if (!nft.metadata || nft.metadata.status !== "resolved") {
      throw new AppError("UNPROCESSABLE", `Genesis NFT ${tokenId} patron derivation pending`);
    }
    const config = derivePatronConfig({
      tokenId,
      attributes: (nft.metadata.attributesOriginal ?? null) as Array<{
        trait_type: string;
        value: string | number;
      }> | null,
      metadataContentHash: nft.metadata.contentHash,
      name: nft.metadata.name,
    });
    return success(
      {
        patron: config,
        provenance: {
          tokenUri: nft.token.tokenUriOriginal,
          metadataContentHash: nft.metadata.contentHash,
          metadataFetchedAt: nft.metadata.fetchedAt,
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
