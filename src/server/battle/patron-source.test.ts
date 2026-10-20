// B2.8c patron source unit tests. Pure: no DB, no network. The NftRecord
// inputs are plain objects shaped like getNftByTokenId's return.

import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { deriveChaosSchedule } from "@/lib/chaos";
import { CHOG_GENESIS_ADDRESS, MONAD_CHAIN_ID } from "@/lib/chain";
import { derivePatronConfig, selectPatronTokenId } from "@/lib/patrons";
import { scenarioConfig } from "@/lib/arena-scenarios";
import type { CombatConfig } from "@/lib/combat";
import {
  PatronUnavailableError,
  lockedPatronFromNft,
  verifyLockedPatron,
  verifyPatronEvidence,
  type LockedPatron,
} from "@/server/battle/patron-source";

const HASH = createHash("sha256").update("doc").digest("hex");

type NftRecord = Parameters<typeof lockedPatronFromNft>[0];

function fakeNft(over: {
  tokenId?: string;
  chainId?: number;
  contractAddress?: string;
  status?: string;
  contentHash?: string | null;
  name?: string | null;
  attributesOriginal?: unknown;
  noMetadata?: boolean;
}): NftRecord {
  const tokenId = over.tokenId ?? "42";
  return {
    token: {
      id: "nft-row",
      chainId: over.chainId ?? MONAD_CHAIN_ID,
      contractAddress: over.contractAddress ?? CHOG_GENESIS_ADDRESS,
      tokenId,
      tokenUriOriginal: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    metadata: over.noMetadata
      ? null
      : {
          id: "meta-row",
          nftId: "nft-row",
          documentOriginal: {},
          name: over.name === undefined ? `CHOG #${tokenId}` : over.name,
          description: null,
          imageOriginal: null,
          attributesOriginal: over.attributesOriginal ?? [
            { trait_type: "Background", value: "Crimson Glow" },
            { trait_type: "Aura", value: "Ember Glow" },
            { trait_type: "Tier", value: "Rare" },
          ],
          contentHash: over.contentHash === undefined ? HASH : over.contentHash,
          status: over.status ?? "resolved",
          error: null,
          sourceUrl: null,
          fetchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
    latestObservation: null,
  } as unknown as NftRecord;
}

describe("lockedPatronFromNft", () => {
  it("locks a resolved Genesis token into a verified snapshot", () => {
    const p = lockedPatronFromNft(fakeNft({}));
    expect(p.source).toBe("indexed-genesis");
    expect(p.chainId).toBe(143);
    expect(p.contractAddress).toBe(CHOG_GENESIS_ADDRESS);
    expect(p.tokenId).toBe("42");
    expect(p.name).toBe("CHOG #42");
    expect(p.metadataContentHash).toBe(HASH);
    expect(() => verifyLockedPatron(p)).not.toThrow();
  });

  it("keeps only string-valued Tier/Aura/Background traits, in original order", () => {
    const full = [
      { trait_type: "Class", value: "Scout" },
      { trait_type: "Background", value: "Purple Void" },
      { trait_type: "Power", value: 7 },
      { trait_type: "Tier", value: "Epic" },
      { trait_type: "Aura", value: "Spirit Bloom" },
      "garbage",
      { trait_type: "Background", value: 12 },
    ];
    const p = lockedPatronFromNft(fakeNft({ attributesOriginal: full }));
    expect(p.attributes).toEqual([
      { trait_type: "Background", value: "Purple Void" },
      { trait_type: "Tier", value: "Epic" },
      { trait_type: "Aura", value: "Spirit Bloom" },
    ]);
    // snapshotTraits reads only those three types with string values, so the
    // filtered snapshot must derive the identical configHash as the raw input.
    const fromRaw = derivePatronConfig({ tokenId: "42", attributes: full as never, metadataContentHash: HASH, name: "CHOG #42" });
    expect(p.config.configHash).toBe(fromRaw.configHash);
    expect(p.config.theme).toBe("rift");
  });

  it.each([
    ["wrong chain", fakeNft({ chainId: 1 })],
    ["wrong contract", fakeNft({ contractAddress: "0x0000000000000000000000000000000000000001" })],
    ["missing metadata", fakeNft({ noMetadata: true })],
    ["failed metadata", fakeNft({ status: "failed" })],
    ["unresolved hash", fakeNft({ contentHash: "unresolved" })],
    ["empty hash", fakeNft({ contentHash: "" })],
  ])("rejects a patron with %s", (_label, nft) => {
    expect(() => lockedPatronFromNft(nft)).toThrow(PatronUnavailableError);
  });
});

describe("verifyLockedPatron", () => {
  const good = () => lockedPatronFromNft(fakeNft({}));

  it("rejects non-authentic and tampered snapshots", () => {
    expect(() => verifyLockedPatron(good())).not.toThrow();
    // FAIRNESS-style synthetic input has no indexed-genesis provenance.
    const synthetic = { ...good(), source: "synthetic" } as unknown as LockedPatron;
    expect(() => verifyLockedPatron(synthetic)).toThrow(PatronUnavailableError);
    const wrongChain = { ...good(), chainId: 1 } as unknown as LockedPatron;
    expect(() => verifyLockedPatron(wrongChain)).toThrow(PatronUnavailableError);
    const badId = { ...good(), tokenId: "abc" };
    expect(() => verifyLockedPatron(badId)).toThrow(PatronUnavailableError);
    // A changed trait changes nothing else: the stored config must re-derive.
    const traitTampered = good();
    traitTampered.attributes = [...traitTampered.attributes.filter((a) => a.trait_type !== "Tier")];
    expect(() => verifyLockedPatron(traitTampered)).toThrow(PatronUnavailableError);
    const hashTampered = good();
    hashTampered.config = { ...hashTampered.config, configHash: "0".repeat(64) };
    expect(() => verifyLockedPatron(hashTampered)).toThrow(PatronUnavailableError);
  });
});

describe("verifyPatronEvidence", () => {
  const patron = lockedPatronFromNft(fakeNft({}));
  const configFor = (p: LockedPatron, seed = "seed-1"): CombatConfig =>
    scenarioConfig(
      ["chog_guardian", "boulderback", "chaos_archer", "rift_runner", "choglings", "frostshell", "sparkcaster", "cmdr:free-warden"],
      ["choglings", "sparkcaster", "chog_guardian", "hexwing", "frostshell", "rift_runner", "chaos_archer", "cmdr:free-scout"],
      deriveChaosSchedule({ patron: p.config, serverSeed: seed, matchKey: `arena:${p.tokenId}` }),
      seed
    );

  it("accepts evidence whose schedule re-derives from the locked patron", () => {
    expect(() => verifyPatronEvidence(configFor(patron), patron)).not.toThrow();
  });

  it("rejects a missing schedule, a wrong patron, and a re-seeded schedule", () => {
    const patron2 = lockedPatronFromNft(fakeNft({ tokenId: "7" }));
    expect(() => verifyPatronEvidence({ ...configFor(patron), chaos: null }, patron)).toThrow(/no chaos/);
    expect(() => verifyPatronEvidence(configFor(patron2), patron)).toThrow(/patron token mismatch/);
    // A schedule derived under a different server seed than the config claims.
    expect(() => verifyPatronEvidence({ ...configFor(patron, "seed-1"), seed: "seed-2" }, patron)).toThrow(/re-derive/);
    const tamperedSchedule = configFor(patron);
    tamperedSchedule.chaos = { ...tamperedSchedule.chaos!, patronConfigHash: "f".repeat(64) };
    expect(() => verifyPatronEvidence(tamperedSchedule, patron)).toThrow(/config hash mismatch/);
  });

  it("selection is deterministic for a seed over a pool", () => {
    const pool = ["1", "2", "42", "100", "91337"];
    const first = selectPatronTokenId("sel-seed", pool);
    expect(selectPatronTokenId("sel-seed", [...pool].reverse())).toBe(first);
    expect(pool).toContain(first);
  });
});
