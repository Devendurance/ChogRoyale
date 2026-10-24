// B3.2a commander entitlement. Resolves a player's commander claim into a
// trusted CommanderSlotInput plus a display identity. Free starters resolve
// offline; NFT commanders are proven onchain (ownerOf) against the player's
// verified linked wallets, then cross-checked against the persisted B1
// derivation before validateCommanders accepts the snapshot. Reads only:
// this module never writes to the DB and never accepts wallet addresses
// from the client.

import { AppError } from "@/lib/errors";
import {
  commanderCardId,
  freeStarterSlot,
  validateCommanders,
  type CommanderSlotInput,
} from "@/lib/combat";
import type { CommanderClass } from "@/lib/commanders";
import type { Commander, PlayerWallet } from "@/db/schema";
import type { CollectionVerification } from "@/lib/nft-contract";
import type { CommanderChoice, CommanderIdentity } from "@/lib/battle-protocol";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT } from "@/lib/battle-protocol";

// B4 extension point (P5f.1): an active commander_loans row delegates the
// use right to a friend. Resolved in the NFT path below; never inferred.
export type EntitlementBasis = "free" | "direct-owner" | "borrowed";

export interface NftCommanderRecord {
  tokenId: string;
  name: string | null;
  imageOriginal: string | null;
  commander: Commander;
}

export interface EntitlementDeps {
  /** Lowercase normalized addresses, verifiedAt !== null rows only. */
  verifiedWallets(playerId: string): Promise<string[]>;
  ownerOf(tokenId: bigint): Promise<{ owner: string; chainId: number }>;
  /** Current commander ruleset row plus display fields, null when not derived. */
  loadNftCommander(tokenId: string): Promise<NftCommanderRecord | null>;
  /** The usable ACTIVE loan for a token, or null. Absent when lending is unwired. */
  activeTokenLoan?(tokenId: string): Promise<{ loanId: string; ownerId: string; borrowerId: string } | null>;
  /** True when the lending pair may still interact (accepted friends, no blocks). */
  borrowSocialCheck?(ownerId: string, borrowerId: string): Promise<boolean>;
  timeoutMs?: number;
  now?: () => Date;
}

export interface CommanderGrant {
  slot: CommanderSlotInput;
  identity: CommanderIdentity;
  /** Lowercase verified owner wallet for nft grants, null for free. */
  owner: string | null;
}

const UNAVAILABLE = "NFT ownership check unavailable, choose a free commander or retry";

function timeout<T>(ms: number): { promise: Promise<T>; cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new AppError("SERVICE_UNAVAILABLE", UNAVAILABLE, { retryable: true })), ms);
  });
  return { promise, cancel: () => clearTimeout(t) };
}

const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

