// B3.3c progression tests (isolated TEST branch). Real matches come from
// finished BattleSession records settled through the production
// SettlementService path; higher-volume leaderboard fixtures are seeded
// settled rows, labelled as such below.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  matchEvidence,
  matchLegacyRuns,
  matchParticipants,
  matches,
  nftLegacyEvents,
  nftTokens,
  players,
  type Player,
} from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import { PRESETS, BattleSession, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, makeLoadoutWithGrant, nftGrant, testLockedPatron } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay } from "@/server/battle/settlement";
import { LegacyProcessor } from "@/server/battle/legacy";
import { getPlayerStats, getCasualLeaderboard, getCasualPosition, CASUAL_MIN_MATCHES } from "@/db/progression";
import type { CommanderClass } from "@/lib/commanders";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const createdTokenIds: string[] = [];
const dirs: string[] = [];

const mkPlayer = async (name: string, username?: string): Promise<Player> => {
  const p = await provisionPlayer({ privyDid: `did:privy:prog_${name}_${randomUUID().slice(0, 8)}` });
  if (username) {
    await getDb().update(players).set({ username, usernameKey: username, avatarId: "chog-1" }).where(eq(players.id, p.id));
    p.username = username;
  }
  createdPlayerIds.push(p.id);
  return p;
};
const tmpDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "prog-"));
  dirs.push(d);
  return d;
};

