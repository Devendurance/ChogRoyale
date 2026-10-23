// Shared test fixtures for the battle suite. Not a test file.
import { createHash } from "crypto";
import { freeStarterSlot, commanderCardId } from "@/lib/combat";
import { CHOG_GENESIS_ADDRESS, MONAD_CHAIN_ID } from "@/lib/chain";
import { derivePatronConfig, type PatronTraitInput } from "@/lib/patrons";
import type { CommanderClass } from "@/lib/commanders";
import type { CommanderGrant } from "@/server/battle/entitlement";
import { PatronUnavailableError, type LockedPatron, type PatronSource } from "@/server/battle/patron-source";
import type { TrustedLoadout } from "@/server/battle/session";

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

export function freeGrant(cls: CommanderClass): CommanderGrant {
  const slot = freeStarterSlot(cls);
  return {
    slot,
    identity: {
      kind: "free",
      commanderId: slot.commanderId,
      cardId: commanderCardId(slot.commanderId),
      class: cls,
      variant: "free",
      prestige: "Free",
      name: `${cap(cls)} Commander`,
      tokenId: null,
      imageOriginal: null,
      rulesetVersion: "v1",
      derivationHash: slot.definition.derivationHash,
      basis: "free",
      verifiedAt: null,
    },
    owner: null,
  };
}

/** Synthetic NFT grant matching entitlement.ts output (direct-owner basis). */
export function nftGrant(tokenId: string, owner: string, cls: CommanderClass = "scout"): CommanderGrant {
  const base = freeStarterSlot(cls);
  const slot = { commanderId: `nft-${tokenId}`, definition: base.definition };
  return {
    slot,
    identity: {
      kind: "nft",
      commanderId: slot.commanderId,
      cardId: commanderCardId(slot.commanderId),
      class: cls,
      variant: "nft",
      prestige: "Genesis",
      name: `Chog Genesis #${tokenId}`,
      tokenId,
      imageOriginal: null,
      rulesetVersion: "v1",
      derivationHash: base.definition.derivationHash,
      basis: "direct-owner",
      verifiedAt: new Date().toISOString(),
    },
    owner,
  };
}

export function makeLoadout(cards: string[], cls: CommanderClass = "scout"): TrustedLoadout {
  return { cards, grant: freeGrant(cls) };
}

export function makeLoadoutWithGrant(cards: string[], grant: CommanderGrant): TrustedLoadout {
  return { cards, grant };
}

/**
 * OFFLINE FIXTURE, not an indexed record: a LockedPatron built through the
 * same derivation as the production source (real derivePatronConfig over
 * placeholder trait inputs, 64-hex content hash), without any DB. It verifies
 * under verifyLockedPatron by construction, so it exercises battle plumbing
 * only. Genuine-source acceptance must go through the indexed DB path
 * (productionPatronSource + lockedPatronFromNft over upserted rows).
 * Distinct tokenIds/traits produce distinct schedules.
 */
export function testLockedPatron(tokenId = "42"): LockedPatron {
  const attributes: PatronTraitInput[] = [
    { trait_type: "Background", value: "Crimson Glow" },
    { trait_type: "Aura", value: "Ember Glow" },
    { trait_type: "Tier", value: "Rare" },
  ];
  const metadataContentHash = createHash("sha256").update(`test-metadata:${tokenId}`).digest("hex");
  const name = `CHOG #${tokenId}`;
  const config = derivePatronConfig({ tokenId, attributes, metadataContentHash, name });
  return {
    source: "indexed-genesis",
    chainId: MONAD_CHAIN_ID,
    contractAddress: CHOG_GENESIS_ADDRESS,
    tokenId,
    name,
    attributes,
    metadataContentHash,
    config,
  };
}

/** PatronSource stub returning a fixed locked patron (or rejecting). */
export function testPatronSource(patron: LockedPatron | null = testLockedPatron()): PatronSource {
  return {
    lock: () => (patron ? Promise.resolve(JSON.parse(JSON.stringify(patron)) as LockedPatron) : Promise.reject(new PatronUnavailableError("No eligible indexed Chog Genesis patron"))),
  };
}
