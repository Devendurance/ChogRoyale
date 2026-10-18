// Commander persistence tests (isolated branch): idempotent derivation
// storage, metadata-update revision chains, and missing-row states.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens } from "@/db/schema";
import { upsertNftToken } from "@/db/nfts";
import { deriveCommander } from "@/lib/commanders";
import {
  ensureCurrentRuleset,
  upsertCommander,
  getCommanderByTokenId,
  currentRulesetVersion,
} from "@/db/commanders";

// Fixed fixtures owned by this file; cleaned before and after the suite.
const createdTokenIds: string[] = ["91001", "91002"];

async function cleanup() {
  await getDb().delete(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
}

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  resetDbCache();
});

async function makeToken(tokenId: string) {
  createdTokenIds.push(tokenId);
  return upsertNftToken({ tokenId, tokenUriOriginal: `ipfs://fixture/${tokenId}` });
}

const ATTRS_V1 = [
  { trait_type: "Skin", value: "Red" },
  { trait_type: "Eyes", value: "Angry" },
  { trait_type: "Tier", value: "Common" },
];

const ATTRS_V2 = [
  { trait_type: "Skin", value: "Metal" },
  { trait_type: "Eyes", value: "Angry" },
  { trait_type: "Tier", value: "Common" },
];

describe("commander persistence (isolated branch)", () => {
  it("ensures the current ruleset version row", async () => {
    const row = await ensureCurrentRuleset();
    expect(row.version).toBe(currentRulesetVersion());
  });

  it("returns null for tokens with no derived commander", async () => {
    expect(await getCommanderByTokenId("999888777")).toBeNull();
  });

  it("persists derivations idempotently", async () => {
    const token = await makeToken("91001");
    const def = deriveCommander({ attributes: ATTRS_V1 });
    const first = await upsertCommander({ nftId: token.id, tokenId: "91001", definition: def });
    expect(first.revised).toBe(false);
    const second = await upsertCommander({ nftId: token.id, tokenId: "91001", definition: def });
    expect(second.revised).toBe(false);
    expect(second.commander.id).toBe(first.commander.id);
    expect(second.commander.derivationCount).toBe(1);
  });

  it("revises without silently overwriting when metadata changes", async () => {
    const token = await makeToken("91002");
    const v1 = deriveCommander({ attributes: ATTRS_V1 });
    const first = await upsertCommander({ nftId: token.id, tokenId: "91002", definition: v1 });
    const v2 = deriveCommander({ attributes: ATTRS_V2 });
    expect(v2.derivationHash).not.toBe(v1.derivationHash);
    const second = await upsertCommander({ nftId: token.id, tokenId: "91002", definition: v2 });
    expect(second.revised).toBe(true);
    expect(second.commander.id).toBe(first.commander.id);
    expect(second.commander.previousContentHash).toBe(v1.derivationHash);
    expect(second.commander.contentHash).toBe(v2.derivationHash);
    expect(second.commander.derivationCount).toBe(2);
    const fetched = await getCommanderByTokenId("91002");
    expect(fetched?.class).toBe(v2.class);
  });
});