afterAll(async () => {
  const db = getDb();
  if (createdTokenIds.length > 0) {
    const owned = db.select({ id: nftTokens.id }).from(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
    await db.delete(nftLegacyEvents).where(inArray(nftLegacyEvents.nftId, owned));
    await db.delete(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
  }
  if (matchIds.length > 0) {
    await db.delete(matchLegacyRuns).where(inArray(matchLegacyRuns.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) await db.delete(players).where(inArray(players.id, createdPlayerIds));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
});

const SEED = "feedfacefeedfacefeedfacefeedface";
const rng = (seatFlip = 0, seed = SEED): SessionRandom => ({ seed: () => seed, int: (n) => (n === 2 ? seatFlip : 0) });
const preset = (name: string) => ({ cards: [...PRESETS[name]!.cards], cls: PRESETS[name]!.commanderClass as CommanderClass });

/** Real finished session (no commands -> timeout draw) settled via the
 * production service. Used where cheap; volume fixtures are seeded rows. */
async function settleReal(a: Player, b: Player, matchType: "private" | "matchmaking" = "private") {
  const s = new BattleSession(rng());
  s.join({ playerId: a.id, username: "a" });
  s.join({ playerId: b.id, username: "b" });
  const d0 = preset("swarm");
  const d1 = preset("siege");
  s.setReady(a.id, makeLoadoutWithGrant(d0.cards, freeGrant(d0.cls)));
  s.setReady(b.id, makeLoadoutWithGrant(d1.cards, freeGrant(d1.cls)));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
  while (s.phase === "active") s.tick();
  const matchId = randomUUID();
  matchIds.push(matchId);
  const rec = recordFromReplay(s.replay!, {
    matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType,
    startedAt: new Date(Date.now() - 60_000),
    crowns: [...s.state!.crowns] as [number, number],
  });
  const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
  return { record: rec, status: await svc.submit(rec) };
}

/** Seeded settled-row fixture for volume cases. The row shape matches what
 * settleMatch writes; labelled fixtures, never replayed by the processor. */
async function seedMatch(opts: {
  a: Player;
  b: Player;
  type: "private" | "matchmaking";
  winnerSeat?: 0 | 1 | null;
  crowns?: [number, number];
  settledAt?: Date;
}) {
  const { a, b, type, winnerSeat = 0, crowns = [3, 0], settledAt = new Date() } = opts;
  const matchId = randomUUID();
  matchIds.push(matchId);
  const db = getDb();
  const deck8 = [...PRESETS.swarm!.cards, "cmdr:free-scout"];
  await db.insert(matches).values({
    id: matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType: type,
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(settledAt.getTime() - 60_000),
    finishedAt: settledAt,
    settledAt,
    outcome: winnerSeat === null ? "draw" : "win",
    winnerSeat,
    endReason: "core",
    crowns0: crowns[0],
    crowns1: crowns[1],
    ticks: 1234,
    liveHash: `hash-${matchId}`,
    replayHash: `hash-${matchId}`,
    evidenceSha256: `ev-${matchId}`,
    verification: "replay-verified",
  });
  const resultOf = (seat: 0 | 1) => (winnerSeat === null ? "draw" : winnerSeat === seat ? "win" : "loss");
  await db.insert(matchParticipants).values([
    { matchId, seat: 0, playerId: a.id, result: resultOf(0), crowns: crowns[0], deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
    { matchId, seat: 1, playerId: b.id, result: resultOf(1), crowns: crowns[1], deck: deck8, commanderKind: "free", commanderClass: "scout", commanderIdentity: {} },
  ]);
  return matchId;
}

describe("getPlayerStats", () => {
  it("counts W/L/D with draws excluded from wins, plus crowns and type split", async () => {
    const me = await mkPlayer("s1");
    const them = await mkPlayer("s1o");
    // Fixtures: me wins 2 (one mm, one private), loses 1 mm, draws 1 private.
    await seedMatch({ a: me, b: them, type: "matchmaking", winnerSeat: 0, crowns: [3, 1] });
    await seedMatch({ a: me, b: them, type: "private", winnerSeat: 0, crowns: [2, 0] });
    await seedMatch({ a: them, b: me, type: "matchmaking", winnerSeat: 0, crowns: [3, 1] });
    await seedMatch({ a: me, b: them, type: "private", winnerSeat: null, crowns: [1, 1] });
    const s = await getPlayerStats(me.id);
    expect(s).toMatchObject({ total: 4, wins: 2, losses: 1, draws: 1, winRateBp: 5000, crownsEarned: 7, crownsConceded: 5 });
    expect(s.byType.matchmaking).toEqual({ matches: 2, wins: 1, losses: 1, draws: 0 });
    expect(s.byType.private).toEqual({ matches: 2, wins: 1, losses: 0, draws: 1 });
    expect(s.firstMatchAt).not.toBeNull();
    expect(s.latestMatchAt).not.toBeNull();
  });

  it("returns zeros and null rate/dates for a player with no matches", async () => {
    const me = await mkPlayer("s2");
    const s = await getPlayerStats(me.id);
    expect(s).toMatchObject({ total: 0, wins: 0, losses: 0, draws: 0, winRateBp: null, crownsEarned: 0, crownsConceded: 0, firstMatchAt: null, latestMatchAt: null });
  });

  it("a real settled match counts once even when submitted twice or concurrently", async () => {
    const a = await mkPlayer("s3a");
    const b = await mkPlayer("s3b");
    const { record, status } = await settleReal(a, b);
    expect(status).toBe("settled");
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    const other = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    const [r1, r2] = await Promise.all([svc.submit(record), other.submit(record)]);
    expect([r1, r2].sort()).toEqual(["already-settled", "already-settled"]);
    expect((await getPlayerStats(a.id)).total).toBe(1);
  }, 120_000);

  it("a refused tampered record never reaches stats", async () => {
    const a = await mkPlayer("s4a");
    const b = await mkPlayer("s4b");
    const { record } = await settleReal(a, b);
    const before = await getPlayerStats(a.id);
    const tampered = { ...record, matchId: randomUUID(), evidence: { ...record.evidence, config: { ...record.evidence.config, seed: "00".repeat(16) } } };
    matchIds.push(tampered.matchId);
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(tampered)).toBe("refused");
    expect(await getPlayerStats(a.id)).toEqual(before);
  }, 120_000);

  it("an undeployed NFT commander match still counts as participation while legacy emits nothing", async () => {
    const a = await mkPlayer("s5a");
    const b = await mkPlayer("s5b");
    createdTokenIds.push("91301");
    const token = await upsertNftToken({ tokenId: "91301" });
    await upsertNftMetadata(token.id, {
      sourceUrl: "https://fixture/91301.json",
      contentHash: "hash-91301",
      document: {},
      name: "CHOG #91301",
      description: null,
      imageOriginal: null,
      attributesOriginal: [],
      fetchedAt: new Date(),
    });
    const s = new BattleSession(rng());
    s.join({ playerId: a.id, username: "a" });
    s.join({ playerId: b.id, username: "b" });
    const d0 = preset("swarm");
    const d1 = preset("siege");
    s.setReady(a.id, makeLoadoutWithGrant(d0.cards, nftGrant("91301", "0x" + "ab".repeat(20), d0.cls)));
    s.setReady(b.id, makeLoadoutWithGrant(d1.cards, freeGrant(d1.cls)));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    while (s.phase === "active") s.tick();
    const matchId = randomUUID();
    matchIds.push(matchId);
    const rec = recordFromReplay(s.replay!, { matchId, roomId: "r", matchType: "matchmaking", startedAt: new Date(), crowns: [...s.state!.crowns] as [number, number] });
    expect(await new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} }).submit(rec)).toBe("settled");
    const res = await new LegacyProcessor().processMatch(matchId);
    expect(res.status).toBe("no-eligible");
    const stats = await getPlayerStats(a.id);
    expect(stats.total).toBe(1);
    expect(stats.byType.matchmaking.matches).toBe(1);
  }, 120_000);
});

describe("casual leaderboard", () => {
  it("requires matchmaking matches and an active account; private rows never count", async () => {
    const priv = await mkPlayer("lb1", `lb_${randomUUID().slice(0, 4)}priv`);
    const mm = await mkPlayer("lb2", `lb_${randomUUID().slice(0, 4)}mmmm`);
    const short = await mkPlayer("lb3", `lb_${randomUUID().slice(0, 4)}shrt`);
    const opp = await mkPlayer("lb4", `lb_${randomUUID().slice(0, 4)}oppp`);
    for (let i = 0; i < 3; i += 1) await seedMatch({ a: priv, b: opp, type: "private", winnerSeat: 0 });
    for (let i = 0; i < 3; i += 1) await seedMatch({ a: mm, b: opp, type: "matchmaking", winnerSeat: 0 });
    for (let i = 0; i < 2; i += 1) await seedMatch({ a: short, b: opp, type: "matchmaking", winnerSeat: 0 });
    // opp has 5 mm losses: eligible too (min matches, not min wins).
    const { entries } = await getCasualLeaderboard();
    const names = entries.map((e) => e.username);
    expect(names).toContain(mm.username);
    expect(names).toContain(opp.username);
    expect(names).not.toContain(priv.username);
    expect(names).not.toContain(short.username);
    const p = await getCasualPosition(short.id);
    expect(p).toEqual({ eligible: false, position: null, matchmakingMatches: 2 });
    expect((await getCasualPosition(mm.id)).eligible).toBe(true);
    expect((await getCasualPosition(priv.id)).matchmakingMatches).toBe(0);
  });

  it("suspended accounts are excluded even with enough matches", async () => {
    const banned = await mkPlayer("lb5", `lb_${randomUUID().slice(0, 4)}ban1`);
    const opp = await mkPlayer("lb6", `lb_${randomUUID().slice(0, 4)}ban2`);
    for (let i = 0; i < 3; i += 1) await seedMatch({ a: banned, b: opp, type: "matchmaking", winnerSeat: 0 });
    await getDb().update(players).set({ accountStatus: "suspended" }).where(eq(players.id, banned.id));
    const { entries } = await getCasualLeaderboard();
    expect(entries.map((e) => e.username)).not.toContain(banned.username);
  });

  it("ties share a RANK position and sort stably by username_key", async () => {
    const t = randomUUID().slice(0, 4);
    const zeta = await mkPlayer("tie1", `tie_${t}_zeta`);
    const alfa = await mkPlayer("tie2", `tie_${t}_alfa`);
    const opp = await mkPlayer("tie3", `tie_${t}_oppo`);
    // Identical records for zeta and alfa: same wins, rate and crowns.
    for (const p of [zeta, alfa]) {
      for (let i = 0; i < 3; i += 1) await seedMatch({ a: p, b: opp, type: "matchmaking", winnerSeat: 0, crowns: [2, 0] });
    }
    const { entries } = await getCasualLeaderboard({ limit: 50 });
    const mine = entries.filter((e) => [zeta.username, alfa.username].includes(e.username!));
    expect(mine).toHaveLength(2);
    expect(mine[0]!.position).toBe(mine[1]!.position);
    expect(mine[0]!.username).toBe(alfa.username); // username_key asc inside the tie
    expect(mine[1]!.username).toBe(zeta.username);
  });

  it("paginates stably with no gaps or duplicates", async () => {
    const opp = await mkPlayer("pg9", `pg_${randomUUID().slice(0, 4)}oppo`);
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const p = await mkPlayer(`pg${i}`, `pg_${randomUUID().slice(0, 4)}_${i}`);
      ids.push(p.id);
      for (let j = 0; j < CASUAL_MIN_MATCHES; j += 1) {
        await seedMatch({ a: p, b: opp, type: "matchmaking", winnerSeat: (i % 2) as 0 | 1, crowns: [i % 3, j % 3] });
      }
    }
    // Walk small pages over the whole board; the union must contain each of
    // our players exactly once and keep the global wins-desc order.
    const seen = new Map<string, number>();
    const ordered: typeof ids = [];
    for (let off = 0; ; off += 2) {
      const page = await getCasualLeaderboard({ limit: 2, offset: off });
      for (const e of page.entries) {
        if (ids.includes(e.playerId)) {
          expect(seen.has(e.playerId)).toBe(false);
          seen.set(e.playerId, e.wins);
          ordered.push(e.playerId);
        }
      }
      if (page.entries.length < 2 || seen.size === 7) break;
    }
    expect(ordered.length).toBe(7);
    const wins = ordered.map((id) => seen.get(id)!);
    expect([...wins].sort((x, y) => y - x)).toEqual(wins);
  });
});
