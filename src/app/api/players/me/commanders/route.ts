import { getRequestId, success, failure, AppError } from "@/lib/errors";
import { requireActivePlayer } from "@/lib/auth";
import { listWallets } from "@/db/players";
import { getHoldingsByOwners } from "@/db/nfts";
import {
  getCommanderEligibility,
  currentRulesetVersion,
} from "@/db/commanders";
import { freeCommanderTemplates } from "@/lib/commanders";
import { readOwner, parseTokenId } from "@/lib/nft-contract";
import { getIpfsGateways } from "@/lib/metadata";
import { logger } from "@/lib/logger";

// Display URL only; the original URI is also returned verbatim. ipfs://
// resolves through the first configured gateway, https passes through,
// anything else has no display URL.
function displayUrl(imageOriginal: string | null): string | null {
  if (!imageOriginal) return null;
  if (imageOriginal.startsWith("ipfs://")) return `${getIpfsGateways()[0]}/${imageOriginal.slice("ipfs://".length)}`;
  if (imageOriginal.startsWith("https://")) return imageOriginal;
  return null;
}

// Authenticated commander eligibility. NFT commanders are eligible only when
// a verified linked wallet holds the token; cached observations support
// browsing, while ?fresh=1 re-verifies each token live and fails closed.
// Free starters are always eligible: same power budget, no NFT required.
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { player } = await requireActivePlayer(request);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const wallets = await listWallets(player.id);
    const verified = wallets.filter((w) => w.verifiedAt !== null).map((w) => w.addressNormalized);

    if (verified.length === 0) {
      return success(
        {
          nftCommanders: [],
          freeCommanders: freeCommanderTemplates().map((t) => ({ ...t, eligible: true })),
          rulesetVersion: currentRulesetVersion(),
          walletsChecked: 0,
          freshness: "cached" as const,
        },
        { requestId }
      );
    }

    const holdings = await getHoldingsByOwners(verified);
    let eligibleIds = new Set(holdings.map((h) => h.tokenId));
    if (fresh) {
      const live = new Set<string>();
      for (const h of holdings) {
        try {
          const { owner } = await readOwner(parseTokenId(h.tokenId));
          if (verified.includes(owner.trim().toLowerCase())) live.add(h.tokenId);
        } catch {
          // Unverifiable right now: fail closed, omit the token.
        }
      }
      eligibleIds = live;
    }

    const rows = await getCommanderEligibility(holdings.map((h) => h.tokenId));
    const holdingOf = new Map(holdings.map((h) => [h.tokenId, h]));
    const nftCommanders = rows.map((r) => {
      const eligible = eligibleIds.has(r.tokenId);
      const holding = holdingOf.get(r.tokenId);
      const media = {
        name: holding?.name ?? null,
        imageOriginal: holding?.image ?? null,
        imageUrl: displayUrl(holding?.image ?? null),
      };
      if (!r.commander) {
        return {
          tokenId: r.tokenId,
          ...media,
          status: "pending" as const,
          metadataStatus: r.metadataStatus ?? "missing",
          eligible: false,
          reason:
            r.metadataStatus === "resolved"
              ? "Derived definition not yet persisted; retry after the derive pass"
              : "NFT metadata has not been resolved yet",
        };
      }
      return {
        tokenId: r.tokenId,
        ...media,
        status: "derived" as const,
        metadataStatus: r.metadataStatus,
        eligible,
        eligibilityFreshness: fresh ? ("live" as const) : ("cached" as const),
        commander: {
          class: r.commander.class,
          affinity: r.commander.affinity,
          variant: r.commander.variant,
          prestige: r.commander.prestige,
          stats: r.commander.stats,
          abilities: r.commander.abilities,
          powerScore: r.commander.powerScore,
        },
        provenance: {
          rulesetVersion: r.commander.rulesetVersion,
          contentHash: r.commander.contentHash,
          derivationCount: r.commander.derivationCount,
          derivedAt: r.commander.derivedAt,
        },
      };
    });

    return success(
      {
        nftCommanders,
        freeCommanders: freeCommanderTemplates().map((t) => ({ ...t, eligible: true })),
        rulesetVersion: currentRulesetVersion(),
        walletsChecked: verified.length,
        freshness: fresh ? ("live" as const) : ("cached" as const),
        slotContract: {
          activeCommanderLimit: 1,
          note: "One active commander per competitive deck. Multiple holdings widen options, never simultaneous deployment. Commander selection does not replace the 10 standard troop/spell cards.",
        },
      },
      { requestId }
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.status >= 500) {
      logger.error("player commanders failure", { requestId });
    }
    return failure(err, requestId);
  }
}
