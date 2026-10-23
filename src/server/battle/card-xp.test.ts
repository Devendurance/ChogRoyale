// P2a card XP lifecycle and usage extraction. TEST branch only.
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
  matchEvidence,
  matchParticipants,
  matches,
  players,
  type Player,
} from "@/db/schema";
import { CARDS_V1, type CombatCommand } from "@/lib/combat";
import { PRESETS, BattleSession, type TrustedLoadout } from "@/server/battle/session";
import type { CommanderClass } from "@/lib/commanders";
import { makeLoadout, testLockedPatron } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay } from "@/server/battle/settlement";
import { CardXpService, countDeployments } from "./card-xp";
import { getMyCardXp } from "@/db/card-xp";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const dirs: string[] = [];

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, matchIds));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
});

async function mkPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:xplife_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
}

/** Blind deploy spam per slot; the engine rejects illegal ones. */
function driveToFinish(s: BattleSession, extra?: (slot: number, n: number) => { cardId: string; x: number; y: number } | null) {
  let n = 0;
  const decks = s.readyLoadouts();
  let guard = 0;
  while (s.phase === "active" && guard++ < 4000) {
    s.slots.forEach((pl, slot) => {
      if (!pl) return;
      const seat = s.seatOfSlot[slot]!;
      const deck = decks[slot]!;
      const cards = [...deck.cards, `cmdr:${deck.grant.slot.commanderId}`];
      const pick = extra?.(slot, n) ?? { cardId: cards[n % cards.length]!, x: 30 + ((n % 2) * 40), y: seat === 0 ? 60 : 100 };
      n += 1;
      s.submit(pl.playerId, { type: "deploy", cid: `t${n}`, cardId: pick.cardId, x: pick.x, y: pick.y });
    });
    s.tick();
  }
}

function startRanked(a: Player, b: Player, decks: [string, string] = ["swarm", "siege"], seedFlip = 0) {
  const s = new BattleSession({ seed: () => `c0ffee${seedFlip}c0ffee00c0ffee00c0ffee00`, int: (n) => (n === 2 ? seedFlip : 0) });
  s.mode = "ranked";
  s.join({ playerId: a.id, username: "xa" });
  s.join({ playerId: b.id, username: "xb" });
  const load = (preset: string) => makeLoadout([...PRESETS[preset]!.cards], PRESETS[preset]!.commanderClass as CommanderClass);
  s.setReady(a.id, load(decks[0]!));
  s.setReady(b.id, load(decks[1]!));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
  return s;
}

const svc = () =>
  new SettlementService({
    dir: mkdtempSync(path.join(tmpdir(), "cardxp-life-")),
    retryDelaysMs: [],
    sleep: async () => {},
    cardXp: new CardXpService(),
  });

describe("P2a usage counting", () => {
  it("counts accepted ordinary deploys per player with caps, excluding rejects, abilities and commanders", async () => {
    const [a, b] = [await mkPlayer("ea"), await mkPlayer("eb")];
    const cmds: CombatCommand[] = [];
    let seq = 1;
    const push = (player: 0 | 1, cardId: string, tick = 10) => cmds.push({ seq: seq++, player, tick, cardId, x: 30, y: player === 0 ? 60 : 100 });
    for (let i = 0; i < 7; i += 1) push(0, "choglings", 10 + i); // per-card cap 5
    for (let i = 0; i < 30; i += 1) push(0, "sparkcaster", 20 + i);
    push(0, "nope-not-a-card", 60);
    push(0, "cmdr:free-scout", 61); // commander identity earns nothing
    cmds.push({ kind: "ability", seq: seq++, player: 0, tick: 62, abilityId: "scout-shadow-step" });
    for (let i = 0; i < 3; i += 1) push(1, "sparkcaster", 70 + i);
    // Three accepted sparkcaster seqs rejected: forged extras earn nothing.
    const rejected = new Set([11, 12, 13]);
    const usage = countDeployments(cmds, rejected, [{ playerId: a.id }, { playerId: b.id }]);
    const byKey = new Map(usage.map((u) => [`${u.playerId}:${u.cardId}`, u]));
    expect(byKey.get(`${a.id}:choglings`)).toMatchObject({ deployments: 5, xp: 5 });
    // 30 sparkcaster minus 3 rejected = 27, per-card cap 5; cardId order
    // spends choglings first, total stays within the match cap.
    expect(byKey.get(`${a.id}:sparkcaster`)).toMatchObject({ deployments: 5, xp: 5 });
    expect(byKey.get(`${b.id}:sparkcaster`)).toMatchObject({ deployments: 3, xp: 3 });
    const totalA = usage.filter((u) => u.playerId === a.id).reduce((n, u) => n + u.xp, 0);
    expect(totalA).toBeLessThanOrEqual(20);
    // No cross-attribution, no commander/ability/bogus rows.
    expect([...byKey.keys()].filter((k) => k.startsWith(`${b.id}:`) && k.endsWith("choglings")).length).toBe(0);
    expect([...byKey.keys()].some((k) => k.includes("cmdr:") || k.includes("nope"))).toBe(false);
    expect(usage.every((u) => CARDS_V1[u.cardId])).toBe(true);
  });
});

