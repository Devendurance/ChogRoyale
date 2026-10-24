// P5f.1 borrowed entitlement: the NFT path with an active loan wired in.
// Ownership reads are controlled stubs; no live chain is touched.
import { describe, expect, it } from "vitest";
import { resolveCommander, type EntitlementDeps, type NftCommanderRecord } from "@/server/battle/entitlement";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, type CommanderChoice } from "@/lib/battle-protocol";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import type { Commander } from "@/db/schema";

const LENDER_WALLET = `0x${"a".repeat(40)}`;
const STRANGER_WALLET = `0x${"b".repeat(40)}`;
const LENDER = "lender-player";
const BORROWER = "borrower-player";
const TOKEN = "1462";

function nftRow(tokenId: string, cls: CommanderClass = "scout"): Commander {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    id: "cmdr-row",
    nftId: "nft-row",
    rulesetVersion: "v1",
    tokenId,
    class: cls,
    affinity: cls,
    stats: t.stats,
    abilities: t.abilities,
    variant: "assault",
    prestige: "Mythic",
    sourceTraits: [{ matchedRule: "r", class: cls, weight: 1, reason: "test" }],
    unmatchedTraits: [],
    scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 },
    powerScore: t.powerScore,
    contentHash: `contenthash-${tokenId}`,
    previousContentHash: null,
    derivationCount: 1,
    derivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Commander;
}

const record = (tokenId: string): NftCommanderRecord => ({
  tokenId,
  name: "CHOG #1462",
  imageOriginal: "ipfs://bafy-image",
  commander: nftRow(tokenId),
});

const choice: CommanderChoice = {
  kind: "nft",
  chainId: CHOG_GENESIS_CHAIN_ID,
  contract: CHOG_GENESIS_CONTRACT,
  tokenId: TOKEN,
};

function deps(over: Partial<EntitlementDeps> = {}): EntitlementDeps {
  return {
    // Lender owns the token onchain; nobody else holds a verified wallet.
    verifiedWallets: async (pid) => (pid === LENDER ? [LENDER_WALLET] : []),
    ownerOf: async () => ({ owner: LENDER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }),
    loadNftCommander: async (t) => record(t),
    activeTokenLoan: async () => ({ loanId: "loan-1", ownerId: LENDER, borrowerId: BORROWER }),
    borrowSocialCheck: async () => true,
    timeoutMs: 60,
    now: () => new Date("2026-02-01T00:00:00.000Z"),
    ...over,
  };
}

describe("P5f.1 borrowed entitlement", () => {
  it("grants the borrower a borrowed-basis slot from the same snapshot", async () => {
    const g = await resolveCommander(BORROWER, choice, deps());
    expect(g.slot.commanderId).toBe(`nft-${TOKEN}`);
    expect(g.identity.basis).toBe("borrowed");
    expect(g.identity.tokenId).toBe(TOKEN);
    expect(g.identity.verifiedAt).toBe("2026-02-01T00:00:00.000Z");
    // Provenance carries the lender's wallet so settlement can audit it.
    expect(g.owner).toBe(LENDER_WALLET);
  });

  it("the lender loses use while their token is on loan", async () => {
    await expect(resolveCommander(LENDER, choice, deps())).rejects.toThrow("currently on loan");
  });

  it("a stranger cannot ride someone else's loan", async () => {
    await expect(resolveCommander("stranger", choice, deps())).rejects.toThrow("not owned by a verified linked wallet");
  });

  it("revocation ends borrowed use without touching direct ownership", async () => {
    await expect(resolveCommander(BORROWER, choice, deps({ activeTokenLoan: async () => null }))).rejects.toThrow(
      "not owned by a verified linked wallet"
    );
    // The lender's own unloaned token still resolves direct-owner.
    const g = await resolveCommander(LENDER, choice, deps({ activeTokenLoan: async () => null }));
    expect(g.identity.basis).toBe("direct-owner");
  });

  it("unfriend or block after the loan denies borrowed use", async () => {
    await expect(
      resolveCommander(BORROWER, choice, deps({ borrowSocialCheck: async () => false }))
    ).rejects.toThrow("no longer available");
  });

  it("an onchain transfer during the loan fails closed", async () => {
    await expect(
      resolveCommander(
        BORROWER,
        choice,
        deps({ ownerOf: async () => ({ owner: STRANGER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }) })
      )
    ).rejects.toThrow("no longer available");
  });

  it("without loan wiring the direct-owner path is unchanged", async () => {
    const plain: EntitlementDeps = {
      verifiedWallets: async () => [LENDER_WALLET],
      ownerOf: async () => ({ owner: LENDER_WALLET, chainId: CHOG_GENESIS_CHAIN_ID }),
      loadNftCommander: async (t) => record(t),
      timeoutMs: 60,
    };
    const g = await resolveCommander(LENDER, choice, plain);
    expect(g.identity.basis).toBe("direct-owner");
  });
});
