// Pulse schedule persistence tests (isolated branch): immutable schedules,
// idempotent saves, unknown-match rejection, token-scoped reads.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { nftTokens, patronAssignments, pulseSchedules } from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import { createPatronAssignment } from "@/db/patrons";
import {
  savePulseSchedule,
  getPulseSchedule,
  getPulseSchedulesByToken,
  ensureChaosRuleset,
} from "@/db/chaos";

const createdTokenIds: string[] = [];
const createdMatchKeys: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (createdMatchKeys.length > 0) {
    await db.delete(pulseSchedules).where(inArray(pulseSchedules.matchKey, createdMatchKeys));
    await db.delete(patronAssignments).where(inArray(patronAssignments.matchKey, createdMatchKeys));
  }
  for (const tokenId of createdTokenIds) {
    await db.delete(nftTokens).where(eq(nftTokens.tokenId, tokenId));
  }
  resetDbCache();
});

async function makeMatch(matchKey: string, tokenId: string) {
  createdTokenIds.push(tokenId);
  createdMatchKeys.push(matchKey);
  const token = await upsertNftToken({ tokenId, tokenUriOriginal: `ipfs://fixture/${tokenId}` });
  await upsertNftMetadata(token.id, {
    sourceUrl: `https://fixture/${tokenId}.json`,
    contentHash: `hash-${tokenId}`,
    document: { name: `CHOG #${tokenId}` },
    name: `CHOG #${tokenId}`,
    description: null,
    imageOriginal: null,
    attributesOriginal: [
      { trait_type: "Background", value: "Voltaic Storm" },
      { trait_type: "Aura", value: "Static Veil" },
      { trait_type: "Tier", value: "Epic" },
    ],
    fetchedAt: new Date(),
  });
  await createPatronAssignment({ matchKey, tokenId, serverSeed: `seed-${matchKey}` });
}

describe("savePulseSchedule", () => {
  it("derives and persists an immutable schedule idempotently", async () => {
    await makeMatch("chaos-a", "90111");
    const first = await savePulseSchedule({ matchKey: "chaos-a" });
    expect(first.created).toBe(true);
    const body = first.schedule.schedule as { events: Array<{ family: string }> };
    expect(body.events).toHaveLength(3);
    expect(body.events[0]?.family).toBe("energy_surge");
    const second = await savePulseSchedule({ matchKey: "chaos-a" });
    expect(second.created).toBe(false);
    expect(second.schedule.scheduleHash).toBe(first.schedule.scheduleHash);
    expect(await getPulseSchedule("chaos-a")).not.toBeNull();
    expect(await getPulseSchedule("nope")).toBeNull();
  });

  it("rejects unknown matches and bad input", async () => {
    await expect(savePulseSchedule({ matchKey: "ghost" })).rejects.toThrow();
    await expect(savePulseSchedule({ matchKey: "" })).rejects.toThrow();
  });

  it("reads schedules scoped by token", async () => {
    await makeMatch("chaos-b", "90112");
    await savePulseSchedule({ matchKey: "chaos-b" });
    const rows = await getPulseSchedulesByToken("90112");
    expect(rows.map((r) => r.matchKey)).toContain("chaos-b");
    expect(await getPulseSchedulesByToken("90111")).toHaveLength(1);
  });

  it("ensures the chaos ruleset row", async () => {
    const row = await ensureChaosRuleset();
    expect(row.version).toBe("v1");
  });
});
