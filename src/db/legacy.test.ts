// Legacy persistence tests (isolated branch): trusted intake, idempotency,
// conflicts, corrections, achievements, privacy, pagination, rollback.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens, nftLegacyEvents, nftAchievementAwards } from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import { recordVerifiedNftLegacyEvent, getNftLegacy, ensureLegacyAchievements } from "@/db/legacy";

const createdTokenIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (createdTokenIds.length > 0) {
    const ids = (await db.select({ id: nftTokens.id }).from(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds))).map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(nftAchievementAwards).where(inArray(nftAchievementAwards.nftId, ids));
      await db.delete(nftLegacyEvents).where(inArray(nftLegacyEvents.nftId, ids));
      await db.delete(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
    }
  }
  resetDbCache();
});

async function makeToken(tokenId: string) {
  createdTokenIds.push(tokenId);
  const token = await upsertNftToken({ tokenId, tokenUriOriginal: `ipfs://fixture/${tokenId}` });
  await upsertNftMetadata(token.id, {
    sourceUrl: `https://fixture/${tokenId}.json`,
    contentHash: `hash-${tokenId}`,
    document: { name: `CHOG #${tokenId}` },
    name: `CHOG #${tokenId}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: [],
    fetchedAt: new Date(),
  });
}

const SRC = { source: "b3-settlement", actor: "b3-settler" };

describe("recordVerifiedNftLegacyEvent", () => {
  it("records valid events and replays idempotently", async () => {
    await makeToken("90201");
    const input = {
      ...SRC,
      authorityKey: "b3:m1:ca:90201",
      category: "commander_appearance" as const,
      tokenId: "90201",
      matchId: "m1",
      matchStatus: "completed",
      payload: { participantWallet: "0x1111111111111111111111111111111111111111" },
      rulesetRefs: { commander: "v1" },
    };
    const first = await recordVerifiedNftLegacyEvent(input);
    expect(first.created).toBe(true);
    const second = await recordVerifiedNftLegacyEvent(input);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
  });

  it("rejects untrusted sources, missing actors, bad and unknown input", async () => {
    await makeToken("90202");
    const base = {
      source: "b3-settlement",
      actor: "b3-settler",
      authorityKey: "x1",
      category: "commander_appearance" as const,
      tokenId: "90202",
      matchId: "m1",
      matchStatus: "completed",
      payload: {},
      rulesetRefs: {},
    };
    await expect(recordVerifiedNftLegacyEvent({ ...base, source: "player-client" })).rejects.toThrowError(/Untrusted/);
    await expect(recordVerifiedNftLegacyEvent({ ...base, source: "b3-settlement", actor: "" })).rejects.toThrowError(/accountable actor/);
    await expect(recordVerifiedNftLegacyEvent({ ...base, authorityKey: "x2", matchStatus: "cancelled" })).rejects.toThrowError(/finalized/);
    await expect(recordVerifiedNftLegacyEvent({ ...base, authorityKey: "x3", tokenId: "99999" })).rejects.toThrowError(/not found/);
  });

  it("rejects conflicting outcomes and supports auditable correction", async () => {
    await makeToken("90203");
    await recordVerifiedNftLegacyEvent({
      ...SRC,
      authorityKey: "b3:m2:out:90203",
      category: "commander_outcome",
      tokenId: "90203",
      matchId: "m2",
      matchStatus: "finalized",
      payload: { result: "victory" },
      rulesetRefs: {},
    });
    await expect(
      recordVerifiedNftLegacyEvent({
        ...SRC,
        authorityKey: "b3:m2:out:90203:b",
        category: "commander_outcome",
        tokenId: "90203",
        matchId: "m2",
        matchStatus: "finalized",
        payload: { result: "defeat" },
        rulesetRefs: {},
      })
    ).rejects.toThrowError(/Conflicting outcome/);
    const corrected = await recordVerifiedNftLegacyEvent({
      ...SRC,
      authorityKey: "b3:m2:out:90203:fix",
      category: "commander_outcome",
      tokenId: "90203",
      matchId: "m2",
      matchStatus: "finalized",
      payload: { result: "defeat", note: "score review" },
      rulesetRefs: {},
      supersedesAuthorityKey: "b3:m2:out:90203",
    });
    expect(corrected.created).toBe(true);
    const legacy = await getNftLegacy("90203");
    expect(legacy.stats.victories).toBe(0);
    expect(legacy.stats.defeats).toBe(1);
    expect(legacy.total).toBe(2);
  });

  it("awards achievements only when earned, deduplicates awards", async () => {
    await makeToken("90204");
    await expect(
      recordVerifiedNftLegacyEvent({
        ...SRC,
        authorityKey: "b3:ach:early",
        category: "achievement",
        tokenId: "90204",
        matchId: null,
        matchStatus: null,
        payload: { code: "first_victory" },
        rulesetRefs: {},
      })
    ).rejects.toThrowError(/not yet earned/);
    await recordVerifiedNftLegacyEvent({
      ...SRC,
      authorityKey: "b3:m3:ca:90204",
      category: "commander_appearance",
      tokenId: "90204",
      matchId: "m3",
      matchStatus: "completed",
      payload: {},
      rulesetRefs: {},
    });
    const award = await recordVerifiedNftLegacyEvent({
      ...SRC,
      authorityKey: "b3:ach:fb",
      category: "achievement",
      tokenId: "90204",
      matchId: null,
      matchStatus: null,
      payload: { code: "first_blood" },
      rulesetRefs: {},
    });
    expect(award.award?.achievementCode).toBe("first_blood");
    const replay = await recordVerifiedNftLegacyEvent({
      ...SRC,
      authorityKey: "b3:ach:fb",
      category: "achievement",
      tokenId: "90204",
      matchId: null,
      matchStatus: null,
      payload: { code: "first_blood" },
      rulesetRefs: {},
    });
    expect(replay.created).toBe(false);
    const legacy = await getNftLegacy("90204");
    expect(legacy.achievements.map((a) => a.code)).toContain("first_blood");
    expect(legacy.achievements.find((a) => a.code === "first_blood")?.awardedAt).not.toBeNull();
  });

  it("paginates history and keeps aggregates consistent", async () => {
    await makeToken("90205");
    for (let i = 0; i < 5; i++) {
      await recordVerifiedNftLegacyEvent({
        ...SRC,
        authorityKey: `b3:pg:${i}:90205`,
        category: "patron_appearance",
        tokenId: "90205",
        matchId: `pg-${i}`,
        matchStatus: "completed",
        payload: {},
        rulesetRefs: { patron: "v1" },
      });
    }
    const page1 = await getNftLegacy("90205", { limit: 2, offset: 0 });
    const page2 = await getNftLegacy("90205", { limit: 2, offset: 2 });
    expect(page1.history).toHaveLength(2);
    expect(page2.history).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.stats.patronAppearances).toBe(5);
    const ids = [...page1.history, ...page2.history].map((h) => h.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("rolls back nothing on rejected events (no partial writes)", async () => {
    await makeToken("90206");
    await expect(
      recordVerifiedNftLegacyEvent({
        source: "evil",
        actor: "x",
        authorityKey: "evil:1",
        category: "commander_outcome",
        tokenId: "90206",
        matchId: "m1",
        matchStatus: "completed",
        payload: { result: "victory" },
        rulesetRefs: {},
      })
    ).rejects.toThrow();
    const legacy = await getNftLegacy("90206");
    expect(legacy.total).toBe(0);
    expect(legacy.stats).toEqual({
      patronAppearances: 0,
      commanderAppearances: 0,
      victories: 0,
      defeats: 0,
      achievements: [],
    });
  });

  it("ensures the achievement catalog", async () => {
    await ensureLegacyAchievements();
    const db = getDb();
    const { legacyAchievements } = await import("@/db/schema");
    const rows = await db.select().from(legacyAchievements);
    expect(rows.map((r) => r.code).sort()).toEqual(["first_blood", "first_victory", "paragon", "veteran"]);
  });
});
