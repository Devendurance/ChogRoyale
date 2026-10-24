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
import { getAcceptedFriendship } from "@/db/friendships";
import { canSociallyInteract } from "@/db/blocks";
import { getActiveLoanForToken, listLoansForBorrower, listLoansForOwner } from "@/db/lending";
import { productionEntitlementDeps, resolveCommander } from "@/server/battle/entitlement";
import type { CommanderChoice } from "@/lib/battle-protocol";
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

    // Lending state is part of the authenticated commander read. This keeps
    // the deck selector from treating a lent token as owned or hiding a valid
    // borrowed token. A missing lending schema fails the whole read honestly.
    const [lentRows, borrowedRows] = await Promise.all([
      listLoansForOwner(player.id),
      listLoansForBorrower(player.id),
    ]);
    const activeLent = new Map<string, { id: string; endsAt: string }>();
    for (const loan of lentRows) {
      const active = await getActiveLoanForToken(loan.tokenId);
      if (active && active.ownerId === player.id) {
        activeLent.set(loan.tokenId, { id: active.id, endsAt: active.endsAt.toISOString() });
      }
    }

    const activeBorrowed = borrowedRows.filter((loan) => loan.status === "active");
    const holdings = verified.length > 0 ? await getHoldingsByOwners(verified) : [];
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

    const borrowedTokenIds = activeBorrowed.map((loan) => loan.tokenId).filter((tokenId) => !eligibleIds.has(tokenId));
    const rows = await getCommanderEligibility([...holdings.map((h) => h.tokenId), ...borrowedTokenIds]);
    const holdingOf = new Map(holdings.map((h) => [h.tokenId, h]));
    const borrowedByToken = new Map(activeBorrowed.map((loan) => [loan.tokenId, loan]));
    const entitlement = productionEntitlementDeps();
    const nftCommanders = await Promise.all(rows.map(async (r) => {
      const loan = borrowedByToken.get(r.tokenId);
      const lent = activeLent.get(r.tokenId);
      const borrowed = Boolean(loan);
      let eligible = eligibleIds.has(r.tokenId) && !lent;
      const basis: "owned" | "borrowed" = borrowed ? "borrowed" : "owned";
      let reason: string | undefined;
      let borrowedName: string | null = null;
      let borrowedImageOriginal: string | null = null;

      if (borrowed) {
        try {
          const choice: CommanderChoice = {
            kind: "nft",
            chainId: loan!.chainId,
            contract: loan!.contract,
            tokenId: loan!.tokenId,
          };
          const grant = await resolveCommander(player.id, choice, {
            ...entitlement,
            activeTokenLoan: async (tokenId) => {
              const current = await getActiveLoanForToken(tokenId);
              return current
                ? { loanId: current.id, ownerId: current.ownerId, borrowerId: current.borrowerId }
                : null;
            },
            borrowSocialCheck: async (ownerId, borrowerId) => {
              const social = await canSociallyInteract(ownerId, borrowerId);
              return social.allowed && (await getAcceptedFriendship(ownerId, borrowerId)) !== null;
            },
          });
          eligible = grant.identity.kind === "nft" && grant.identity.basis === "borrowed";
          borrowedName = grant.identity.name;
          borrowedImageOriginal = grant.identity.imageOriginal;
          if (!eligible) reason = "This borrowed commander is not currently available.";
        } catch {
          eligible = false;
          reason = "This borrowed commander could not be verified right now.";
        }
      } else if (lent) {
        eligible = false;
        reason = "This commander is currently lent and unavailable.";
      }

      const holding = holdingOf.get(r.tokenId);
      const media = {
        name: holding?.name ?? borrowedName,
        imageOriginal: holding?.image ?? borrowedImageOriginal,
        imageUrl: displayUrl(holding?.image ?? borrowedImageOriginal),
      };
      if (!r.commander) {
        return {
          tokenId: r.tokenId,
          ...media,
          basis,
          ownership: lent ? ("lent" as const) : basis,
          loan: loan || lent ? { id: (loan ?? lent)!.id, endsAt: (loan ?? lent)!.endsAt } : null,
          status: "pending" as const,
          metadataStatus: r.metadataStatus ?? "missing",
          eligible: false,
          reason:
            reason ??
            (r.metadataStatus === "resolved"
              ? "Derived definition not yet persisted; retry after the derive pass"
              : "NFT metadata has not been resolved yet"),
        };
      }
      return {
        tokenId: r.tokenId,
        ...media,
        basis,
        ownership: lent ? ("lent" as const) : basis,
        loan: loan || lent ? { id: (loan ?? lent)!.id, endsAt: (loan ?? lent)!.endsAt } : null,
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
    }));

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
