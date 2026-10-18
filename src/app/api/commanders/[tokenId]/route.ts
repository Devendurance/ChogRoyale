import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { getNftByTokenId } from "@/db/nfts";
import { getCommanderByTokenId, currentRulesetVersion } from "@/db/commanders";
import { deriveCommander } from "@/lib/commanders";
import { parseTokenId } from "@/lib/nft-contract";
import { logger } from "@/lib/logger";

// Public commander view for one Genesis token. Derives deterministically
// from preserved onchain metadata on every read; the persisted row (written
// by the derive script) supplies provenance. Metadata that has not been
// resolved returns a pending state, never a fabricated commander.
export async function GET(request: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { tokenId: raw } = await ctx.params;
    let tokenId: bigint;
    try {
      tokenId = parseTokenId(raw);
    } catch {
      throw new AppError("BAD_REQUEST", "Invalid tokenId");
    }
    const full = await getNftByTokenId(tokenId);
    if (!full) throw new AppError("NOT_FOUND", "Token is not indexed");
    const meta = full.metadata;
    if (!meta || meta.status !== "resolved" || !meta.attributesOriginal) {
      return success(
        {
          status: "pending" as const,
          tokenId: tokenId.toString(),
          name: meta?.name ?? null,
          metadataStatus: meta?.status ?? "missing",
          rulesetVersion: currentRulesetVersion(),
          reason: "NFT metadata has not been resolved yet; derivation awaits B1.2 ingestion",
        },
        { requestId }
      );
    }
    const attributes = meta.attributesOriginal as Array<{ trait_type: string; value: string | number }>;
    const derived = deriveCommander({ attributes });
    const persisted = await getCommanderByTokenId(tokenId);
    return success(
      {
        status: "derived" as const,
        tokenId: tokenId.toString(),
        name: meta.name,
        image: meta.imageOriginal,
        rulesetVersion: derived.rulesetVersion,
        commander: {
          class: derived.class,
          affinity: derived.affinity,
          variant: derived.variant,
          prestige: derived.prestige,
          stats: derived.stats,
          abilities: derived.abilities,
          powerScore: derived.powerScore,
          scores: derived.scores,
          signals: derived.signals,
          unmatchedTraits: derived.unmatchedTraits,
        },
        provenance: persisted
          ? {
              persisted: true,
              contentHash: persisted.contentHash,
              hashMatch: persisted.contentHash === derived.derivationHash,
              derivationCount: persisted.derivationCount,
              derivedAt: persisted.derivedAt,
            }
          : { persisted: false, derivationHash: derived.derivationHash },
        ownership: {
          cachedOwner: full.latestObservation?.ownerAddress ?? null,
          observedAt: full.latestObservation?.observedAt ?? null,
          note: "Cached observation only; exclusive gameplay use requires fresh ownerOf verification",
        },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("commander token failure", { requestId });
    }
    return failure(err, requestId);
  }
}
