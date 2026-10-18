// Patron persistence tests (isolated branch): immutable assignments,
// idempotent match keys, unknown/unresolved rejection, token-scoped reads.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens, patronAssignments } from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import {
  createPatronAssignment,
  getPatronAssignment,
  getPatronAssignmentsByToken,
  ensurePatronRuleset,
} from "@/db/patrons";

// Fixed fixtures owned by this file; cleaned before and after the suite.
const createdTokenIds: string[] = ["90001", "90002", "90003", "90004"];
const createdMatchKeys: string[] = ["match-a", "match-b", "m-x", "m-y", "m-z"];

async function cleanup() {
  const db = getDb();
  await db.delete(patronAssignments).where(inArray(patronAssignments.matchKey, createdMatchKeys));
  await db.delete(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
}

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  resetDbCache();
});

async function makeResolvedToken(tokenId: string) {
  createdTokenIds.push(tokenId);
  const token = await upsertNftToken({
    tokenId,
    tokenUriOriginal: `ipfs://fixture/${tokenId}`,
  });
  await upsertNftMetadata(token.id, {
    sourceUrl: `https://fixture/${tokenId}.json`,
    contentHash: `hash-${tokenId}`,
    document: { name: `CHOG #${tokenId}` },
    name: `CHOG #${tokenId}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: [
      { trait_type: "Background", value: "Crimson Glow" },
      { trait_type: "Tier", value: "Rare" },
    ],
    fetchedAt: new Date(),
  });
  return token;
}

describe("createPatronAssignment", () => {
  it("persists an immutable assignment and returns it idempotently", async () => {
    await makeResolvedToken("90001");
    createdMatchKeys.push("match-a");
    const first = await createPatronAssignment({ matchKey: "match-a", tokenId: "90001", serverSeed: "seed-1" });
    expect(first.created).toBe(true);
    expect(first.assignment.tokenId).toBe("90001");
    expect(first.assignment.configHash).toMatch(/^[0-9a-f]{64}$/);
    const second = await createPatronAssignment({ matchKey: "match-a", tokenId: "90002", serverSeed: "seed-2" });
    expect(second.created).toBe(false);
    expect(second.assignment.tokenId).toBe("90001");
    const fetched = await getPatronAssignment("match-a");
    expect(fetched?.tokenId).toBe("90001");
  });

  it("rejects unknown tokens, unresolved metadata, and bad input", async () => {
    await expect(createPatronAssignment({ matchKey: "m-x", tokenId: "99998", serverSeed: "s" })).rejects.toThrow();
    await upsertNftToken({ tokenId: "90003", tokenUriOriginal: "ipfs://fixture/90003" });
    createdTokenIds.push("90003");
    await expect(createPatronAssignment({ matchKey: "m-y", tokenId: "90003", serverSeed: "s" })).rejects.toThrow();
    await expect(createPatronAssignment({ matchKey: "", tokenId: "90001", serverSeed: "s" })).rejects.toThrow();
    await expect(createPatronAssignment({ matchKey: "m-z", tokenId: "abc", serverSeed: "s" })).rejects.toThrow();
  });

  it("reads assignments scoped by token", async () => {
    await makeResolvedToken("90004");
    createdMatchKeys.push("match-b");
    await createPatronAssignment({ matchKey: "match-b", tokenId: "90004", serverSeed: "seed-9" });
    const rows = await getPatronAssignmentsByToken("90004");
    expect(rows.map((r) => r.matchKey)).toContain("match-b");
    expect(await getPatronAssignment("nope")).toBeNull();
  });

  it("ensures the patron ruleset row", async () => {
    const row = await ensurePatronRuleset();
    expect(row.version).toBe("v1");
  });
});
