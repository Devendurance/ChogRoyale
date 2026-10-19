// B3.3b NFT legacy processing tests. All NFT rows are synthetic trusted
// fixtures on the isolated TEST branch and are cleaned up in before/afterAll.
// Every match is a real finished BattleSession replayed, verified and
// settled through the production settleMatch path before processing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  commanders,
  matchEvidence,
  matchLegacyRuns,
  matchParticipants,
  matches,
  nftAchievementAwards,
  nftLegacyEvents,
  nftTokens,
  players,
  type Player,
} from "@/db/schema";
import { upsertNftToken, upsertNftMetadata } from "@/db/nfts";
import { upsertCommander } from "@/db/commanders";
import { COMMANDER_COMBAT_PROFILE_V1, commanderCardId, freeStarterSlot, type PlayerIndex } from "@/lib/combat";
import { botAbility } from "@/lib/arena-scenarios";
import { smartMove } from "@/lib/smart-bot";
import { BattleSession, PRESETS, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { freeGrant, makeLoadoutWithGrant, nftGrant } from "@/server/battle/test-helpers";
import { SettlementService, recordFromReplay, settleMatch, type SettlementRecord } from "@/server/battle/settlement";
import { LegacyProcessor, LegacyVerificationError } from "@/server/battle/legacy";
import type { CommanderClass } from "@/lib/commanders";
import { GET as legacyGet } from "@/app/api/nfts/[tokenId]/legacy/route";
import { GET as achievementsGet } from "@/app/api/nfts/[tokenId]/achievements/route";

beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const createdTokenIds: string[] = [];
const dirs: string[] = [];

const mkPlayer = async (name: string): Promise<Player> => {
  const p = await provisionPlayer({ privyDid: `did:privy:legacy_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
};
const tmpDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "legacy-"));
  dirs.push(d);
  return d;
};

// Synthetic Chog Genesis fixture rows, including a derived commander row so
// the immutability check can prove processing never mutates it.
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
  await upsertCommander({ nftId: token.id, tokenId, definition: freeStarterSlot("scout").definition });
  return token;
}

async function cleanup() {
  const db = getDb();
  if (createdTokenIds.length > 0) {
    const owned = db.select({ id: nftTokens.id }).from(nftTokens).where(inArray(nftTokens.tokenId, createdTokenIds));
    await db.delete(nftAchievementAwards).where(inArray(nftAchievementAwards.nftId, owned));
    await db.delete(nftLegacyEvents).where(inArray(nftLegacyEvents.nftId, owned));
    await db.delete(commanders).where(inArray(commanders.tokenId, createdTokenIds));
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
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  resetDbCache();
});

const SEED = "feedfacefeedfacefeedfacefeedface";
const OWNER = "0x" + "1a2b3c".padEnd(40, "d");
const rng = (seatFlip = 0, seed = SEED): SessionRandom => ({ seed: () => seed, int: (n) => (n === 2 ? seatFlip : 0) });
const preset = (name: string) => ({ cards: [...PRESETS[name]!.cards], cls: PRESETS[name]!.commanderClass as CommanderClass });

/**
 * Runs a real finished session. `nft` puts an NFT grant (synthetic fixture,
 * direct-owner basis) on the given seat; `drive` controls whether bot
 * commands are submitted. Without commands the match draws by timeout and
 * no commander ever deploys.
 */
async function settleMatch2(opts: {
  a: Player;
  b: Player;
  nftSeat?: PlayerIndex;
  tokenId?: string;
  owner?: string;
  decks?: [string, string];
  seed?: string;
  drive?: boolean;
  matchType?: "private" | "matchmaking";
}): Promise<{ record: SettlementRecord; session: BattleSession }> {
  const { a, b, nftSeat, tokenId = "91001", owner = OWNER, decks = ["swarm", "antiSwarm"], seed = SEED, drive = true, matchType = "private" } = opts;
  const s = new BattleSession(rng(0, seed));
  s.join({ playerId: a.id, username: a.username ?? "a" });
  s.join({ playerId: b.id, username: b.username ?? "b" });
  const loadouts = [a, b].map((p, i) => {
    const d = preset(decks[i]!);
    return i === nftSeat
      ? makeLoadoutWithGrant(d.cards, nftGrant(tokenId, owner, d.cls))
      : makeLoadoutWithGrant(d.cards, freeGrant(d.cls));
  }) as [TrustedLoadout, TrustedLoadout];
  s.setReady(a.id, loadouts[0]);
  s.setReady(b.id, loadouts[1]);
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout]);
  const pidOf = (seat: PlayerIndex) => (s.seatOf(a.id) === seat ? a.id : b.id);
  let n = 0;
  let end = null;
  while (s.phase === "active" && !end) {
    if (drive) {
      for (const seat of [0, 1] as const) {
        const st = s.state!;
        // Deploy the commander as soon as it cycles into hand; the card
        // sits last in the queue, so matches can end before it appears.
        const snap = st.commanderSnapshots[seat];
        const cmdCard = snap ? commanderCardId(snap.commanderId) : null;
        const alive = st.commanders.some((c) => c.owner === seat && c.hp > 0);
        if (cmdCard && !alive && st.hands[seat].includes(cmdCard) && st.energy[seat] >= COMMANDER_COMBAT_PROFILE_V1[snap!.class].cost) {
          for (const [x, dy] of [[50, 40], [30, 55], [70, 55]] as const) {
            s.submit(pidOf(seat), { type: "deploy", cid: `c${n++}`, cardId: cmdCard, x, y: seat === 0 ? dy : 160 - dy });
          }
        }
        const ab = botAbility(st, seat);
        if (ab) s.submit(pidOf(seat), { type: "ability", cid: `a${n++}`, abilityId: ab });
        else if (st.tick % 10 === 0) {
          const mv = smartMove(st, seat, n);
          if (mv) s.submit(pidOf(seat), { type: "deploy", cid: `d${n++}`, ...mv });
        }
      }
    }
    end = s.tick()!.end;
  }
  const matchId = randomUUID();
  matchIds.push(matchId);
  const record = recordFromReplay(s.replay!, {
    matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType,
    startedAt: new Date(Date.now() - 60_000),
    crowns: [...s.state!.crowns] as [number, number],
  });
  expect(await settleMatch(record, getDb())).toBe("settled");
  return { record, session: s };
}

const eventsFor = async (tokenId: string, matchId?: string) => {
  const rows = await getDb().select().from(nftLegacyEvents).where(eq(nftLegacyEvents.tokenId, tokenId));
  return matchId ? rows.filter((r) => r.matchId === matchId) : rows;
};
const awardsFor = async (tokenId: string) => {
  const db = getDb();
  const [nft] = await db.select({ id: nftTokens.id }).from(nftTokens).where(eq(nftTokens.tokenId, tokenId));
  return nft ? db.select().from(nftAchievementAwards).where(eq(nftAchievementAwards.nftId, nft.id)) : [];
};
const runRow = async (matchId: string) =>
  (await getDb().select().from(matchLegacyRuns).where(eq(matchLegacyRuns.matchId, matchId)))[0];

describe("legacy processor", () => {
  it("deployed NFT commander on the winning seat earns appearance, victory and first achievements", async () => {
    const [a, b] = [await mkPlayer("w1a"), await mkPlayer("w1b")];
    await makeToken("91101");
    // Discover the winner seat first: free and NFT commanders of a class are
    // identical in combat, so the same setup with a free scout replays
    // deterministically.
    const probe = await settleMatch2({ a, b });
    expect(probe.record.outcome).toBe("win");
    const winnerSeat = probe.record.winnerSeat!;
    const { record } = await settleMatch2({ a, b, nftSeat: winnerSeat, tokenId: "91101" });
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res.status).toBe("done");
    const ev = await eventsFor("91101", record.matchId);
    const cats = ev.map((e) => e.category).sort();
    expect(cats).toEqual(["achievement", "achievement", "commander_appearance", "commander_outcome"]);
    expect((ev.find((e) => e.category === "commander_outcome")!.payload as { result: string }).result).toBe("victory");
    // Achievements share the match in payload only; both are earned by one win.
    const codes = (await awardsFor("91101")).map((x) => x.achievementCode).sort();
    expect(codes).toEqual(["first_blood", "first_victory"]);
    const run = await runRow(record.matchId);
    expect(run?.status).toBe("done");
    expect(JSON.stringify(run?.details)).not.toContain(OWNER);
  }, 240_000);

  it("deployed NFT commander on the losing seat earns appearance and defeat, no first_victory", async () => {
    const [a, b] = [await mkPlayer("l1a"), await mkPlayer("l1b")];
    await makeToken("91102");
    const probe = await settleMatch2({ a, b });
    const loserSeat = (probe.record.winnerSeat === 0 ? 1 : 0) as PlayerIndex;
    const { record } = await settleMatch2({ a, b, nftSeat: loserSeat, tokenId: "91102" });
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res.status).toBe("done");
    const ev = await eventsFor("91102", record.matchId);
    expect(ev.filter((e) => e.category === "commander_appearance").length).toBe(1);
    expect((ev.find((e) => e.category === "commander_outcome")!.payload as { result: string }).result).toBe("defeat");
    const codes = (await awardsFor("91102")).map((x) => x.achievementCode).sort();
    expect(codes).toEqual(["first_blood"]);
  }, 240_000);

  it("draw emits appearance only (outcome patched in the stored row; mapping exercised on real settled data)", async () => {
    const [a, b] = [await mkPlayer("dr1a"), await mkPlayer("dr1b")];
    await makeToken("91103");
    const probe = await settleMatch2({ a, b });
    const { record } = await settleMatch2({ a, b, nftSeat: probe.record.winnerSeat! as PlayerIndex, tokenId: "91103" });
    // A natural draw with a deployed commander is not reachable cheaply, so the
    // stored outcome is patched to draw; the processor's event mapping is what
    // is under test here.
    await getDb().update(matches).set({ outcome: "draw", winnerSeat: null }).where(eq(matches.id, record.matchId));
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res.status).toBe("done");
    const ev = await eventsFor("91103", record.matchId);
    expect(ev.filter((e) => e.category === "commander_appearance").length).toBe(1);
    expect(ev.filter((e) => e.category === "commander_outcome").length).toBe(0);
    expect((await awardsFor("91103")).map((x) => x.achievementCode)).toEqual(["first_blood"]);
  }, 240_000);

  it("five distinct matches emit veteran exactly once", async () => {
    const [a, b] = [await mkPlayer("v1a"), await mkPlayer("v1b")];
    await makeToken("91104");
    for (let i = 0; i < 5; i += 1) {
      const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91104", seed: `${i.toString(16).padStart(2, "0")}ff00ff00ff00ff00ff00ff00ff00ff` });
      await new LegacyProcessor().processMatch(record.matchId);
    }
    const codes = (await awardsFor("91104")).map((x) => x.achievementCode);
    expect(codes.filter((c) => c === "veteran").length).toBe(1);
    expect((await eventsFor("91104")).filter((e) => e.category === "achievement").length).toBe(codes.length);
  }, 600_000);

  it("free commanders produce no events and a no-eligible marker", async () => {
    const [a, b] = [await mkPlayer("f1a"), await mkPlayer("f1b")];
    const { record } = await settleMatch2({ a, b });
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res).toEqual({ status: "no-eligible", eventsCreated: 0 });
    expect((await eventsFor("91101", record.matchId)).length).toBe(0);
    expect((await runRow(record.matchId))?.status).toBe("no-eligible");
  }, 240_000);

  it("an undeployed NFT commander earns nothing", async () => {
    const [a, b] = [await mkPlayer("u1a"), await mkPlayer("u1b")];
    await makeToken("91105");
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91105", drive: false });
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res).toEqual({ status: "no-eligible", eventsCreated: 0 });
    expect((await eventsFor("91105")).length).toBe(0);
  }, 240_000);

  it("a match that was never settled (aborted rooms write nothing) cannot be processed", async () => {
    await expect(new LegacyProcessor().processMatch(randomUUID())).rejects.toBeInstanceOf(LegacyVerificationError);
  });

  it("tampered stored evidence refuses processing with no events and no marker", async () => {
    const [a, b] = [await mkPlayer("tm1a"), await mkPlayer("tm1b")];
    await makeToken("91106");
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91106" });
    const [ev] = await getDb().select().from(matchEvidence).where(eq(matchEvidence.matchId, record.matchId));
    const tampered = { ...(ev!.evidence as Record<string, unknown>), formatVersion: 1, commands: [] };
    await getDb().update(matchEvidence).set({ evidence: tampered }).where(eq(matchEvidence.matchId, record.matchId));
    await expect(new LegacyProcessor().processMatch(record.matchId)).rejects.toBeInstanceOf(LegacyVerificationError);
    expect((await eventsFor("91106")).length).toBe(0);
    expect(await runRow(record.matchId)).toBeUndefined();
  }, 240_000);

  it("NFT participant rows without owner provenance or with free basis are skipped", async () => {
    const [a, b] = [await mkPlayer("o1a"), await mkPlayer("o1b")];
    await makeToken("91107");
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91107" });
    const db = getDb();
    const nftRow = (await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, record.matchId))).find((x) => x.commanderKind === "nft")!;
    const where = and(eq(matchParticipants.matchId, record.matchId), eq(matchParticipants.seat, nftRow.seat));
    // Strip the stored owner, then corrupt the basis: each makes the row ineligible.
    await db.update(matchParticipants).set({ entitlementOwner: null }).where(where);
    await db.update(matchParticipants).set({ commanderIdentity: { ...(nftRow.commanderIdentity as object), basis: "free" } }).where(where);
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res).toEqual({ status: "no-eligible", eventsCreated: 0 });
    expect((await eventsFor("91107")).length).toBe(0);
  }, 240_000);

  it("duplicate and concurrent processMatch calls leave exactly one set of rows", async () => {
    const [a, b] = [await mkPlayer("i1a"), await mkPlayer("i1b")];
    await makeToken("91108");
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91108" });
    const proc = new LegacyProcessor();
    await proc.processMatch(record.matchId);
    const before = await eventsFor("91108");
    await proc.processMatch(record.matchId);
    await Promise.all([proc.processMatch(record.matchId), new LegacyProcessor().processMatch(record.matchId)]);
    expect((await eventsFor("91108")).length).toBe(before.length);
    expect((await awardsFor("91108")).length).toBeLessThanOrEqual(3);
    expect((await runRow(record.matchId))?.eventsCreated).toBe(before.length);
  }, 240_000);

  it("a legacy failure after settlement leaves settlement intact and reconcile finishes the job once", async () => {
    const [a, b] = [await mkPlayer("x1a"), await mkPlayer("x1b")];
    await makeToken("91109");
    const s = new BattleSession(rng());
    s.join({ playerId: a.id, username: "a" });
    s.join({ playerId: b.id, username: "b" });
    const d0 = preset("swarm");
    const d1 = preset("antiSwarm");
    s.setReady(a.id, makeLoadoutWithGrant(d0.cards, nftGrant("91109", OWNER, d0.cls)));
    s.setReady(b.id, makeLoadoutWithGrant(d1.cards, freeGrant(d1.cls)));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout]);
    const pidOf = (seat: PlayerIndex) => (s.seatOf(a.id) === seat ? a.id : b.id);
    let n = 0;
    while (s.phase === "active") {
      for (const seat of [0, 1] as const) {
        const st = s.state!;
        const snap = st.commanderSnapshots[seat];
        const cmdCard = snap ? commanderCardId(snap.commanderId) : null;
        const alive = st.commanders.some((c) => c.owner === seat && c.hp > 0);
        if (cmdCard && !alive && st.hands[seat].includes(cmdCard) && st.energy[seat] >= COMMANDER_COMBAT_PROFILE_V1[snap!.class].cost) {
          for (const [x, dy] of [[50, 40], [30, 55], [70, 55]] as const) {
            s.submit(pidOf(seat), { type: "deploy", cid: `c${n++}`, cardId: cmdCard, x, y: seat === 0 ? dy : 160 - dy });
          }
        }
        const ab = botAbility(st, seat);
        if (ab) s.submit(pidOf(seat), { type: "ability", cid: `a${n++}`, abilityId: ab });
        else if (st.tick % 10 === 0) {
          const mv = smartMove(st, seat, n);
          if (mv) s.submit(pidOf(seat), { type: "deploy", cid: `d${n++}`, ...mv });
        }
      }
      s.tick();
    }
    const matchId = randomUUID();
    matchIds.push(matchId);
    const record = recordFromReplay(s.replay!, { matchId, roomId: "r", matchType: "private", startedAt: new Date(), crowns: [...s.state!.crowns] as [number, number] });
    const throwing = { processMatch: async () => { throw new Error("legacy down"); }, reconcile: async () => {} } as unknown as LegacyProcessor;
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {}, legacy: throwing });
    expect(await svc.submit(record)).toBe("settled");
    expect((await getDb().select().from(matches).where(eq(matches.id, matchId))).length).toBe(1);
    expect(await runRow(matchId)).toBeUndefined();
    // Reconcile as a new processor (simulated restart) creates the events once.
    const proc = new LegacyProcessor();
    await proc.reconcile(50, [matchId]);
    await proc.reconcile(50, [matchId]);
    const ev = await eventsFor("91109");
    expect(ev.length).toBeGreaterThan(0);
    expect((await runRow(matchId))?.status).toBe("done");
    const n1 = ev.length;
    await proc.reconcile(50, [matchId]);
    expect((await eventsFor("91109")).length).toBe(n1);
  }, 240_000);

  it("processing never mutates the match, participants or commander rows", async () => {
    const [a, b] = [await mkPlayer("im1a"), await mkPlayer("im1b")];
    await makeToken("91110");
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91110" });
    const db = getDb();
    const before = {
      match: await db.select().from(matches).where(eq(matches.id, record.matchId)),
      parts: await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, record.matchId)),
      cmdr: await db.select().from(commanders).where(eq(commanders.tokenId, "91110")),
    };
    await new LegacyProcessor().processMatch(record.matchId);
    expect(await db.select().from(matches).where(eq(matches.id, record.matchId))).toEqual(before.match);
    expect(await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, record.matchId))).toEqual(before.parts);
    expect(await db.select().from(commanders).where(eq(commanders.tokenId, "91110"))).toEqual(before.cmdr);
  }, 240_000);

  it("legacy read APIs expose events and awards without seeds, commands or wallets", async () => {
    const [a, b] = [await mkPlayer("pr1a"), await mkPlayer("pr1b")];
    await makeToken("91111");
    const probe = await settleMatch2({ a, b });
    const { record } = await settleMatch2({ a, b, nftSeat: probe.record.winnerSeat! as PlayerIndex, tokenId: "91111" });
    await new LegacyProcessor().processMatch(record.matchId);
    const res = await legacyGet(new Request("http://x/api/nfts/91111/legacy"), { params: Promise.resolve({ tokenId: "91111" }) });
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("commander_appearance");
    expect(body).not.toContain(SEED);
    expect(body).not.toContain(OWNER);
    expect(body).not.toContain("commands");
    const ach = await achievementsGet(new Request("http://x/api/nfts/91111/achievements"), { params: Promise.resolve({ tokenId: "91111" }) });
    expect(ach.status).toBe(200);
    const achBody = await ach.json();
    expect(JSON.stringify(achBody)).toContain("first_victory");
  }, 240_000);

  it("an NFT match whose token is not indexed is skipped as unknown-token, marker written, no events", async () => {
    const [a, b] = [await mkPlayer("ut1a"), await mkPlayer("ut1b")];
    // Deliberately no makeToken: the deployed commander is a real settled NFT
    // participant, but nft_tokens has no row for it on TEST.
    const { record } = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91201" });
    const res = await new LegacyProcessor().processMatch(record.matchId);
    expect(res).toEqual({ status: "no-eligible", eventsCreated: 0 });
    const run = await runRow(record.matchId);
    expect(run?.status).toBe("no-eligible");
    expect(JSON.stringify(run?.details)).toContain("unknown-token");
    expect((await eventsFor("91201")).length).toBe(0);
  }, 240_000);

  it("reconcile skips a refused match for the process lifetime and still reaches newer matches", async () => {
    const [a, b] = [await mkPlayer("rc1a"), await mkPlayer("rc1b")];
    await makeToken("91202");
    const older = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91202" });
    const newer = await settleMatch2({ a, b, nftSeat: 0, tokenId: "91202", seed: "aa00ff00aa00ff00aa00ff00aa00ff00" });
    // Corrupt the older match's stored evidence so re-verification refuses it.
    const [ev] = await getDb().select().from(matchEvidence).where(eq(matchEvidence.matchId, older.record.matchId));
    await getDb()
      .update(matchEvidence)
      .set({ evidence: { ...(ev!.evidence as Record<string, unknown>), commands: [] } })
      .where(eq(matchEvidence.matchId, older.record.matchId));
    const proc = new LegacyProcessor();
    const scope = [older.record.matchId, newer.record.matchId];
    // limit=1 takes the oldest first: the tampered match refuses, no marker.
    await proc.reconcile(1, scope);
    expect(await runRow(older.record.matchId)).toBeUndefined();
    expect(await runRow(newer.record.matchId)).toBeUndefined();
    // The refused id is excluded for this process, so the next pass reaches
    // the newer valid match under the same limit.
    await proc.reconcile(1, scope);
    expect((await runRow(newer.record.matchId))?.status).toBe("done");
    expect((await eventsFor("91202", newer.record.matchId)).length).toBeGreaterThan(0);
    expect(await runRow(older.record.matchId)).toBeUndefined();
  }, 240_000);

  it("patron appearances are never emitted and paragon is never awarded", async () => {
    const all = await getDb().select().from(nftLegacyEvents).where(eq(nftLegacyEvents.category, "patron_appearance"));
    expect(all.length).toBe(0);
    const paragon = await getDb().select().from(nftAchievementAwards).where(eq(nftAchievementAwards.achievementCode, "paragon"));
    expect(paragon.length).toBe(0);
  });
});
