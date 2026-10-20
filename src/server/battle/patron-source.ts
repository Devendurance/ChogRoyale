// B2.8c authentic Arena Patron source. Battle matches no longer use the
// synthetic FAIRNESS_PATRONS trait sets: each match locks one real indexed
// Chog Genesis token, selected server-side from the resolved-metadata pool.
// The locked snapshot travels in settlement evidence (formatVersion 2) so
// settlement and legacy can re-derive the patron config and Chaos schedule
// from durable rows alone.
//
// Ownership is never read here: patron selection is prestige-only (B1 rule).
// Provenance is explicit on the LockedPatron, never inferred from tokenId.

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { getNftByTokenId } from "@/db/nfts";
import { nftMetadata, nftTokens } from "@/db/schema";
import { CHOG_GENESIS_ADDRESS, MONAD_CHAIN_ID } from "@/lib/chain";
import { deriveChaosSchedule } from "@/lib/chaos";
import type { CombatConfig } from "@/lib/combat";
import { derivePatronConfig, selectPatronTokenId, type PatronConfig, type PatronTraitInput } from "@/lib/patrons";

const PATRON_TRAIT_TYPES = new Set(["Tier", "Aura", "Background"]);

export interface LockedPatron {
  source: "indexed-genesis";
  chainId: 143;
  /** Lowercase Chog Genesis contract address. */
  contractAddress: string;
  tokenId: string;
  name: string | null;
  /** String-valued Tier/Aura/Background entries from attributesOriginal, original order. */
  attributes: PatronTraitInput[];
  metadataContentHash: string;
  config: PatronConfig;
}

export class PatronUnavailableError extends Error {}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

type NftRecord = NonNullable<Awaited<ReturnType<typeof getNftByTokenId>>>;

/** Builds the locked snapshot from an indexed token row; throws otherwise. */
export function lockedPatronFromNft(nft: NftRecord): LockedPatron {
  const unavailable = (reason: string): never => {
    throw new PatronUnavailableError(reason);
  };
  if (nft.token.chainId !== MONAD_CHAIN_ID) unavailable(`patron token ${nft.token.tokenId}: wrong chain`);
  if (nft.token.contractAddress.toLowerCase() !== CHOG_GENESIS_ADDRESS) unavailable(`patron token ${nft.token.tokenId}: not a Chog Genesis token`);
  const meta = nft.metadata;
  if (!meta || meta.status !== "resolved" || !meta.contentHash || meta.contentHash === "unresolved") {
    unavailable(`patron token ${nft.token.tokenId}: metadata not resolved`);
  }
  const raw = Array.isArray(meta!.attributesOriginal) ? (meta!.attributesOriginal as PatronTraitInput[]) : [];
  const attributes = raw.filter(
    (a): a is PatronTraitInput & { value: string } =>
      !!a && typeof a.trait_type === "string" && PATRON_TRAIT_TYPES.has(a.trait_type) && typeof a.value === "string"
  );
  const config = derivePatronConfig({
    tokenId: nft.token.tokenId,
    attributes,
    metadataContentHash: meta!.contentHash,
    name: meta!.name ?? null,
  });
  return {
    source: "indexed-genesis",
    chainId: MONAD_CHAIN_ID,
    contractAddress: CHOG_GENESIS_ADDRESS,
    tokenId: nft.token.tokenId,
    name: meta!.name ?? null,
    attributes,
    metadataContentHash: meta!.contentHash,
    config,
  };
}

/**
 * Pure re-verification of a locked snapshot: provenance fields must name the
 * Genesis collection on Monad and the stored config must re-derive exactly
 * (configHash included) from the snapshot's traits.
 */
export function verifyLockedPatron(p: LockedPatron): void {
  const fail = (reason: string): never => {
    throw new PatronUnavailableError(`locked patron invalid: ${reason}`);
  };
  if (p?.source !== "indexed-genesis") fail("source");
  if (p.chainId !== MONAD_CHAIN_ID) fail("chainId");
  if (typeof p.contractAddress !== "string" || p.contractAddress.toLowerCase() !== CHOG_GENESIS_ADDRESS) fail("contractAddress");
  if (typeof p.tokenId !== "string" || !/^[0-9]{1,78}$/.test(p.tokenId)) fail("tokenId");
  if (typeof p.metadataContentHash !== "string" || !/^[0-9a-f]{64}$/.test(p.metadataContentHash)) fail("metadataContentHash");
  const rederived = derivePatronConfig({
    tokenId: p.tokenId,
    attributes: Array.isArray(p.attributes) ? p.attributes : null,
    metadataContentHash: p.metadataContentHash,
    name: p.name ?? null,
  });
  // Canonical compare: evidence jsonb may return object keys in any order.
  if (canonicalJson(rederived) !== canonicalJson(p.config)) fail("config does not re-derive");
}

/**
 * Verifies a locked patron against a recorded combat config: the config's
 * Chaos schedule must be the one derived from this patron, this server seed
 * and the public match key arena:<tokenId>.
 */
export function verifyPatronEvidence(config: CombatConfig, patron: LockedPatron): void {
  verifyLockedPatron(patron);
  const fail = (reason: string): never => {
    throw new PatronUnavailableError(`patron evidence invalid: ${reason}`);
  };
  const chaos = config.chaos;
  if (!chaos) throw new PatronUnavailableError("patron evidence invalid: config has no chaos schedule");
  if (chaos.patronTokenId !== patron.tokenId) fail("schedule patron token mismatch");
  if (chaos.patronConfigHash !== patron.config.configHash) fail("schedule patron config hash mismatch");
  const rederived = deriveChaosSchedule({
    patron: patron.config,
    serverSeed: config.seed,
    matchKey: `arena:${patron.tokenId}`,
  });
  if (rederived.scheduleHash !== chaos.scheduleHash) fail("schedule hash does not re-derive");
}

/** Locks one patron per match. Implemented by the production DB source. */
export interface PatronSource {
  lock(selectionSeed: string): Promise<LockedPatron>;
}

/** Production source: the resolved indexed Chog Genesis pool. */
export function productionPatronSource(): PatronSource {
  return {
    async lock(selectionSeed: string): Promise<LockedPatron> {
      const db = getDb();
      const rows = await db
        .select({ tokenId: nftTokens.tokenId })
        .from(nftTokens)
        .innerJoin(nftMetadata, eq(nftMetadata.nftId, nftTokens.id))
        .where(
          and(
            eq(nftMetadata.status, "resolved"),
            eq(nftTokens.chainId, MONAD_CHAIN_ID),
            sql`lower(${nftTokens.contractAddress}) = ${CHOG_GENESIS_ADDRESS}`
          )
        );
      const pool = rows.map((r) => r.tokenId);
      if (pool.length === 0) throw new PatronUnavailableError("No eligible indexed Chog Genesis patron");
      const tokenId = selectPatronTokenId(selectionSeed, pool);
      const nft = await getNftByTokenId(tokenId);
      if (!nft) throw new PatronUnavailableError(`patron token ${tokenId}: not indexed`);
      return lockedPatronFromNft(nft);
    },
  };
}
