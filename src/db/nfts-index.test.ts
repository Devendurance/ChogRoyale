import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens } from "@/db/schema";
import {
  upsertNftToken,
  recordOwnershipObservation,
  getHoldingsByOwners,
  refreshTraitStats,
  getTraitCatalog,
  setCheckpoint,
  getCheckpoint,
  listTokensPage,
} from "@/db/nfts";
import { upsertNftMetadata } from "@/db/nfts";

// Fixed fixtures owned by this file; cleaned before and after the suite.
const createdTokenIds: string[] = ["910001", "910002", "910003", "920001", "920002", "930010", "930002", "930100"];
const tag = () => Math.random().toString(36).slice(2, 10);

async function cleanup() {
  await getDb().delete(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
  await refreshTraitStats();
}

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  resetDbCache();
});

function metaDoc(traits: Array<{ trait_type: string; value: unknown }>, name: string) {
  return {
    sourceUrl: "data:application/json",
    contentHash: `hash-${name}`,
    document: { name, attributes: traits },
    name,
    description: null,
    imageOriginal: null,
    attributesOriginal: traits,
    fetchedAt: new Date(),
  };
}

describe("trait catalog (isolated branch)", () => {
  it("counts distinct NFTs per value and keeps str/num distinct", async () => {
    // ZZ-prefixed trait types isolate assertions from genuine branch data.
    for (const id of ["910001", "910002", "910003"]) {
      createdTokenIds.push(id);
      const token = await upsertNftToken({ tokenId: id });
      await upsertNftMetadata(
        token.id,
        metaDoc(
          [
            { trait_type: "ZZTier", value: "Uncommon" },
            ...(id === "910003"
              ? [{ trait_type: "ZZTier", value: "Uncommon" }, { trait_type: "ZZRank", value: 42 }]
              : [{ trait_type: "ZZRank", value: "42" }]),
            ...(id === "910002" ? [] : [{ trait_type: "ZZAura", value: null }]),
          ],
          `T #${id}`
        )
      );
    }
    const stats = await refreshTraitStats();
    expect(stats.types).toBeGreaterThanOrEqual(2);
    const catalog = await getTraitCatalog();
    const tier = catalog.types.find((t) => t.traitType === "ZZTier");
    // Duplicate ZZTier in one NFT counts once; null ZZAura counts nowhere.
    expect(tier?.values.find((v) => v.value === "str:Uncommon")?.nftCount).toBe(3);
    const rank = catalog.types.find((t) => t.traitType === "ZZRank");
    expect(rank?.values.map((v) => v.value).sort()).toEqual(["num:42", "str:42"]);
  });
});

describe("checkpoints (isolated branch)", () => {
  it("persists and advances interruption cursors", async () => {
    const key = `test-sync-${tag()}`;
    expect(await getCheckpoint(key)).toBeNull();
    await setCheckpoint(key, "100");
    expect(await getCheckpoint(key)).toBe("100");
    await setCheckpoint(key, "200");
    expect(await getCheckpoint(key)).toBe("200");
  });
});

describe("holdings and pagination (isolated branch)", () => {
  it("matches only verified linked wallets and excludes others", async () => {
    const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    for (const [id, owner] of [["920001", ownerA], ["920002", ownerB]] as const) {
      createdTokenIds.push(id);
      const token = await upsertNftToken({ tokenId: id });
      await recordOwnershipObservation({ nftId: token.id, ownerAddress: owner });
    }
    const holdings = await getHoldingsByOwners([ownerA.toUpperCase(), "0xcccccccccccccccccccccccccccccccccccccccc"]);
    expect(holdings.map((h) => h.tokenId)).toEqual(["920001"]);
    expect(holdings[0]?.freshness).toBe("cached");
  });

  it("paginates by numeric token id order", async () => {
    for (const id of ["930010", "930002", "930100"]) {
      createdTokenIds.push(id);
      await upsertNftToken({ tokenId: id });
    }
    // Cursor past genuine branch data keeps the test hermetic.
    const page1 = await listTokensPage({ limit: 2, cursor: "930001" });
    expect(page1.tokens.map((t) => t.tokenId)).toEqual(["930002", "930010"]);
    expect(page1.nextCursor).toBe("930010");
    const page2 = await listTokensPage({ limit: 2, cursor: page1.nextCursor });
    expect(page2.tokens.map((t) => t.tokenId)).toEqual(["930100"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects invalid pagination at the API boundary", async () => {
    const { GET } = await import("@/app/api/nfts/route");
    const bad = await GET(new Request("http://localhost/api/nfts?limit=500"));
    expect(bad.status).toBe(400);
    const badCursor = await GET(new Request("http://localhost/api/nfts?cursor=abc"));
    expect(badCursor.status).toBe(400);
  });
});