export async function resolveCommander(playerId: string, choice: CommanderChoice, deps: EntitlementDeps): Promise<CommanderGrant> {
  if (choice.kind === "free") {
    const slot = freeStarterSlot(choice.class);
    const cls = choice.class;
    const identity: CommanderIdentity = {
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
    };
    return { slot, identity, owner: null };
  }

  if (choice.chainId !== CHOG_GENESIS_CHAIN_ID) {
    throw new AppError("BAD_REQUEST", `Wrong chain for Chog Genesis: ${choice.chainId}`);
  }
  if (choice.contract.toLowerCase() !== CHOG_GENESIS_CONTRACT.toLowerCase()) {
    throw new AppError("BAD_REQUEST", "Wrong contract for Chog Genesis");
  }
  const { parseTokenId } = await import("@/lib/nft-contract");
  const tokenId = parseTokenId(choice.tokenId);

  const t = timeout<never>(deps.timeoutMs ?? 5000);
  let res: { owner: string; chainId: number };
  try {
    res = await Promise.race([deps.ownerOf(tokenId), t.promise]);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      throw new AppError("NOT_FOUND", "Token does not exist");
    }
    throw new AppError("SERVICE_UNAVAILABLE", UNAVAILABLE, { retryable: true });
  } finally {
    t.cancel();
  }
  if (res.chainId !== CHOG_GENESIS_CHAIN_ID) {
    throw new AppError("SERVICE_UNAVAILABLE", UNAVAILABLE, { retryable: true });
  }

  const wallets = await deps.verifiedWallets(playerId);
  const owner = res.owner.trim().toLowerCase();
  const tokenStr = tokenId.toString();
  // An active loan freezes direct use: only the recorded borrower may field
  // the token, and only while the lender still owns it onchain. Everyone
  // else, including the lender, is refused so one token never grants two
  // simultaneous entitlements.
  const tokenLoan = deps.activeTokenLoan ? await deps.activeTokenLoan(tokenStr) : null;
  let basis: "direct-owner" | "borrowed";
  if (wallets.includes(owner)) {
    if (tokenLoan && tokenLoan.borrowerId !== playerId) {
      throw new AppError(
        "FORBIDDEN",
        playerId === tokenLoan.ownerId ? "This commander is currently on loan" : "NFT is not owned by a verified linked wallet"
      );
    }
    basis = "direct-owner";
  } else {
    if (!tokenLoan || tokenLoan.borrowerId !== playerId || !deps.borrowSocialCheck) {
      throw new AppError("FORBIDDEN", "NFT is not owned by a verified linked wallet");
    }
    const social = await deps.borrowSocialCheck(tokenLoan.ownerId, playerId);
    if (!social) throw new AppError("FORBIDDEN", "This commander is no longer available");
    const ownerWallets = await deps.verifiedWallets(tokenLoan.ownerId);
    if (!ownerWallets.includes(owner)) {
      throw new AppError("FORBIDDEN", "This commander is no longer available");
    }
    basis = "borrowed";
  }

  const rec = await deps.loadNftCommander(tokenId.toString());  if (!rec) throw new AppError("BAD_REQUEST", "Commander not derived for this token");
  const row = rec.commander;
  if (row.tokenId !== tokenId.toString()) {
    throw new AppError("BAD_REQUEST", "Commander not derived for this token");
  }
  if (row.rulesetVersion !== "v1") {
    throw new AppError("BAD_REQUEST", "Commander is not on the current ruleset");
  }

  const slot: CommanderSlotInput = {
    commanderId: `nft-${tokenId.toString()}`,
    definition: {
      rulesetVersion: row.rulesetVersion as "v1",
      class: row.class as CommanderClass,
      affinity: (row.affinity ?? row.class) as CommanderClass,
      scores: row.scores as CommanderSlotInput["definition"]["scores"],
      signals: row.sourceTraits as CommanderSlotInput["definition"]["signals"],
      unmatchedTraits: row.unmatchedTraits as CommanderSlotInput["definition"]["unmatchedTraits"],
      stats: row.stats as CommanderSlotInput["definition"]["stats"],
      abilities: row.abilities as CommanderSlotInput["definition"]["abilities"],
      variant: row.variant,
      prestige: row.prestige ?? "",
      powerScore: row.powerScore ?? 0,
      derivationHash: row.contentHash,
    },
  };
  // Forged/mismatched snapshot guard: wrong abilities, bad class or a
  // missing derivation hash are rejected by the engine's own validator.
  validateCommanders([slot, null]);

  const identity: CommanderIdentity = {
    kind: "nft",
    commanderId: slot.commanderId,
    cardId: commanderCardId(slot.commanderId),
    class: row.class,
    variant: row.variant,
    prestige: row.prestige ?? "",
    name: rec.name ?? `Chog Genesis #${tokenId.toString()}`,
    tokenId: tokenId.toString(),
    imageOriginal: rec.imageOriginal,
    rulesetVersion: row.rulesetVersion,
    derivationHash: row.contentHash,
    basis,
    verifiedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  return { slot, identity, owner };
}

/** Verified, normalized linked addresses only; unverified rows never authorize. */
export function verifiedAddresses(wallets: PlayerWallet[]): string[] {
  return wallets.filter((w) => w.verifiedAt !== null).map((w) => w.addressNormalized.toLowerCase());
}

let collectionCache: { at: number; value: CollectionVerification } | null = null;
const COLLECTION_CACHE_MS = 10 * 60 * 1000;

async function verifiedCollection(): Promise<CollectionVerification> {
  if (collectionCache && Date.now() - collectionCache.at < COLLECTION_CACHE_MS) return collectionCache.value;
  const { verifyCollection } = await import("@/lib/nft-contract");
  const value = await verifyCollection();
  collectionCache = { at: Date.now(), value };
  return value;
}

/** Production deps: Neon reads + live Monad RPC. DB modules are imported
 * lazily so tests that inject deps never touch the DB. */
export function productionEntitlementDeps(): EntitlementDeps {
  return {
    async verifiedWallets(playerId) {
      const { listWallets } = await import("@/db/players");
      return verifiedAddresses(await listWallets(playerId));
    },
    async ownerOf(tokenId) {
      const collection = await verifiedCollection();
      const { readOwner } = await import("@/lib/nft-contract");
      const r = await readOwner(tokenId);
      return { owner: r.owner, chainId: collection.chainId };
    },
    async loadNftCommander(tokenId) {
      const { getCommanderByTokenId } = await import("@/db/commanders");
      const commander = await getCommanderByTokenId(tokenId);
      if (!commander) return null;
      const { getNftByTokenId } = await import("@/db/nfts");
      const nft = await getNftByTokenId(tokenId);
      return {
        tokenId,
        name: nft?.metadata?.name ?? null,
        imageOriginal: nft?.metadata?.imageOriginal ?? null,
        commander,
      };
    },
  };
}
