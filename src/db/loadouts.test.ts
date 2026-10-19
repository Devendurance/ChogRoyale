import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { commanderFromRow, getLoadout, saveLoadout } from "@/db/loadouts";
import { playerLoadouts, players, type Player } from "@/db/schema";
import { PRESETS } from "@/server/battle/session";
import { CHOG_GENESIS_CHAIN_ID, CHOG_GENESIS_CONTRACT, type CommanderChoice } from "@/lib/battle-protocol";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const mkPlayer = async (name: string): Promise<Player> => {
  const p = await provisionPlayer({ privyDid: `did:privy:loadout_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
};

afterAll(async () => {
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

const cards = PRESETS["swarm"]!.cards;
const altCards = PRESETS["siege"]!.cards;
const scout: CommanderChoice = { kind: "free", class: "scout" };
const warden: CommanderChoice = { kind: "free", class: "warden" };
const nft: CommanderChoice = { kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId: "1462" };

describe("player loadouts", () => {
  it("returns null when nothing is saved", async () => {
    const p = await mkPlayer("none");
    expect(await getLoadout(p.id)).toBeNull();
  });

  it("saves and reads back a free deck", async () => {
    const p = await mkPlayer("free");
    const row = await saveLoadout(p.id, { cards, commander: scout }, null);
    expect(row.revision).toBe(1);
    expect(row.cards).toEqual(cards);
    expect(commanderFromRow(row)).toEqual(scout);
    const back = await getLoadout(p.id);
    expect(back?.id).toBe(row.id);
    expect(back?.commanderKind).toBe("free");
    expect(back?.commanderClass).toBe("scout");
  });

  it("saves and reads back an NFT claim without storing ownership data", async () => {
    const p = await mkPlayer("nft");
    const row = await saveLoadout(p.id, { cards, commander: nft }, null);
    expect(row.commanderKind).toBe("nft");
    expect(row.nftChainId).toBe(143);
    expect(row.nftContract).toBe(CHOG_GENESIS_CONTRACT);
    expect(row.nftTokenId).toBe("1462");
    expect(commanderFromRow(row)).toEqual(nft);
  });

  it("bumps revision on a matching-revision update", async () => {
    const p = await mkPlayer("rev");
    await saveLoadout(p.id, { cards, commander: scout }, null);
    const row = await saveLoadout(p.id, { cards: altCards, commander: warden }, 1);
    expect(row.revision).toBe(2);
    expect(row.cards).toEqual(altCards);
    expect(commanderFromRow(row)).toEqual(warden);
  });

  it("rejects a stale revision and leaves the stored row unchanged", async () => {
    const p = await mkPlayer("stale");
    await saveLoadout(p.id, { cards, commander: scout }, null);
    await saveLoadout(p.id, { cards: altCards, commander: warden }, 1); // rev 2
    await expect(saveLoadout(p.id, { cards, commander: scout }, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await getLoadout(p.id);
    expect(row?.revision).toBe(2);
    expect(row?.cards).toEqual(altCards);
  });

  it("lets exactly one of two same-revision saves win", async () => {
    const p = await mkPlayer("race-update");
    await saveLoadout(p.id, { cards, commander: scout }, null);
    const [r1, r2] = await Promise.allSettled([saveLoadout(p.id, { cards: altCards, commander: warden }, 1), saveLoadout(p.id, { cards, commander: scout }, 1)]);
    expect([r1, r2].filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getLoadout(p.id))?.revision).toBe(2);
  });

  it("lets exactly one of two concurrent first saves win", async () => {
    const p = await mkPlayer("race-insert");
    const [r1, r2] = await Promise.allSettled([
      saveLoadout(p.id, { cards, commander: scout }, null),
      saveLoadout(p.id, { cards: altCards, commander: warden }, null),
    ]);
    expect([r1, r2].filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getLoadout(p.id))?.revision).toBe(1);
  });

  it("keeps players isolated", async () => {
    const a = await mkPlayer("iso-a");
    const b = await mkPlayer("iso-b");
    await saveLoadout(a.id, { cards, commander: scout }, null);
    expect(await getLoadout(b.id)).toBeNull();
    await expect(saveLoadout(b.id, { cards: altCards, commander: warden }, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    const rowA = await getLoadout(a.id);
    expect(rowA?.cards).toEqual(cards);
  });

  it("the DB check constraint itself rejects bad claims and bad card counts", async () => {
    const p = await mkPlayer("raw");
    const db = getDb();
    await expect(
      db.insert(playerLoadouts).values({
        playerId: p.id,
        slot: 0,
        schemaVersion: 1,
        cards,
        commanderKind: "nft",
        nftChainId: 1,
        nftContract: CHOG_GENESIS_CONTRACT,
        nftTokenId: "5",
      })
    ).rejects.toThrow();
    await expect(
      db.insert(playerLoadouts).values({
        playerId: p.id,
        slot: 0,
        schemaVersion: 1,
        cards: cards.slice(0, 6),
        commanderKind: "free",
        commanderClass: "scout",
      })
    ).rejects.toThrow();
    await expect(
      db.insert(playerLoadouts).values({
        playerId: p.id,
        slot: 0,
        schemaVersion: 1,
        cards,
        commanderKind: "nft",
        nftChainId: 143,
        nftContract: CHOG_GENESIS_CONTRACT,
        nftTokenId: "007",
      })
    ).rejects.toThrow();
    expect(await getLoadout(p.id)).toBeNull();
  });

  it("cascades delete with the player", async () => {
    const p = await mkPlayer("cascade");
    await saveLoadout(p.id, { cards, commander: scout }, null);
    await getDb().delete(players).where(eq(players.id, p.id));
    createdPlayerIds.splice(createdPlayerIds.indexOf(p.id), 1);
    const rows = await getDb().select({ id: playerLoadouts.id }).from(playerLoadouts).where(eq(playerLoadouts.playerId, p.id));
    expect(rows).toHaveLength(0);
  });
});
