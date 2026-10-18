import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer } from "@/lib/auth";
import { listWallets } from "@/db/players";
import { getHoldingsByOwners } from "@/db/nfts";
import { readOwner, parseTokenId } from "@/lib/nft-contract";
import { logger } from "@/lib/logger";

// Authenticated inventory across all verified linked wallets. Holdings come
// from the indexed observations (labeled cached); ?fresh=1 re-verifies each
// held token live before returning it.
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const wallets = await listWallets(player.id);
    const verified = wallets.filter((w) => w.verifiedAt !== null).map((w) => w.addressNormalized);
    if (verified.length === 0) {
      return success({ holdings: [], walletsChecked: 0, freshness: "cached" as const }, { requestId });
    }
    const holdings = await getHoldingsByOwners(verified);
    if (!fresh) {
      return success({ holdings, walletsChecked: verified.length, freshness: "cached" as const }, { requestId });
    }
    const verifiedHoldings = [];
    for (const h of holdings) {
      try {
        const { owner } = await readOwner(parseTokenId(h.tokenId));
        if (verified.includes(owner.trim().toLowerCase())) {
          verifiedHoldings.push({ ...h, freshness: "live" as const });
        }
      } catch {
        // Unverifiable right now: omit rather than assert.
      }
    }
    return success(
      { holdings: verifiedHoldings, walletsChecked: verified.length, freshness: "live" as const },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("player nfts failure", { requestId });
    }
    return failure(err, requestId);
  }
}
