import { eq, desc, sql, count } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  nftTokens,
  nftMetadata,
  nftOwnershipObservations,
  indexCheckpoints,
  nftTraitStats,
  type NftToken,
  type NftMetadataRow,
  type NftOwnershipObservation,
} from "@/db/schema";
import { CHOG_GENESIS_ADDRESS, MONAD_CHAIN_ID } from "@/lib/chain";
import type { ResolvedMetadata } from "@/lib/metadata";

export function nftIdentity(tokenId: string | bigint) {
  return {
    chainId: MONAD_CHAIN_ID,
    contractAddress: CHOG_GENESIS_ADDRESS,
    tokenId: tokenId.toString(),
  };
}

export async function upsertNftToken(input: {
  tokenId: string | bigint;
  tokenUriOriginal?: string | null;
}): Promise<NftToken> {
  const db = getDb();
  const identity = nftIdentity(input.tokenId);
  const rows = await db
    .insert(nftTokens)
    .values({
      ...identity,
      tokenUriOriginal: input.tokenUriOriginal ?? null,
    })
    .onConflictDoUpdate({
      target: [nftTokens.chainId, nftTokens.contractAddress, nftTokens.tokenId],
      set: {
        updatedAt: sql`now()`,
        ...(input.tokenUriOriginal !== undefined ? { tokenUriOriginal: input.tokenUriOriginal } : {}),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("NFT token upsert failed");
  return row;
}

export async function upsertNftMetadata(
  nftId: string,
  resolved: ResolvedMetadata
): Promise<NftMetadataRow> {
  const db = getDb();
  const rows = await db
    .insert(nftMetadata)
    .values({
      nftId,
      documentOriginal: resolved.document,
      name: resolved.name,
      description: resolved.description,
      imageOriginal: resolved.imageOriginal,
      attributesOriginal: resolved.attributesOriginal,
      contentHash: resolved.contentHash,
      status: "resolved",
      error: null,
      sourceUrl: resolved.sourceUrl,
      fetchedAt: resolved.fetchedAt,
    })
    .onConflictDoUpdate({
      target: [nftMetadata.nftId],
      set: {
        documentOriginal: resolved.document,
        name: resolved.name,
        description: resolved.description,
        imageOriginal: resolved.imageOriginal,
        attributesOriginal: resolved.attributesOriginal,
        contentHash: resolved.contentHash,
        status: "resolved",
        error: null,
        sourceUrl: resolved.sourceUrl,
        fetchedAt: resolved.fetchedAt,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("NFT metadata upsert failed");
  return row;
}

export async function recordMetadataFailure(
  nftId: string,
  input: { error: string; sourceUrl?: string | null }
): Promise<NftMetadataRow> {
  const db = getDb();
  // Never regress a resolved record: concurrent indexers may race (one
  // resolves while another throttles). Failed writes only apply when the
  // current row is missing or not resolved.
  const current = await db
    .select({ status: nftMetadata.status })
    .from(nftMetadata)
    .where(eq(nftMetadata.nftId, nftId))
    .limit(1);
  if (current[0]?.status === "resolved") {
    const rows = await db.select().from(nftMetadata).where(eq(nftMetadata.nftId, nftId)).limit(1);
    const row = rows[0];
    if (!row) throw new Error("NFT metadata failure record failed");
    return row;
  }
  const rows = await db
    .insert(nftMetadata)
    .values({
      nftId,
      documentOriginal: {},
      name: null,
      description: null,
      imageOriginal: null,
      attributesOriginal: null,
      contentHash: "unresolved",
      status: "failed",
      error: input.error.slice(0, 500),
      sourceUrl: input.sourceUrl ?? null,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [nftMetadata.nftId],
      set: {
        status: "failed",
        error: input.error.slice(0, 500),
        sourceUrl: input.sourceUrl ?? null,
        fetchedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("NFT metadata failure record failed");
  return row;
}

export async function recordOwnershipObservation(input: {
  nftId: string;
  ownerAddress: string;
  blockNumber?: string | null;
  blockHash?: string | null;
}): Promise<NftOwnershipObservation> {
  const db = getDb();
  const rows = await db
    .insert(nftOwnershipObservations)
    .values({
      nftId: input.nftId,
      ownerAddress: input.ownerAddress.trim(),
      ownerNormalized: input.ownerAddress.trim().toLowerCase(),
      blockNumber: input.blockNumber ?? null,
      blockHash: input.blockHash ?? null,
      source: "live",
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Ownership observation insert failed");
  return row;
}

export async function getNftByTokenId(tokenId: string | bigint): Promise<{
  token: NftToken;
  metadata: NftMetadataRow | null;
  latestObservation: NftOwnershipObservation | null;
} | null> {
  const db = getDb();
  const identity = nftIdentity(tokenId);
  const tokens = await db
    .select()
    .from(nftTokens)
    .where(eq(nftTokens.tokenId, identity.tokenId))
    .limit(1);
  const token = tokens[0];
  if (!token) return null;
  const meta = await db.select().from(nftMetadata).where(eq(nftMetadata.nftId, token.id)).limit(1);
  const obs = await db
    .select()
    .from(nftOwnershipObservations)
    .where(eq(nftOwnershipObservations.nftId, token.id))
    .orderBy(desc(nftOwnershipObservations.observedAt))
    .limit(1);
  return { token, metadata: meta[0] ?? null, latestObservation: obs[0] ?? null };
}

export async function getCheckpoint(key: string): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(indexCheckpoints).where(eq(indexCheckpoints.key, key)).limit(1);
  return rows[0]?.lastBlock ?? null;
}

export async function setCheckpoint(key: string, lastBlock: string): Promise<void> {
  const db = getDb();
  await db
    .insert(indexCheckpoints)
    .values({ key, lastBlock })
    .onConflictDoUpdate({ target: [indexCheckpoints.key], set: { lastBlock } });
}

export async function countIndexedTokens(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ count: count() }).from(nftTokens);
  return rows[0]?.count ?? 0;
}

export async function countMetadataByStatus(): Promise<{ resolved: number; failed: number }> {
  const db = getDb();
  const rows = await db
    .select({ status: nftMetadata.status, count: count() })
    .from(nftMetadata)
    .groupBy(nftMetadata.status);
  let resolved = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === "resolved") resolved = r.count;
    else if (r.status === "failed") failed = r.count;
  }
  return { resolved, failed };
}

export async function countObservations(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ count: count() }).from(nftOwnershipObservations);
  return rows[0]?.count ?? 0;
}

// Rebuilds the trait read model from preserved originals. Counts distinct
// NFTs per (type, value); values coerced to text with explicit rules so
// string "42" and numeric 42 stay distinct ("str:42" vs "num:42").
// Null-valued attributes count toward missing-trait coverage, not toward
// any value bucket.
export async function refreshTraitStats(): Promise<{ types: number; values: number }> {
  const db = getDb();
  const rows = await db
    .select({ id: nftTokens.id, attributes: nftMetadata.attributesOriginal })
    .from(nftTokens)
    .innerJoin(nftMetadata, eq(nftMetadata.nftId, nftTokens.id));
  const counts = new Map<string, { type: string; value: string; ids: Set<string> }>();
  for (const row of rows) {
    if (!Array.isArray(row.attributes)) continue;
    const seen = new Set<string>();
    for (const attr of row.attributes as Array<{ trait_type?: unknown; value?: unknown }>) {
      if (typeof attr?.trait_type !== "string") continue;
      if (attr.value === null || attr.value === undefined) continue;
      const value =
        typeof attr.value === "string"
          ? `str:${attr.value}`
          : typeof attr.value === "number"
            ? `num:${String(attr.value)}`
            : `json:${JSON.stringify(attr.value)}`;
      const key = `${attr.trait_type}\0${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { type: attr.trait_type, value, ids: new Set<string>() };
      entry.ids.add(row.id);
      counts.set(key, entry);
    }
  }
  await db.delete(nftTraitStats);
  const entries = [...counts.values()];
  for (let i = 0; i < entries.length; i += 200) {
    await db.insert(nftTraitStats).values(
      entries.slice(i, i + 200).map((e) => ({ traitType: e.type, traitValue: e.value, nftCount: e.ids.size }))
    );
  }
  return { types: new Set(entries.map((e) => e.type)).size, values: entries.length };
}

export async function getTraitCatalog(): Promise<{
  types: Array<{ traitType: string; values: Array<{ value: string; nftCount: number }> }>;
  generatedAt: Date | null;
}> {
  const db = getDb();
  const rows = await db.select().from(nftTraitStats).orderBy(nftTraitStats.traitType, nftTraitStats.traitValue);
  const byType = new Map<string, Array<{ value: string; nftCount: number }>>();
  let latest: Date | null = null;
  for (const r of rows) {
    const list = byType.get(r.traitType) ?? [];
    list.push({ value: r.traitValue, nftCount: r.nftCount });
    byType.set(r.traitType, list);
    if (!latest || r.updatedAt > latest) latest = r.updatedAt;
  }
  return { types: [...byType.entries()].map(([traitType, values]) => ({ traitType, values })), generatedAt: latest };
}

export async function listTokensPage(input: { limit: number; cursor: string | null }): Promise<{
  tokens: Array<{ tokenId: string; name: string | null; image: string | null; owner: string | null; observedAt: Date | null }>;
  nextCursor: string | null;
}> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit, 1), 100);
  const cursorNum = input.cursor !== null ? BigInt(input.cursor) : BigInt(0);
  const page = await db.execute(sql`select token_id from nft_tokens where token_id ~ '^[0-9]+$' and length(token_id) < 19 and token_id::bigint > ${cursorNum.toString()}::bigint order by token_id::bigint asc limit ${limit + 1}`);
  const ids = (page.rows as Array<{ token_id: string }>).map((r) => r.token_id);
  const hasMore = ids.length > limit;
  const tokens: Array<{ tokenId: string; name: string | null; image: string | null; owner: string | null; observedAt: Date | null }> = [];
  for (const id of ids.slice(0, limit)) {
    const full = await getNftByTokenId(id);
    if (!full) continue;
    tokens.push({
      tokenId: id,
      name: full.metadata?.name ?? null,
      image: full.metadata?.imageOriginal ?? null,
      owner: full.latestObservation?.ownerAddress ?? null,
      observedAt: full.latestObservation?.observedAt ?? null,
    });
  }
  return { tokens, nextCursor: hasMore ? ids[limit - 1] ?? null : null };
}

// Inventory across all of a player's verified wallets. Uses the latest
// indexed observation per token (labeled cached); privileged use must call
// the live owner endpoint.
export async function getHoldingsByOwners(ownerAddresses: string[]): Promise<
  Array<{ tokenId: string; name: string | null; image: string | null; observedAt: Date | null; freshness: "cached" }>
> {
  const normalized = [...new Set(ownerAddresses.map((a) => a.trim().toLowerCase()))];
  if (normalized.length === 0) return [];
  const db = getDb();
  const rows = await db.execute(sql`select distinct on (o.nft_id) o.nft_id, o.owner_normalized, o.observed_at, t.token_id, m.name, m.image_original from nft_ownership_observations o join nft_tokens t on t.id = o.nft_id left join nft_metadata m on m.nft_id = t.id order by o.nft_id, o.observed_at desc`);
  const out: Array<{ tokenId: string; name: string | null; image: string | null; observedAt: Date | null; freshness: "cached" }> = [];
  for (const r of rows.rows as Array<{ token_id: string; owner_normalized: string; observed_at: Date; name: string | null; image_original: string | null }>) {
    if (normalized.includes(r.owner_normalized)) {
      out.push({ tokenId: r.token_id, name: r.name, image: r.image_original, observedAt: r.observed_at, freshness: "cached" });
    }
  }
  return out.sort((a, b) => Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
}
