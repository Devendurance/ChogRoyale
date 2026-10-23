// P1b.2 trophy award on the settlement lifecycle. TEST branch only.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchEvidence, matchParticipants, matches, players, rankedTrophyAwards, rankedTrophyBalances, type Player } from "@/db/schema";
import { PRESETS, BattleSession, type TrustedLoadout } from "@/server/battle/session";
import type { CommanderClass } from "@/lib/commanders";
import { makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay } from "@/server/battle/settlement";
import { TrophyService } from "./trophies";
import { getMyRanked } from "@/db/ranked";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const dirs: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(rankedTrophyAwards).where(inArray(rankedTrophyAwards.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(rankedTrophyBalances).where(inArray(rankedTrophyBalances.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:lifecycle_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

/** Blind deploy spam per slot; engine rejects illegal ones, survivors fight. */
function driveToFinish(s: BattleSession) {
  let n = 0;
  const decks = s.readyLoadouts();
  let guard = 0;
  while (s.phase === "active" && guard++ < 4000) {
    s.slots.forEach((p, slot) => {
      if (!p) return;
      const seat = s.seatOfSlot[slot]!;
      const deck = decks[slot]!;
      const card = [...deck.cards, `cmdr:${deck.grant.slot.commanderId}`][n % 8]!;
      n += 1;
      s.submit(p.playerId, { type: "deploy", cid: `t${n}`, cardId: card, x: 30 + ((n % 2) * 40), y: seat === 0 ? 60 : 100 });
    });
    s.tick();
  }
}

function finishedRanked(a: Player, b: Player, seatFlip = 0, decks: [string, string] = ["swarm", "siege"]) {
  const s = new BattleSession({ seed: () => `c0ffee${seatFlip}c0ffee00c0ffee00c0ffee00`, int: (n) => (n === 2 ? seatFlip : 0) });
  s.mode = "ranked";
  s.join({ playerId: a.id, username: "ra" });
  s.join({ playerId: b.id, username: "rb" });
  const load = (preset: string) => makeLoadout([...PRESETS[preset]!.cards], PRESETS[preset]!.commanderClass as CommanderClass);
  s.setReady(a.id, load(decks[0]!));
  s.setReady(b.id, load(decks[1]!));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
  driveToFinish(s);
  if (s.phase !== "finished") throw new Error("session did not finish");
  const matchId = randomUUID();
  matchIds.push(matchId);
  return { matchId, record: recordFromReplay(s.replay!, { matchId, roomId: `r-${matchId.slice(0, 8)}`, matchType: "ranked", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] }) };
}

describe("P1b.2 trophy lifecycle", () => {
  it("awards trophies only after the DB confirms the settle, never on refusal", async () => {
    const [a, b] = [await mkPlayer("la"), await mkPlayer("lb")];
    const svc = new SettlementService({ dir: mkdtempSync(path.join(tmpdir(), "trophy-life-")), retryDelaysMs: [], sleep: async () => {}, trophies: new TrophyService() });
    dirs.push(svc.dir);
    // Draws award nothing either side, so walk deck/seat combos for a win.
    const combos: Array<[number, [string, string]]> = [
      [0, ["antiSwarm", "swarm"]],
      [1, ["antiSwarm", "swarm"]],
      [0, ["breaker", "turret"]],
      [1, ["breaker", "turret"]],
      [0, ["swarm", "turret"]],
      [1, ["swarm", "turret"]],
    ];
    let done: ReturnType<typeof finishedRanked> | null = null;
    for (const [flip, decks] of combos) {
      if (done) break;
      const cand = finishedRanked(a, b, flip, decks);
      if (cand.record.winnerSeat !== null) done = cand;
    }
    expect(done).not.toBeNull();
    const { record } = done!;
    expect(await svc.submit(record)).toBe("settled");
    const winner = record.winnerSeat === 0 ? a : b;
    const loser = record.winnerSeat === 0 ? b : a;
    expect(await getMyRanked(winner.id)).toMatchObject({ trophies: 25, wins: 1 });
    expect(await getMyRanked(loser.id)).toMatchObject({ trophies: 0, losses: 1 });
    // Duplicate submit resolves idempotent and awards nothing twice.
    expect(await svc.submit(record)).toBe("already-settled");
    expect(await getMyRanked(winner.id)).toMatchObject({ trophies: 25, rankedMatches: 1 });
    // A refused (tampered) record settles nothing and awards nothing.
    const badId = randomUUID();
    matchIds.push(badId);
    const bad = { ...record, matchId: badId, evidenceSha256: "0".repeat(64) };
    expect(await svc.submit(bad)).toBe("refused");
    const db = getDb();
    expect(await db.select().from(rankedTrophyAwards).where(inArray(rankedTrophyAwards.matchId, [badId]))).toEqual([]);
  });
});
