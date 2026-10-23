// P1b.2 ranked trophy persistence and board. TEST branch only, never PROD.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchParticipants, matches, players, rankedTrophyAwards, rankedTrophyBalances, type Player } from "@/db/schema";
import { RANKED_SEASON } from "@/lib/ranked";
import {
  awardRankedMatch,
  getMyRanked,
  getRankedLeaderboard,
  getRankedPosition,
  reconcileRankedTrophies,
} from "./ranked";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

async function cleanFixtures() {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(rankedTrophyAwards).where(inArray(rankedTrophyAwards.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(rankedTrophyBalances).where(inArray(rankedTrophyBalances.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
}

beforeAll(async () => {
  await cleanFixtures();
});
afterAll(async () => {
  await cleanFixtures();
  resetDbCache();
});

async function rankedPlayer(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:trophy_${name}_${randomUUID().slice(0, 8)}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

/** Durable settled ranked rows (the award path reads these, never replays). */
async function seedRanked(a: Player, b: Player, outcome: { winnerSeat: 0 | 1 | null }, crowns: [number, number] = [3, 0]) {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const db = getDb();
  const deck8 = ["swarm", "archer", "sparkcaster", "sentry", "snare", "sprites", "bolt", "cmdr:free-scout"];
  const resultFor = (seat: 0 | 1) => (outcome.winnerSeat === null ? "draw" : outcome.winnerSeat === seat ? "win" : "loss");
  await db.insert(matches).values({
    id: matchId,
    roomId: `ranked-${matchId.slice(0, 8)}`,
    matchType: "ranked",
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: new Date(),
    settledAt: new Date(),
    outcome: outcome.winnerSeat === null ? "draw" : "win",
    winnerSeat: outcome.winnerSeat,
    endReason: "core",
    crowns0: crowns[0],
    crowns1: crowns[1],
    ticks: 1800,
    liveHash: "h",
    replayHash: "h",
    evidenceSha256: "e",
    verification: "replay-verified",
  });
  for (const seat of [0, 1] as const) {
    const p = seat === 0 ? a : b;
    await db.insert(matchParticipants).values({
      matchId,
      seat,
      playerId: p.id,
      result: resultFor(seat),
      crowns: crowns[seat],
      deck: deck8,
      commanderKind: "free",
      commanderClass: "scout",
      nftTokenId: null,
      commanderIdentity: {},
      entitlementOwner: null,
    });
  }
  return matchId;
}

async function seedOtherType(a: Player, b: Player, matchType: "private" | "matchmaking") {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const db = getDb();
  const deck8 = ["swarm", "archer", "sparkcaster", "sentry", "snare", "sprites", "bolt", "cmdr:free-scout"];
  await db.insert(matches).values({
    id: matchId,
    roomId: `other-${matchId.slice(0, 8)}`,
    matchType,
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: new Date(),
    settledAt: new Date(),
    outcome: "win",
    winnerSeat: 0,
    endReason: "core",
    crowns0: 3,
    crowns1: 0,
    ticks: 1800,
    liveHash: "h",
    replayHash: "h",
    evidenceSha256: "e",
    verification: "replay-verified",
  });
  for (const seat of [0, 1] as const) {
    await db.insert(matchParticipants).values({
      matchId,
      seat,
      playerId: seat === 0 ? a.id : b.id,
      result: seat === 0 ? "win" : "loss",
      crowns: seat === 0 ? 3 : 0,
      deck: deck8,
      commanderKind: "free",
      commanderClass: "scout",
      nftTokenId: null,
      commanderIdentity: {},
      entitlementOwner: null,
    });
  }
  return matchId;
}

const balances = async () => getDb().select().from(rankedTrophyBalances);
const awardsFor = (matchId: string) =>
  getDb().select().from(rankedTrophyAwards).where(eq(rankedTrophyAwards.matchId, matchId));

describe("P1b.2 trophy awards", () => {
  it("starts at zero with no standing for a fresh player", async () => {
    const p = await rankedPlayer(`fresh${randomUUID().slice(0, 4)}`);
    const me = await getMyRanked(p.id);
    expect(me).toMatchObject({ season: RANKED_SEASON, trophies: 0, eligible: false, position: null, rankedMatches: 0, recent: [] });
  });

  it("awards a verified ranked win and floors the loss at zero", async () => {
    const [a, b] = [await rankedPlayer(`w${randomUUID().slice(0, 4)}`), await rankedPlayer(`l${randomUUID().slice(0, 4)}`)];
    const matchId = await seedRanked(a, b, { winnerSeat: 0 });
    const r = await awardRankedMatch(matchId);
    expect(r).toEqual({ status: "awarded", applied: 2 });
    const rows = await awardsFor(matchId);
    expect(new Map(rows.map((x) => [x.playerId, x]))).toMatchObject(
      new Map([
        [a.id, expect.objectContaining({ result: "win", delta: 25, balanceAfter: 25 })],
        [b.id, expect.objectContaining({ result: "loss", delta: 0, balanceAfter: 0 })],
      ])
    );
    expect(await getMyRanked(a.id)).toMatchObject({ trophies: 25, rankedMatches: 1, wins: 1, eligible: true });
    expect(await getMyRanked(b.id)).toMatchObject({ trophies: 0, rankedMatches: 1, losses: 1 });
  });

  it("records draws as draws with zero trophy change", async () => {
    const [a, b] = [await rankedPlayer(`d1${randomUUID().slice(0, 4)}`), await rankedPlayer(`d2${randomUUID().slice(0, 4)}`)];
    const matchId = await seedRanked(a, b, { winnerSeat: null }, [2, 2]);
    await awardRankedMatch(matchId);
    const rows = await awardsFor(matchId);
    expect(rows.map((x) => x.result).sort()).toEqual(["draw", "draw"]);
    expect(rows.every((x) => x.delta === 0)).toBe(true);
    expect(await getMyRanked(a.id)).toMatchObject({ trophies: 0, draws: 1, eligible: true });
  });

  it("floors repeated losses at zero without going negative", async () => {
    const [a, b] = [await rankedPlayer(`f1${randomUUID().slice(0, 4)}`), await rankedPlayer(`f2${randomUUID().slice(0, 4)}`)];
    await awardRankedMatch(await seedRanked(a, b, { winnerSeat: 0 }));
    await awardRankedMatch(await seedRanked(b, a, { winnerSeat: 0 }));
    await awardRankedMatch(await seedRanked(b, a, { winnerSeat: 0 }));
    const me = await getMyRanked(a.id);
    // 25 - 20 = 5, then 5 - 20 floors at 0 (absorbed delta -5, not -20).
    expect(me.trophies).toBe(0);
    expect(me).toMatchObject({ rankedMatches: 3, wins: 1, losses: 2 });
    const last = me.recent[0]!;
    expect(last.delta).toBe(-5);
    expect(last.balanceAfter).toBe(0);
  });

  it("awards nothing for private, unranked, unknown or unverified matches", async () => {
    const [a, b] = [await rankedPlayer(`p1${randomUUID().slice(0, 4)}`), await rankedPlayer(`p2${randomUUID().slice(0, 4)}`)];
    for (const t of ["private", "matchmaking"] as const) {
      const id = await seedOtherType(a, b, t);
      expect(await awardRankedMatch(id)).toMatchObject({ status: "skipped", applied: 0 });
      expect(await awardsFor(id)).toEqual([]);
    }
    expect(await awardRankedMatch(randomUUID())).toMatchObject({ status: "skipped", applied: 0 });
    expect(await balances()).toEqual(expect.not.arrayContaining([expect.objectContaining({ playerId: a.id })]));
  });

  it("never double-awards a duplicate settlement, even concurrently", async () => {
    const [a, b] = [await rankedPlayer(`c1${randomUUID().slice(0, 4)}`), await rankedPlayer(`c2${randomUUID().slice(0, 4)}`)];
    const matchId = await seedRanked(a, b, { winnerSeat: 1 });
    const first = await awardRankedMatch(matchId);
    expect(first.status).toBe("awarded");
    const rest = await Promise.all(Array.from({ length: 5 }, () => awardRankedMatch(matchId)));
    expect(rest.every((r) => r.status === "already-awarded" && r.applied === 0)).toBe(true);
    expect(await getMyRanked(b.id)).toMatchObject({ trophies: 25, wins: 1 });
    expect((await awardsFor(matchId)).length).toBe(2);
  });

  it("reconciles interrupted runs and never-settled awards exactly once", async () => {
    const [a, b] = [await rankedPlayer(`r1${randomUUID().slice(0, 4)}`), await rankedPlayer(`r2${randomUUID().slice(0, 4)}`)];
    // Interrupted run: ledger staged, balances untouched.
    const interrupted = await seedRanked(a, b, { winnerSeat: 0 });
    await getDb().insert(rankedTrophyAwards).values([
      { matchId: interrupted, playerId: a.id, season: RANKED_SEASON, result: "win", delta: 0, balanceAfter: null },
      { matchId: interrupted, playerId: b.id, season: RANKED_SEASON, result: "loss", delta: 0, balanceAfter: null },
    ]);
    // Settled but never processed.
    await seedRanked(a, b, { winnerSeat: 1 });
    const rec = await reconcileRankedTrophies(50);
    expect(rec.processed).toBeGreaterThanOrEqual(2);
    // a: +25 then -20 = 5. b: 0 (floored loss) then +25 = 25. Both 1-1.
    expect(await getMyRanked(a.id)).toMatchObject({ trophies: 5, wins: 1, losses: 1 });
    expect(await getMyRanked(b.id)).toMatchObject({ trophies: 25, wins: 1, losses: 1 });
    const again = await reconcileRankedTrophies(50);
    expect(again).toEqual({ processed: 0, awarded: 0 });
  });
});

describe("P1b.2 ranked board", () => {
  it("orders by trophies with stable username tiebreaks and isolates seasons", async () => {
    const names = ["alpha", "bravo", "charlie"].map((n) => `${n}${randomUUID().slice(0, 4)}`);
    const [pa, pb, pc] = await Promise.all(names.map(rankedPlayer));
    await awardRankedMatch(await seedRanked(pa, pb, { winnerSeat: 0 }));
    await awardRankedMatch(await seedRanked(pc, pb, { winnerSeat: 0 }));
    await awardRankedMatch(await seedRanked(pb, pa, { winnerSeat: 1 }));
    // pa: 25+25=50 (2-0). pc: 25 (1-0). pb: 0 (0-3).
    const board = await getRankedLeaderboard({ limit: 50 });
    const order = board.entries.filter((e) => [pa.id, pb.id, pc.id].includes(e.playerId));
    expect(order.map((e) => e.playerId)).toEqual([pa.id, pc.id, pb.id]);
    expect(order.map((e) => e.trophies)).toEqual([50, 25, 0]);
    expect(order.map((e) => e.position)).toEqual([order[0]!.position, order[1]!.position, order[2]!.position]);
    // A tie on trophies shares one position and sorts by username_key.
    const [t1, t2] = [await rankedPlayer(`tiea${randomUUID().slice(0, 4)}`), await rankedPlayer(`tieb${randomUUID().slice(0, 4)}`)];
    await awardRankedMatch(await seedRanked(t1, pb, { winnerSeat: 0 }));
    await awardRankedMatch(await seedRanked(t2, pb, { winnerSeat: 0 }));
    const retied = (await getRankedLeaderboard({ limit: 50 })).entries.filter((e) => [t1.id, t2.id].includes(e.playerId));
    expect(retied.map((e) => e.trophies)).toEqual([25, 25]);
    expect(retied[0]!.position).toBe(retied[1]!.position);
    expect(retied.map((e) => e.username)).toEqual([...retied.map((e) => e.username)].sort());
    // Season 2 rows are invisible to the Season 1 board.
    await getDb().insert(rankedTrophyBalances).values({ playerId: pc.id, season: RANKED_SEASON + 1, trophies: 9999, rankedMatches: 9, rankedWins: 9, rankedLosses: 0, rankedDraws: 0 });
    const s1 = (await getRankedLeaderboard({ limit: 50 })).entries.find((e) => e.playerId === pc.id)!;
    expect(s1.trophies).toBe(25);
    // Me position resolves for a qualifier and stays null otherwise.
    expect(await getRankedPosition(pa.id)).toMatchObject({ eligible: true, trophies: 50 });
    const fresh = await rankedPlayer(`zzz${randomUUID().slice(0, 4)}`);
    expect(await getRankedPosition(fresh.id)).toEqual({ eligible: false, position: null, trophies: 0, rankedMatches: 0 });
  });
});
