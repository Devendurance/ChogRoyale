import { describe, expect, it } from "vitest";
import {
  productionEntitlementDeps,
  resolveCommander,
  verifiedAddresses,
  type EntitlementDeps,
  type NftCommanderRecord,
} from "@/server/battle/entitlement";
import {
  CHOG_GENESIS_CHAIN_ID,
  CHOG_GENESIS_CONTRACT,
  type CommanderChoice,
} from "@/lib/battle-protocol";
import { MONAD_CHAIN_ID, CHOG_GENESIS_ADDRESS } from "@/lib/chain";
import { freeStarterSlot, commanderCardId, initMatch, stepMatch, commanderAbilityStatus } from "@/lib/combat";
import { scenarioConfig } from "@/lib/arena-scenarios";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import type { Commander, PlayerWallet } from "@/db/schema";

const OWNER = "0xaaaa1111";
const OTHER = "0xbbbb2222";
const TOKEN = "1462";

function nftRow(tokenId: string, cls: CommanderClass = "scout", over: Partial<Commander> = {}): Commander {
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
    ...over,
  } as unknown as Commander;
}

const record = (tokenId: string, over: Partial<Commander> = {}): NftCommanderRecord => ({
  tokenId,
  name: "CHOG #1462",
  imageOriginal: "ipfs://bafy-image",
  commander: nftRow(tokenId, "scout", over),
});

function deps(over: Partial<EntitlementDeps> = {}): EntitlementDeps {
  return {
    verifiedWallets: async () => [OWNER],
    ownerOf: async () => ({ owner: OWNER, chainId: CHOG_GENESIS_CHAIN_ID }),
    loadNftCommander: async (t) => record(t),
    timeoutMs: 60,
    now: () => new Date("2026-02-01T00:00:00.000Z"),
    ...over,
  };
}

const nftChoice = (over: Partial<Extract<CommanderChoice, { kind: "nft" }>> = {}): CommanderChoice => ({
  kind: "nft",
  chainId: CHOG_GENESIS_CHAIN_ID,
  contract: CHOG_GENESIS_CONTRACT,
  tokenId: TOKEN,
  ...over,
});

describe("B3.2a entitlement: free commanders", () => {
  for (const cls of ["bulwark", "reaver", "deadeye", "scout", "warden"] as const) {
    it(`grants the free ${cls} starter slot`, async () => {
      const g = await resolveCommander("p1", { kind: "free", class: cls }, deps());
      expect(g.slot).toEqual(freeStarterSlot(cls));
      expect(g.owner).toBeNull();
      expect(g.identity).toMatchObject({ kind: "free", class: cls, variant: "free", prestige: "Free", tokenId: null, basis: "free", verifiedAt: null });
      expect(g.identity.cardId).toBe(commanderCardId(g.slot.commanderId));
    });
  }
});

