// P3a focused tests: Arena Patron reads serve only genuine indexed Genesis
// snapshots. All rows are synthetic fixtures on the isolated TEST branch,
// cleaned in both beforeAll and afterAll. Genuine-source acceptance goes
// through the real indexer write/read path (upsert + getNftByTokenId +
// lockedPatronFromNft), never through offline fixtures.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens } from "@/db/schema";
import { upsertNftToken, upsertNftMetadata, getNftByTokenId } from "@/db/nfts";
import { CHOG_GENESIS_ADDRESS, MONAD_CHAIN_ID } from "@/lib/chain";
import { derivePatronConfig } from "@/lib/patrons";
import {
  lockedPatronFromNft,
  verifyLockedPatron,
  PatronUnavailableError,
} from "@/server/battle/patron-source";
import { GET as getPatron } from "./route";
import { GET as getChaosPreview } from "./chaos/route";

const GENUINE_ID = "90401";
const WRONG_COLLECTION_ID = "90402";
const UNRESOLVED_ID = "90403";
const WRONG_CONTRACT = "0xabababababababababababababababababababab";
const ownedTokenIds = [GENUINE_ID, WRONG_COLLECTION_ID, UNRESOLVED_ID];

const ATTRIBUTES = [
  { trait_type: "Background", value: "Crimson Glow" },
  { trait_type: "Aura", value: "Ember Glow" },
  { trait_type: "Tier", value: "Rare" },
];
const CONTENT_HASH = createHash("sha256").update("p3a-genuine-fixture").digest("hex");

async function cleanup() {
  await getDb().delete(nftTokens).where(inArray(nftTokens.tokenId, ownedTokenIds));
}

const params = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });
const patronRequest = (tokenId: string, query = "") =>
  new Request(`http://localhost/api/arena/patrons/${tokenId}${query}`);

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();

  const genuine = await upsertNftToken({ tokenId: GENUINE_ID, tokenUriOriginal: `ipfs://fixture/${GENUINE_ID}` });
  await upsertNftMetadata(genuine.id, {
    sourceUrl: `https://fixture/${GENUINE_ID}.json`,
    contentHash: CONTENT_HASH,
    document: { name: `CHOG #${GENUINE_ID}` },
    name: `CHOG #${GENUINE_ID}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: ATTRIBUTES,
    fetchedAt: new Date(),
  });

  // Same token shape but a different contract: indexed, resolved, yet not a
  // Chog Genesis token. The patron reads must reject it.
  const [foreign] = await getDb()
    .insert(nftTokens)
    .values({ chainId: MONAD_CHAIN_ID, contractAddress: WRONG_CONTRACT, tokenId: WRONG_COLLECTION_ID })
    .returning();
  await upsertNftMetadata(foreign!.id, {
    sourceUrl: `https://fixture/${WRONG_COLLECTION_ID}.json`,
    contentHash: CONTENT_HASH,
    document: { name: `NOTACHOG #${WRONG_COLLECTION_ID}` },
    name: `NOTACHOG #${WRONG_COLLECTION_ID}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: ATTRIBUTES,
    fetchedAt: new Date(),
  });

  // Indexed token with no metadata row: unresolved, never a patron.
  await upsertNftToken({ tokenId: UNRESOLVED_ID, tokenUriOriginal: `ipfs://fixture/${UNRESOLVED_ID}` });
});

afterAll(async () => {
  await cleanup();
  resetDbCache();
});

