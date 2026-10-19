import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchEvidence, matchParticipants, matches, players, type Player } from "@/db/schema";
import { runMatch } from "@/lib/combat";
import { BATTLE_PROTOCOL_VERSION } from "@/lib/battle-protocol";
import { BattleSession, PRESETS, type SessionRandom, type TrustedLoadout } from "@/server/battle/session";
import { makeLoadout, makeLoadoutWithGrant, nftGrant } from "@/server/battle/test-helpers";
import {
  SettlementService,
  recordFromReplay,
  settleMatch,
  verifySettlement,
  SettlementConflictError,
  type SettlementRecord,
} from "@/server/battle/settlement";
import type { CommanderClass } from "@/lib/commanders";

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(() => {
  routeDalToTestDb();
});

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];
const dirs: string[] = [];
const mkPlayer = async (name: string): Promise<Player> => {
  const p = await provisionPlayer({ privyDid: `did:privy:settle_${name}_${randomUUID().slice(0, 8)}` });
  createdPlayerIds.push(p.id);
  return p;
};
const tmpDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "settle-"));
  dirs.push(d);
  return d;
};

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) await db.delete(players).where(inArray(players.id, createdPlayerIds));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
});

const SEED = "c0ffee00c0ffee00c0ffee00c0ffee00";
const rng = (seatFlip = 0, seed = SEED): SessionRandom => ({ seed: () => seed, int: (n) => (n === 2 ? seatFlip : 0) });
const preset = (name: string) => makeLoadout([...PRESETS[name]!.cards], PRESETS[name]!.commanderClass as CommanderClass);

/** Runs a real finished session and returns its SettlementRecord. */
function finishedRecord(a: Player, b: Player, matchType: "private" | "matchmaking" = "private", seed = SEED): SettlementRecord {
  const s = new BattleSession(rng(0, seed));
  s.join({ playerId: a.id, username: a.username ?? "a" });
  s.join({ playerId: b.id, username: b.username ?? "b" });
  s.setReady(a.id, preset("swarm"));
  s.setReady(b.id, preset("siege"));
  const epoch = s.lock();
  s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout]);
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
  return rec;
}

const counts = async (matchId: string) => {
  const db = getDb();
  return {
    match: (await db.select().from(matches).where(eq(matches.id, matchId))).length,
    parts: (await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId))).length,
    ev: (await db.select().from(matchEvidence).where(eq(matchEvidence.matchId, matchId))).length,
  };
};