describe("B3.2a entitlement: NFT commanders", () => {
  it("grants an owned derived NFT with a direct-owner identity", async () => {
    const g = await resolveCommander("p1", nftChoice(), deps());
    expect(g.slot.commanderId).toBe(`nft-${TOKEN}`);
    expect(g.slot.definition.class).toBe("scout");
    expect(g.slot.definition.derivationHash).toBe(`contenthash-${TOKEN}`);
    expect(g.owner).toBe(OWNER);
    expect(g.identity).toMatchObject({
      kind: "nft",
      basis: "direct-owner",
      tokenId: TOKEN,
      name: "CHOG #1462",
      imageOriginal: "ipfs://bafy-image",
      variant: "assault",
      prestige: "Mythic",
      verifiedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("rejects an NFT whose owner is not a verified linked wallet", async () => {
    await expect(resolveCommander("p1", nftChoice(), deps({ ownerOf: async () => ({ owner: OTHER, chainId: CHOG_GENESIS_CHAIN_ID }) }))).rejects.toThrow(/not owned by a verified linked wallet/);
  });

  it("rejects when the player has no usable verified wallet rows", async () => {
    const wallets = [
      { addressNormalized: OWNER, verifiedAt: null },
      { addressNormalized: OTHER, verifiedAt: new Date() },
    ] as PlayerWallet[];
    expect(verifiedAddresses(wallets)).toEqual([OTHER]);
    await expect(resolveCommander("p1", nftChoice(), deps({ verifiedWallets: async () => verifiedAddresses(wallets) }))).rejects.toThrow(/not owned/);
  });

  it("rejects the wrong contract and the wrong chain id", async () => {
    await expect(resolveCommander("p1", nftChoice({ contract: "0x0000000000000000000000000000000000000001" }), deps())).rejects.toThrow(/Wrong contract/);
    await expect(resolveCommander("p1", nftChoice({ chainId: 1 }), deps())).rejects.toThrow(/Wrong chain/);
  });

  it("rejects when ownerOf reports a different chain", async () => {
    await expect(resolveCommander("p1", nftChoice(), deps({ ownerOf: async () => ({ owner: OWNER, chainId: 1 }) }))).rejects.toThrow(/unavailable/i);
  });

  it("rejects a nonexistent token", async () => {
    const { AppError } = await import("@/lib/errors");
    await expect(resolveCommander("p1", nftChoice(), deps({ ownerOf: async () => Promise.reject(new AppError("NOT_FOUND", "revert")) as never }))).rejects.toThrow(/Token does not exist/);
  });

  it("fails closed when the ownership check hangs", async () => {
    const hanging = deps({ ownerOf: () => new Promise<{ owner: string; chainId: number }>(() => {}) });
    await expect(resolveCommander("p1", nftChoice(), hanging)).rejects.toThrow(/ownership check unavailable/i);
  });

  it("rejects a token with no derived commander row", async () => {
    await expect(resolveCommander("p1", nftChoice(), deps({ loadNftCommander: async () => null }))).rejects.toThrow(/not derived/);
  });

  it("rejects mismatched snapshots: wrong-ability row, wrong-token row, non-v1 ruleset", async () => {
    const forgedAbilities = nftRow(TOKEN, "scout", { abilities: freeCommanderTemplates().find((t) => t.class === "reaver")!.abilities });
    await expect(resolveCommander("p1", nftChoice(), deps({ loadNftCommander: async (t) => ({ tokenId: t, name: null, imageOriginal: null, commander: forgedAbilities }) }))).rejects.toThrow(/roster/);
    const wrongToken = nftRow("9999");
    await expect(resolveCommander("p1", nftChoice(), deps({ loadNftCommander: async () => ({ tokenId: "9999", name: null, imageOriginal: null, commander: wrongToken }) }))).rejects.toThrow(/not derived/);
    const wrongRuleset = nftRow(TOKEN, "scout", { rulesetVersion: "v2" });
    await expect(resolveCommander("p1", nftChoice(), deps({ loadNftCommander: async (t) => ({ tokenId: t, name: null, imageOriginal: null, commander: wrongRuleset }) }))).rejects.toThrow(/current ruleset/);
  });

  it("keeps the protocol chain constants identical to chain.ts", () => {
    expect(CHOG_GENESIS_CHAIN_ID).toBe(MONAD_CHAIN_ID);
    expect(CHOG_GENESIS_CONTRACT.toLowerCase()).toBe(CHOG_GENESIS_ADDRESS.toLowerCase());
  });

  it("production deps resolve lazily without touching the DB", () => {
    const d = productionEntitlementDeps();
    expect(typeof d.ownerOf).toBe("function");
    expect(typeof d.verifiedWallets).toBe("function");
    expect(typeof d.loadNftCommander).toBe("function");
  });
});

describe("B3.2a parity: free vs NFT commander of the same class fight identically", () => {
  it("deployed entities have identical hp, damage, range, speed, armor and cost", async () => {
    const free = freeStarterSlot("scout");
    const nftGrant = await resolveCommander("p1", nftChoice(), deps());
    const nft = { ...nftGrant.slot, definition: { ...nftGrant.slot.definition, variant: "bastion", prestige: "Legend" } };
    const deck = (cardId: string) => [cardId, "choglings", "rift_runner", "chaos_archer", "sparkcaster", "boulderback", "hexwing", "frostshell"];
    const cfg = scenarioConfig(deck(commanderCardId(free.commanderId)), deck(commanderCardId(nft.commanderId)), null, "parity", [free, nft]);
    const s = initMatch(cfg);
    stepMatch(s, [
      { seq: 1, player: 0, tick: 1, cardId: commanderCardId(free.commanderId), x: 50, y: 60 },
      { seq: 2, player: 1, tick: 1, cardId: commanderCardId(nft.commanderId), x: 50, y: 100 },
    ]);
    const [c0, c1] = [s.commanders.find((c) => c.owner === 0)!, s.commanders.find((c) => c.owner === 1)!];
    for (const k of ["hp", "maxHp", "damage", "range", "speed", "sight", "armor", "interval", "hitsAir"] as const) {
      expect(c0[k], k).toEqual(c1[k]);
    }
    expect(commanderAbilityStatus(s, 0).map((a) => a.abilityId)).toEqual(commanderAbilityStatus(s, 1).map((a) => a.abilityId));
  });
});