describe("genuine indexed patron snapshot", () => {
  it("locks the real indexed row through the production builder", async () => {
    const nft = await getNftByTokenId(GENUINE_ID);
    expect(nft).not.toBeNull();
    const locked = lockedPatronFromNft(nft!);
    expect(locked.source).toBe("indexed-genesis");
    expect(locked.chainId).toBe(MONAD_CHAIN_ID);
    expect(locked.contractAddress).toBe(CHOG_GENESIS_ADDRESS);
    expect(locked.tokenId).toBe(GENUINE_ID);
    expect(locked.attributes).toEqual(ATTRIBUTES);
    expect(locked.metadataContentHash).toBe(CONTENT_HASH);
    expect(locked.config.configHash).toBe(
      derivePatronConfig({ tokenId: GENUINE_ID, attributes: ATTRIBUTES, metadataContentHash: CONTENT_HASH, name: `CHOG #${GENUINE_ID}` }).configHash
    );
    expect(() => verifyLockedPatron(locked)).not.toThrow();
  });

  it("rejects the wrong-collection row and the unresolved row", async () => {
    const foreign = await getNftByTokenId(WRONG_COLLECTION_ID);
    const unresolved = await getNftByTokenId(UNRESOLVED_ID);
    expect(() => lockedPatronFromNft(foreign!)).toThrow(PatronUnavailableError);
    expect(() => lockedPatronFromNft(unresolved!)).toThrow(PatronUnavailableError);
  });
});

describe("arena patron route", () => {
  it("serves the genuine indexed snapshot with collection provenance", async () => {
    const res = await getPatron(patronRequest(GENUINE_ID), params(GENUINE_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        patron: { tokenId: string; theme: string; configHash: string };
        provenance: { source: string; chainId: number; contractAddress: string; metadataContentHash: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.patron.tokenId).toBe(GENUINE_ID);
    expect(body.data.patron.theme).toBe("ember");
    expect(body.data.provenance.source).toBe("indexed-genesis");
    expect(body.data.provenance.chainId).toBe(MONAD_CHAIN_ID);
    expect(body.data.provenance.contractAddress).toBe(CHOG_GENESIS_ADDRESS);
    expect(body.data.provenance.metadataContentHash).toBe(CONTENT_HASH);
  });

  it("ignores fabricated client-supplied traits in the query string", async () => {
    const plain = (await (await getPatron(patronRequest(GENUINE_ID), params(GENUINE_ID))).json()) as {
      data: { patron: { configHash: string } };
    };
    const injected = (await (
      await getPatron(patronRequest(GENUINE_ID, "?tier=Mythic&attributes=%5B%5D"), params(GENUINE_ID))
    ).json()) as { data: { patron: { configHash: string } } };
    expect(injected.data.patron.configHash).toBe(plain.data.patron.configHash);
  });

  it("rejects wrong-collection, unresolved, missing and malformed ids without a patron", async () => {
    for (const [id, status] of [
      [WRONG_COLLECTION_ID, 404],
      [UNRESOLVED_ID, 422],
      ["90599", 404],
      ["abc", 400],
    ] as const) {
      const res = await getPatron(patronRequest(id), params(id));
      expect(res.status).toBe(status);
      const body = (await res.json()) as { success: boolean; data?: { patron?: unknown } };
      expect(body.success).toBe(false);
      expect(body.data?.patron).toBeUndefined();
    }
  });
});

describe("arena chaos preview route", () => {
  it("previews the genuine patron without claiming a match", async () => {
    const res = await getChaosPreview(patronRequest(GENUINE_ID), params(GENUINE_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        preview: boolean;
        patron: { tokenId: string };
        schedule: { scheduleHash: string };
        provenance: { source: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.preview).toBe(true);
    expect(body.data.patron.tokenId).toBe(GENUINE_ID);
    expect(body.data.provenance.source).toBe("indexed-genesis");
    expect(typeof body.data.schedule.scheduleHash).toBe("string");
  });

  it("fails closed for wrong-collection and unresolved rows", async () => {
    expect((await getChaosPreview(patronRequest(WRONG_COLLECTION_ID), params(WRONG_COLLECTION_ID))).status).toBe(404);
    expect((await getChaosPreview(patronRequest(UNRESOLVED_ID), params(UNRESOLVED_ID))).status).toBe(422);
  });
});
