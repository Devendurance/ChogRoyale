// P2b Gold earn on the settlement lifecycle. TEST branch only.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  cardXpAwards,
  cardXpProgress,
  cardXpRuns,
  goldEarnLedger,
  goldSpendLedger,
  matchEvidence,
  matchParticipants,
  matches,
  players,
  type Player,
} from "@/db/schema";
import { PRESETS, BattleSession, type TrustedLoadout } from "@/server/battle/session";
import type { CommanderClass } from "@/lib/commanders";
import { makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay } from "@/server/battle/settlement";
import { GoldService } from "./gold";
import { getGoldTotals } from "@/db/gold";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const dirs: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, matchIds));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(goldSpendLedger).where(inArray(goldSpendLedger.playerId, createdPlayerIds));
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:goldlife_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

function driveToFinish(s: BattleSession) {
  let n = 0;
  const decks = s.readyLoadouts();
  let guard = 0;
  while (s.phase === "active" && guard++ < 4000) {
    s.slots.forEach((pl, slot) => {
      if (!pl) return;
      const seat = s.seatOfSlot[slot]!;
      const deck = decks[slot]!;
      const cards = [...deck.cards, `cmdr:${deck.grant.slot.commanderId}`];
      n += 1;
      s.submit(pl.playerId, { type: "deploy", cid: `t${n}`, cardId: cards[n % cards.length]!, x: 30 + ((n % 2) * 40), y: seat === 0 ? 60 : 100 });
    });
    s.tick();
  }
}

describe("P2b gold lifecycle", () => {
  it("stages earn rows only after the DB confirms the settle", async () => {
    const [a, b] = [await mkPlayer("la"), await mkPlayer("lb")];
    const service = new SettlementService({
      dir: mkdtempSync(path.join(tmpdir(), "gold-life-")),
      retryDelaysMs: [],
      sleep: async () => {},
      gold: new GoldService(),
    });
    dirs.push(service.dir);
    const s = new BattleSession({ seed: () => "c0ffee00c0ffee00c0ffee00c0ffee00", int: (n) => (n === 2 ? 0 : 0) });
    s.mode = "ranked";
    s.join({ playerId: a.id, username: "ga" });
    s.join({ playerId: b.id, username: "gb" });
    const load = (preset: string) => makeLoadout([...PRESETS[preset]!.cards], PRESETS[preset]!.commanderClass as CommanderClass);
    s.setReady(a.id, load("antiSwarm"));
    s.setReady(b.id, load("swarm"));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    driveToFinish(s);
    expect(s.phase).toBe("finished");
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: `g-${matchId.slice(0, 8)}`, matchType: "ranked", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] });
    expect(await service.submit(record)).toBe("settled");
    // Winner +60, loser +30: exactly one of each across the two players.
    const amounts = [await getGoldTotals(a.id), await getGoldTotals(b.id)].map((t) => t.earned).sort((x, y) => x - y);
    expect(amounts).toEqual([30, 60]);
    // Duplicate settlement never double-stages.
    expect(await service.submit(record)).toBe("already-settled");
    const amounts2 = [await getGoldTotals(a.id), await getGoldTotals(b.id)].map((t) => t.earned).sort((x, y) => x - y);
    expect(amounts2).toEqual([30, 60]);
    // Refused records stage nothing.
    const bad = { ...record, matchId: randomUUID(), evidenceSha256: "0".repeat(64) };
    matchIds.push(bad.matchId);
    expect(await service.submit(bad)).toBe("refused");
    const db = getDb();
    expect(await db.select().from(goldEarnLedger).where(eq(goldEarnLedger.matchId, bad.matchId))).toEqual([]);
  });

  it("leaves private matches with zero earn rows", async () => {
    const [a, b] = [await mkPlayer("pa"), await mkPlayer("pb")];
    const service = new SettlementService({
      dir: mkdtempSync(path.join(tmpdir(), "gold-life-")),
      retryDelaysMs: [],
      sleep: async () => {},
      gold: new GoldService(),
    });
    dirs.push(service.dir);
    const s = new BattleSession({ seed: () => "d0ffee00d0ffee00d0ffee00d0ffee00", int: (n) => (n === 2 ? 1 : 0) });
    s.mode = "private";
    s.join({ playerId: a.id, username: "ga" });
    s.join({ playerId: b.id, username: "gb" });
    const load = (preset: string) => makeLoadout([...PRESETS[preset]!.cards], PRESETS[preset]!.commanderClass as CommanderClass);
    s.setReady(a.id, load("swarm"));
    s.setReady(b.id, load("swarm"));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    driveToFinish(s);
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: `g-${matchId.slice(0, 8)}`, matchType: "private", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] });
    expect(await service.submit(record)).toBe("settled");
    const db = getDb();
    expect(await db.select().from(goldEarnLedger).where(eq(goldEarnLedger.matchId, matchId))).toEqual([]);
    expect((await getGoldTotals(a.id)).balance).toBe(0);
  });
});