describe("settlement service", () => {
  it("settles a verified match: one match row, two participants, one evidence", async () => {
    const [a, b] = [await mkPlayer("s1a"), await mkPlayer("s1b")];
    const rec = finishedRecord(a, b);
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(rec)).toBe("settled");
    const c = await counts(rec.matchId);
    expect(c).toEqual({ match: 1, parts: 2, ev: 1 });
    const [m] = await getDb().select().from(matches).where(eq(matches.id, rec.matchId));
    expect(m!.verification).toBe("replay-verified");
    expect(m!.matchType).toBe("private");
    expect(m!.protocolVersion).toBe(BATTLE_PROTOCOL_VERSION);
    const parts = await getDb().select().from(matchParticipants).where(eq(matchParticipants.matchId, rec.matchId));
    expect(new Set(parts.map((p) => p.playerId))).toEqual(new Set([a.id, b.id]));
    const [ev] = await getDb().select().from(matchEvidence).where(eq(matchEvidence.matchId, rec.matchId));
    const stored = ev!.evidence as SettlementRecord["evidence"];
    const replay = runMatch(stored.config, stored.commands);
    expect(replay.result.stateHash).toBe(m!.liveHash);
    expect(replay.result.winner).toBe(rec.winnerSeat ?? "draw");
    expect(replay.result.crowns).toEqual(rec.crowns);
    // No NFT legacy or achievement writes for this result.
    const db = getDb();
    expect((await db.execute(sql`select count(*)::int as n from nft_legacy_events where match_id = ${rec.matchId}`)).rows[0]!.n).toBe(0);
    expect((await db.execute(sql`select count(*)::int as n from nft_achievement_awards where evidence::text like ${"%" + rec.matchId + "%"}`)).rows[0]!.n).toBe(0);
  }, 120_000);

  it("refuses tampered evidence and writes nothing", async () => {
    const [a, b] = [await mkPlayer("t1a"), await mkPlayer("t1b")];
    const rec = finishedRecord(a, b);
    const tampered: SettlementRecord = {
      ...rec,
      evidence: { ...rec.evidence, config: { ...rec.evidence.config, seed: "deadbeefdeadbeefdeadbeefdeadbeef" } },
    };
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(tampered)).toBe("refused");
    expect((await counts(rec.matchId)).match).toBe(0);
    // Tampering the hash alone is also refused.
    expect(await svc.submit({ ...rec, replayHash: rec.liveHash.slice(0, -1) + "0" })).toBe("refused");
    expect((await counts(rec.matchId)).match).toBe(0);
  }, 120_000);

  it("verifySettlement enforces per-seat commander kind/token/basis/owner provenance", async () => {
    const [a, b] = [await mkPlayer("pv1a"), await mkPlayer("pv1b")];
    const s = new BattleSession(rng());
    s.join({ playerId: a.id, username: "a" });
    s.join({ playerId: b.id, username: "b" });
    const d = preset("swarm");
    s.setReady(a.id, makeLoadoutWithGrant(d.cards, nftGrant("91199", "0x" + "ab".repeat(20), "scout")));
    s.setReady(b.id, preset("siege"));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout]);
    while (s.phase === "active") s.tick();
    const matchId = randomUUID();
    matchIds.push(matchId);
    const rec = recordFromReplay(s.replay!, { matchId, roomId: "r", matchType: "private", startedAt: new Date(), crowns: [...s.state!.crowns] as [number, number] });
    expect(() => verifySettlement(rec)).not.toThrow();
    // NFT seat must keep a non-null owner.
    expect(() => verifySettlement({ ...rec, owners: [null, rec.owners[1]] })).toThrow(/provenance/);
    // NFT seat identity must keep direct-owner basis and verifiedAt.
    expect(() => verifySettlement({ ...rec, commanders: [{ ...rec.commanders[0], basis: "free" }, rec.commanders[1]] })).toThrow();
    expect(() => verifySettlement({ ...rec, commanders: [{ ...rec.commanders[0], verifiedAt: null }, rec.commanders[1]] })).toThrow();
    // NFT token id must match the evidence slot.
    expect(() => verifySettlement({ ...rec, commanders: [{ ...rec.commanders[0], tokenId: "99999" }, rec.commanders[1]] })).toThrow();
    // Free seat must keep a null owner.
    expect(() => verifySettlement({ ...rec, owners: [rec.owners[0], "0x" + "cd".repeat(20)] })).toThrow();
  }, 240_000);

  it("refuses a record with the same player on both seats", async () => {
    const [a, b] = [await mkPlayer("d1a"), await mkPlayer("d1b")];
    const rec = finishedRecord(a, b);
    const bad: SettlementRecord = { ...rec, players: [rec.players[0], rec.players[0]] };
    expect(() => verifySettlement(bad)).toThrow();
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(bad)).toBe("refused");
    expect((await counts(rec.matchId)).match).toBe(0);
  }, 120_000);

  it("duplicate settle is idempotent and concurrent settles leave exactly one row", async () => {
    const [a, b] = [await mkPlayer("i1a"), await mkPlayer("i1b")];
    const rec = finishedRecord(a, b);
    const dir = tmpDir();
    const svc = new SettlementService({ dir, retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(rec)).toBe("settled");
    expect(await svc.submit(rec)).toBe("already-settled");
    expect((await counts(rec.matchId)).match).toBe(1);
    // Two services racing the same record: exactly one insert wins.
    const rec2 = finishedRecord(a, b);
    const [r1, r2] = await Promise.all([
      new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} }).submit(rec2),
      new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} }).submit(rec2),
    ]);
    expect([r1, r2].sort()).toEqual(["already-settled", "settled"]);
    expect((await counts(rec2.matchId)).match).toBe(1);
  }, 240_000);

  it("conflicting evidence under a settled match id is rejected and never overwrites", async () => {
    const [a, b] = [await mkPlayer("c1a"), await mkPlayer("c1b")];
    const rec = finishedRecord(a, b);
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(rec)).toBe("settled");
    const other = finishedRecord(a, b, "private", "00ff00ff00ff00ff00ff00ff00ff00ff");
    const hijack: SettlementRecord = { ...other, matchId: rec.matchId }; // different evidence, same id
    expect(await svc.submit(hijack)).toBe("conflict");
    expect(existsSync(path.join(svc.dir, "failed", `${rec.matchId}.json`))).toBe(true);
    const [m] = await getDb().select().from(matches).where(eq(matches.id, rec.matchId));
    expect(m!.evidenceSha256).toBe(rec.evidenceSha256);
    matchIds.push(other.matchId); // never inserted, but tracked harmlessly
  }, 240_000);

  it("retries transient failures, then settles", async () => {
    const [a, b] = [await mkPlayer("r1a"), await mkPlayer("r1b")];
    const rec = finishedRecord(a, b);
    const real = getDb();
    let fails = 2;
    const flaky = new Proxy(real, {
      get(target, prop) {
        if (prop === "batch") {
          return async (qs: unknown) => {
            if (fails-- > 0) throw new Error("socket hangup");
            return (target.batch as (q: unknown) => Promise<unknown>).call(target, qs);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    const svc = new SettlementService({ dir: tmpDir(), retryDelaysMs: [0, 0, 0], sleep: async () => {}, db: () => flaky });
    expect(await svc.submit(rec)).toBe("settled");
    expect((await counts(rec.matchId)).match).toBe(1);
  }, 120_000);

  it("exhausted retries leave the record pending; a restarted service sweeps it in", async () => {
    const [a, b] = [await mkPlayer("p1a"), await mkPlayer("p1b")];
    const rec = finishedRecord(a, b);
    const dir = tmpDir();
    const dead = new Proxy(getDb(), {
      get(target, prop) {
        if (prop === "batch") return async () => Promise.reject(new Error("connection refused"));
        return Reflect.get(target, prop);
      },
    });
    const svc = new SettlementService({ dir, retryDelaysMs: [0], sleep: async () => {}, db: () => dead });
    expect(await svc.submit(rec)).toBe("pending");
    expect(existsSync(path.join(dir, "pending", `${rec.matchId}.json`))).toBe(true);
    expect((await counts(rec.matchId)).match).toBe(0);
    // Simulate a battle-server restart: new service, same outbox dir.
    const revived = new SettlementService({ dir, retryDelaysMs: [], sleep: async () => {} });
    await revived.sweep();
    expect((await counts(rec.matchId)).match).toBe(1);
    expect(existsSync(path.join(dir, "pending", `${rec.matchId}.json`))).toBe(false);
  }, 120_000);

  it("permanent failures (unknown player FK) move to failed/ and write nothing", async () => {
    const [a, b] = [await mkPlayer("f1a"), await mkPlayer("f1b")];
    const rec = finishedRecord(a, b);
    const ghost: SettlementRecord = { ...rec, players: [{ playerId: randomUUID(), username: "ghost" }, rec.players[1]] };
    const dir = tmpDir();
    const svc = new SettlementService({ dir, retryDelaysMs: [], sleep: async () => {} });
    expect(await svc.submit(ghost)).toBe("failed");
    expect(existsSync(path.join(dir, "failed", `${ghost.matchId}.json`))).toBe(true);
    expect((await counts(ghost.matchId)).match).toBe(0);
  }, 120_000);

  it("settleMatch throws a conflict error for divergent evidence", async () => {
    const [a, b] = [await mkPlayer("k1a"), await mkPlayer("k1b")];
    const rec = finishedRecord(a, b);
    expect(await settleMatch(rec, getDb())).toBe("settled");
    const other = finishedRecord(a, b, "private", "00ff00ff00ff00ff00ff00ff00ff00ff");
    await expect(settleMatch({ ...other, matchId: rec.matchId }, getDb())).rejects.toBeInstanceOf(SettlementConflictError);
    matchIds.push(other.matchId);
  }, 240_000);
});
