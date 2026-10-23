// Focused route tests for the existing token legacy and achievement reads.
// These verify the real response contracts the A3.2b vault consumes. All writes
// go to the isolated TEST branch and the owned token fixtures are cleaned in
// both beforeAll and afterAll.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftAchievementAwards, nftLegacyEvents, nftTokens } from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import { recordVerifiedNftLegacyEvent } from "@/db/legacy";
import { GET as getLegacy } from "./route";
import { GET as getAchievements } from "../achievements/route";

const TOKEN_ID = "90301";
const SRC = { source: "b3-settlement", actor: "route-test" };
const ownedTokenIds = [TOKEN_ID];

async function cleanup() {
  const db = getDb();
  const owned = db.select({ id: nftTokens.id }).from(nftTokens).where(inArray(nftTokens.tokenId, ownedTokenIds));
  await db.delete(nftAchievementAwards).where(inArray(nftAchievementAwards.nftId, owned));
  await db.delete(nftLegacyEvents).where(inArray(nftLegacyEvents.nftId, owned));
  await db.delete(nftTokens).where(inArray(nftTokens.tokenId, ownedTokenIds));
}

const params = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });
const request = (query = "") => new Request(`http://localhost/api/nfts/${TOKEN_ID}/legacy${query}`);

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();

  const token = await upsertNftToken({ tokenId: TOKEN_ID, tokenUriOriginal: `ipfs://fixture/${TOKEN_ID}` });
  await upsertNftMetadata(token.id, {
    sourceUrl: `https://fixture/${TOKEN_ID}.json`,
    contentHash: `hash-${TOKEN_ID}`,
    document: { name: `CHOG #${TOKEN_ID}` },
    name: `CHOG #${TOKEN_ID}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: [],
    fetchedAt: new Date(),
  });

  await recordVerifiedNftLegacyEvent({
    ...SRC,
    authorityKey: "b3:route:m1:90301:appearance",
    category: "commander_appearance",
    tokenId: TOKEN_ID,
    matchId: "route-m1",
    matchStatus: "finalized",
    payload: {
      seat: 0,
      matchType: "matchmaking",
      result: "win",
      crowns: { mine: 3, opponent: 1 },
      endReason: "core",
      commanderClass: "reaver",
      variant: "origin",
      derivationHash: "fixture-derivation",
      basis: "direct-owner",
      evidenceSha256: "fixture-evidence",
    },
    rulesetRefs: { combat: "v16" },
    occurredAt: new Date("2026-10-21T20:00:00.000Z"),
  });

  await recordVerifiedNftLegacyEvent({
    ...SRC,
    authorityKey: "b3:route:m1:90301:outcome",
    category: "commander_outcome",
    tokenId: TOKEN_ID,
    matchId: "route-m1",
    matchStatus: "finalized",
    payload: { result: "victory", crowns: [3, 1], endReason: "core" },
    rulesetRefs: { combat: "v16" },
    occurredAt: new Date("2026-10-21T20:01:00.000Z"),
  });

  await recordVerifiedNftLegacyEvent({
    ...SRC,
    authorityKey: "b3:route:m2:90301:patron",
    category: "patron_appearance",
    tokenId: TOKEN_ID,
    matchId: "route-m2",
    matchStatus: "finalized",
    payload: {
      matchType: "private",
      theme: "ember",
      configHash: "fixture-config",
      metadataContentHash: "fixture-metadata",
      scheduleHash: "fixture-schedule",
      evidenceSha256: "fixture-evidence",
    },
    rulesetRefs: { combat: "v16", patron: "v1" },
    occurredAt: new Date("2026-10-21T20:02:00.000Z"),
  });

  await recordVerifiedNftLegacyEvent({
    ...SRC,
    authorityKey: "b3:route:achievement:90301:first_blood",
    category: "achievement",
    tokenId: TOKEN_ID,
    matchId: "route-m1",
    matchStatus: "finalized",
    payload: { code: "first_blood", earnedInMatch: "route-m1" },
    rulesetRefs: { combat: "v16" },
    occurredAt: new Date("2026-10-21T20:03:00.000Z"),
  });
});

afterAll(async () => {
  await cleanup();
  resetDbCache();
});

describe("token legacy route", () => {
  it("returns the real token identity, aggregate stats and full history", async () => {
    const res = await getLegacy(request(), params(TOKEN_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        tokenId: string;
        name: string;
        stats: {
          commanderAppearances: number;
          patronAppearances: number;
          victories: number;
          defeats: number;
          achievements: string[];
        };
        total: number;
        history: Array<{ category: string; status: string; payload: unknown }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tokenId).toBe(TOKEN_ID);
    expect(body.data.name).toBe(`CHOG #${TOKEN_ID}`);
    expect(body.data.stats).toMatchObject({
      commanderAppearances: 1,
      patronAppearances: 1,
      victories: 1,
      defeats: 0,
    });
    expect(body.data.stats.achievements).toContain("first_blood");
    expect(body.data.total).toBe(4);
    expect(body.data.history).toHaveLength(4);
    expect(body.data.history.map((event) => event.category).sort()).toEqual([
      "achievement",
      "commander_appearance",
      "commander_outcome",
      "patron_appearance",
    ]);
    expect(body.data.history.every((event) => event.status === "recorded")).toBe(true);
  });

  it("paginates the history without changing the aggregates", async () => {
    const page1 = (await (await getLegacy(request("?limit=2&offset=0"), params(TOKEN_ID))).json()) as {
      data: { stats: { commanderAppearances: number }; total: number; history: unknown[] };
    };
    const page2 = (await (await getLegacy(request("?limit=2&offset=2"), params(TOKEN_ID))).json()) as {
      data: { stats: { commanderAppearances: number }; total: number; history: unknown[] };
    };
    expect(page1.data.history).toHaveLength(2);
    expect(page2.data.history).toHaveLength(2);
    expect(page1.data.total).toBe(4);
    expect(page2.data.total).toBe(4);
    expect(page1.data.stats.commanderAppearances).toBe(1);
    expect(page2.data.stats.commanderAppearances).toBe(1);
  });

  it("returns a clear not-found for an unindexed token", async () => {
    const res = await getLegacy(request(), params("99999"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("token achievements route", () => {
  it("returns earned awards only, with their authored names and award dates", async () => {
    const res = await getAchievements(request(), params(TOKEN_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        tokenId: string;
        total: number;
        achievements: Array<{ code: string; name: string; awardedAt: string | null }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tokenId).toBe(TOKEN_ID);
    expect(body.data.total).toBe(2);
    expect(body.data.achievements).toHaveLength(2);
    expect(body.data.achievements.map((achievement) => achievement.code).sort()).toEqual([
      "first_blood",
      "first_victory",
    ]);
    const firstBlood = body.data.achievements.find((achievement) => achievement.code === "first_blood")!;
    expect(firstBlood.name).toBe("First Blood");
    expect(firstBlood.awardedAt).not.toBeNull();
  });
});