describe("P2a card XP lifecycle", () => {
  it("awards usage XP on settle, stays idempotent, and skips private/refused/unknown", async () => {
    const [a, b] = [await mkPlayer("la"), await mkPlayer("lb")];
    const service = svc();
    dirs.push(service.dir);
    const s = startRanked(a, b, ["antiSwarm", "swarm"]);
    driveToFinish(s);
    expect(s.phase).toBe("finished");
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: `xp-${matchId.slice(0, 8)}`, matchType: "ranked", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] });
    expect(await service.submit(record)).toBe("settled");
    const me = await getMyCardXp(a.id);
    const earned = me.cards.filter((c) => c.xp > 0);
    expect(earned.length).toBeGreaterThan(0);
    expect(earned.every((c) => c.xp <= 5)).toBe(true);
    expect(me.cards.reduce((n, c) => n + c.xp, 0)).toBeLessThanOrEqual(20);
    // Opponent attribution is separate: b earned on its own cards.
    const meB = await getMyCardXp(b.id);
    expect(meB.cards.reduce((n, c) => n + c.xp, 0)).toBeLessThanOrEqual(20);
    // Duplicate settlement never double-awards.
    const before = me.cards.reduce((n, c) => n + c.xp, 0);
    expect(await service.submit(record)).toBe("already-settled");
    const after = (await getMyCardXp(a.id)).cards.reduce((n, c) => n + c.xp, 0);
    expect(after).toBe(before);
    // Refused and unknown matches award nothing and throw nothing.
    const bad = { ...record, matchId: randomUUID(), evidenceSha256: "0".repeat(64) };
    matchIds.push(bad.matchId);
    expect(await service.submit(bad)).toBe("refused");
    const db = getDb();
    expect(await db.select().from(cardXpRuns).where(eq(cardXpRuns.matchId, bad.matchId))).toEqual([]);
    await new CardXpService().processMatch(randomUUID());
  });

  it("leaves private matches untouched while ranked matches award", async () => {
    const [a, b] = [await mkPlayer("pa"), await mkPlayer("pb")];
    const service = svc();
    dirs.push(service.dir);
    const s = startRanked(a, b);
    driveToFinish(s);
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: `xp-${matchId.slice(0, 8)}`, matchType: "private", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] });
    expect(await service.submit(record)).toBe("settled");
    const db = getDb();
    expect(await db.select().from(cardXpRuns).where(eq(cardXpRuns.matchId, matchId))).toEqual([]);
    expect(await db.select().from(cardXpAwards).where(eq(cardXpAwards.matchId, matchId))).toEqual([]);
  });

  it("records draws as completed with no-eligible marker and heals interruptions", async () => {
    const [a, b] = [await mkPlayer("da"), await mkPlayer("db")];
    const service = svc();
    dirs.push(service.dir);
    const s = startRanked(a, b);
    while (s.phase === "active") s.tick(); // idle both sides: completed draw
    expect(s.phase).toBe("finished");
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: `xp-${matchId.slice(0, 8)}`, matchType: "matchmaking", startedAt: new Date(Date.now() - 60_000), crowns: [...s.state!.crowns] as [number, number] });
    expect(await service.submit(record)).toBe("settled");
    const db = getDb();
    const [run] = await db.select().from(cardXpRuns).where(eq(cardXpRuns.matchId, matchId));
    expect(run).toMatchObject({ status: "no-eligible", applied: true });
    // Interrupted run heals from the ledger without duplicating it.
    await db.delete(cardXpProgress).where(eq(cardXpProgress.playerId, a.id));
    await db.update(cardXpRuns).set({ applied: false }).where(eq(cardXpRuns.matchId, matchId));
    await new CardXpService().reconcile(50);
    const [healed] = await db.select().from(cardXpRuns).where(eq(cardXpRuns.matchId, matchId));
    expect(healed!.applied).toBe(true);
    expect(await db.select().from(cardXpAwards).where(eq(cardXpAwards.matchId, matchId))).toEqual([]);
  });
});
