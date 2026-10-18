import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens } from "@/db/schema";
import {
  upsertNftToken,
  upsertNftMetadata,
  recordMetadataFailure,
  recordOwnershipObservation,
  getNftByTokenId,
} from "@/db/nfts";

const createdTokenIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  for (const tokenId of createdTokenIds) {
    await db.delete(nftTokens).where(eq(nftTokens.tokenId, tokenId));
  }
  resetDbCache();
});

function resolvedDoc(name: string) {
  return {
    sourceUrl: "data:application/json",
    contentHash: `hash-${name}`,
    document: { name, attributes: [{ trait_type: "Background", value: "Deep Aqua" }] },
    name,
    description: "fixture",
    imageOriginal: "ipfs://img/1.webp",
    attributesOriginal: [{ trait_type: "Background", value: "Deep Aqua" }],
    fetchedAt: new Date(),
  };
}

describe("nft persistence (isolated branch)", () => {
  it("upserts tokens idempotently on chain/contract/token identity", async () => {
    const tokenId = `900001`;
    createdTokenIds.push(tokenId);
    const a = await upsertNftToken({ tokenId, tokenUriOriginal: "ipfs://a/1.json" });
    const b = await upsertNftToken({ tokenId, tokenUriOriginal: "ipfs://a/1.json" });
    expect(a.id).toBe(b.id);
    expect(a.tokenUriOriginal).toBe("ipfs://a/1.json");
  });

  it("stores and re-resolves metadata without data loss", async () => {
    const tokenId = `900002`;
    createdTokenIds.push(tokenId);
    const token = await upsertNftToken({ tokenId });
    await upsertNftMetadata(token.id, resolvedDoc("CHOG #900002"));
    const full = await getNftByTokenId(tokenId);
    expect(full?.metadata?.name).toBe("CHOG #900002");
    expect(full?.metadata?.attributesOriginal).toEqual([{ trait_type: "Background", value: "Deep Aqua" }]);
    // Re-ingest overwrites, never duplicates.
    await upsertNftMetadata(token.id, resolvedDoc("CHOG #900002 v2"));
    expect((await getNftByTokenId(tokenId))?.metadata?.name).toBe("CHOG #900002 v2");
  });

  it("records metadata failures without losing the token row", async () => {
    const tokenId = `900003`;
    createdTokenIds.push(tokenId);
    const token = await upsertNftToken({ tokenId });
    await recordMetadataFailure(token.id, { error: "gateway timeout", sourceUrl: "ipfs://x" });
    const full = await getNftByTokenId(tokenId);
    expect(full?.metadata?.status).toBe("failed");
    expect(full?.token.tokenId).toBe(tokenId);
  });

  it("orders ownership observations latest-first", async () => {
    const tokenId = `900004`;
    createdTokenIds.push(tokenId);
    const token = await upsertNftToken({ tokenId });
    await recordOwnershipObservation({ nftId: token.id, ownerAddress: "0x0000000000000000000000000000000000000001" });
    await new Promise((r) => setTimeout(r, 20));
    await recordOwnershipObservation({ nftId: token.id, ownerAddress: "0x0000000000000000000000000000000000000002" });
    const full = await getNftByTokenId(tokenId);
    expect(full?.latestObservation?.ownerAddress).toBe("0x0000000000000000000000000000000000000002");
  });

  it("returns null for unindexed tokens", async () => {
    expect(await getNftByTokenId("999999999")).toBeNull();
  });
});
