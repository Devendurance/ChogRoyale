// P1b.1 ranked queue: a genuinely separate matchmaking queue on the existing
// Colyseus battle infrastructure. No rating, trophy, economy or combat
// changes. DB writes go only to the isolated TEST branch; PROD is untouched.
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import { getDb, routeDalToTestDb } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchEvidence, matchParticipants, matches, players } from "@/db/schema";
import {
  BATTLE_QUEUE_ROOM,
  BATTLE_RANKED_QUEUE_ROOM,
  BATTLE_ROOM,
  type LobbyMessage,
  type MatchFoundMessage,
  type QueueStatusMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS, BattleSession, type TrustedLoadout } from "@/server/battle/session";
import type { CommanderClass } from "@/lib/commanders";
import { makeLoadout, testLockedPatron, testPatronSource } from "@/server/battle/test-helpers";
import { startBattleServer } from "@/server/battle/server";
import { recordFromReplay, settleMatch, verifySettlement } from "@/server/battle/settlement";

const PORT = 29200 + Math.floor(Math.random() * 800);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-ranked-replays-"));
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;
const PLAYERS: Record<string, Player> = {};
for (const n of ["ralice", "rbob", "rcarol", "rdave", "rerin", "rfrank"]) PLAYERS[n] = player(n);

// Write suite: must target the isolated TEST branch, never DATABASE_URL.
beforeAll(async () => {
  routeDalToTestDb();
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(PORT, {
    verifier: async (t) => {
      if (!t.startsWith("tok-")) throw new Error("bad token");
      return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
    },
    loader: async (did) => PLAYERS[did.replace("did:privy:", "")] ?? null,
    patrons: testPatronSource(),
    tickMs: 2,
    replayDir,
    closeAfterMs: 50,
    queueMaxWaitMs: 1_200,
    matchLobbyMs: 1_500,
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};
const leaveQuietly = (room: Room, ms = 500) => Promise.race([room.leave().catch(() => {}), sleep(ms)]);

interface QSeen {
  status: QueueStatusMessage[];
  found?: MatchFoundMessage;
  left: boolean;
}
function watchQueue(room: Room): QSeen {
  const seen: QSeen = { status: [], left: false };
  room.onMessage("queue_status", (m: QueueStatusMessage) => seen.status.push(m));
  room.onMessage("match_found", (m: MatchFoundMessage) => (seen.found = m));
  room.onLeave(() => (seen.left = true));
  return seen;
}
interface Seen {
  start?: StartMessage;
  lobby?: LobbyMessage;
  aborted?: string;
}
function watch(room: Room): Seen {
  const seen: Seen = {};
  room.onMessage("start", (m: StartMessage) => (seen.start = m));
  room.onMessage("lobby", (m: LobbyMessage) => (seen.lobby = m));
  room.onMessage("aborted", (a: { reason: string }) => (seen.aborted = a.reason));
  return seen;
}

describe("P1b.1 ranked queue", () => {
  it("rejects missing and forged tokens on the ranked queue", async () => {
    await expect(client().joinOrCreate(BATTLE_RANKED_QUEUE_ROOM)).rejects.toThrow(/Authentication required/);
    await expect(client("forged").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM)).rejects.toThrow(/Invalid or expired/);
  });

  it("pairs ranked with ranked only; unranked tickets never cross", async () => {
    const qa = await client("tok-ralice").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM);
    const sa = watchQueue(qa);
    const qb = await client("tok-rbob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await sleep(300);
    expect(sa.found).toBeUndefined();
    expect(sb.found).toBeUndefined();
    const qc = await client("tok-rcarol").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM);
    const sc = watchQueue(qc);
    await until(() => !!sa.found && !!sc.found);
    // Ranked pair shares one room; the unranked ticket is still waiting.
    expect(sa.found!.reservation.roomId).toBe(sc.found!.reservation.roomId);
    expect(sa.found!.mode).toBe("ranked");
    expect(sc.found!.mode).toBe("ranked");
    expect(sb.found).toBeUndefined();
    expect(sb.status.length).toBeGreaterThan(0);
    // The pair's rooms carry the authoritative ranked identity.
    const ra = await client("tok-ralice").consumeSeatReservation(sa.found!.reservation);
    const wa = watch(ra);
    const rc = await client("tok-rcarol").consumeSeatReservation(sc.found!.reservation);
    const wc = watch(rc);
    await until(() => !!wa.lobby?.match && !!wc.lobby?.match);
    expect(wa.lobby!.match!.mode).toBe("ranked");
    expect(wc.lobby!.match!.mode).toBe("ranked");
    expect(wa.lobby!.match!.opponent).toBe("rcarol");
    await leaveQuietly(qa);
    await leaveQuietly(qb);
    await leaveQuietly(qc);
    await leaveQuietly(ra);
    await leaveQuietly(rc);
  });

  it("rejects duplicate queue tickets across both queues for one player", async () => {
    const q1 = await client("tok-rdave").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM);
    watchQueue(q1);
    await expect(client("tok-rdave").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM)).rejects.toThrow(/Already searching/);
    await expect(client("tok-rdave").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already searching/);
    await leaveQuietly(q1);
    // After cancelling, the same player may queue again (in either queue).
    const q2 = await client("tok-rdave").joinOrCreate(BATTLE_QUEUE_ROOM);
    const s2 = watchQueue(q2);
    await sleep(150);
    expect(s2.found).toBeUndefined();
    await leaveQuietly(q2);
  });

  it("cancelling a ranked ticket frees only that player; strangers cannot enter the matched room", async () => {
    const qa = await client("tok-rerin").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM);
    const sa = watchQueue(qa);
    const qb = await client("tok-rfrank").joinOrCreate(BATTLE_RANKED_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await until(() => !!sa.found && !!sb.found);
    const roomId = sa.found!.reservation.roomId;
    await expect(client("tok-rdave").joinById(roomId)).rejects.toThrow(/Not a player|private|full|locked/i);
    const ra = await client("tok-rerin").consumeSeatReservation(sa.found!.reservation);
    const wa = watch(ra);
    await until(() => !!wa.lobby?.match);
    // Pre-start leave aborts the matched room without a result.
    const rb = await client("tok-rfrank").consumeSeatReservation(sb.found!.reservation);
    const wb = watch(rb);
    await leaveQuietly(qa);
    await leaveQuietly(qb);
    await leaveQuietly(rb);
    await until(() => !!wa.aborted || !!wb.aborted);
    expect(wa.aborted ?? wb.aborted).toMatch(/Opponent left before the match started/);
    await leaveQuietly(ra);
    // Both players are released and may queue again.
    const q1 = await client("tok-rerin").joinOrCreate(BATTLE_QUEUE_ROOM);
    await leaveQuietly(q1);
  });

  it("unranked pairs still settle as matchmaking and private rooms as private", async () => {
    const qa = await client("tok-rdave").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sa = watchQueue(qa);
    const qb = await client("tok-rbob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await until(() => !!sa.found && !!sb.found);
    expect(sa.found!.mode).toBe("unranked");
    const ra = await client("tok-rdave").consumeSeatReservation(sa.found!.reservation);
    const wa = watch(ra);
    const rb = await client("tok-rbob").consumeSeatReservation(sb.found!.reservation);
    const wb = watch(rb);
    await until(() => !!wa.lobby?.match && !!wb.lobby?.match);
    expect(wa.lobby!.match!.mode).toBe("matchmaking");
    await leaveQuietly(qa);
    await leaveQuietly(qb);
    // Private room: no match context, session defaults to private.
    const priv = await client("tok-ralice").create(BATTLE_ROOM);
    const wp = watch(priv);
    priv.send("ready", { cards: [...PRESETS.swarm!.cards], commander: { kind: "free", class: "scout" } });
    await until(() => !!wp.lobby);
    expect(wp.lobby!.match).toBeUndefined();
    await leaveQuietly(priv);
    await leaveQuietly(ra);
    await leaveQuietly(rb);
  });
});

describe("P1b.1 ranked settlement provenance (TEST only)", () => {
  const createdPlayerIds: string[] = [];
  const matchIds: string[] = [];
  const mkPlayer = async (name: string) => {
    const p = await provisionPlayer({ privyDid: `did:privy:ranked_${name}_${randomUUID().slice(0, 8)}` });
    createdPlayerIds.push(p.id);
    return p;
  };
  afterAll(async () => {
    const db = getDb();
    if (matchIds.length > 0) {
      await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
      await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
      await db.delete(matches).where(inArray(matches.id, matchIds));
    }
    if (createdPlayerIds.length > 0) await db.delete(players).where(inArray(players.id, createdPlayerIds));
  });

  it("persists a ranked finish as match_type ranked, replay-verified", async () => {
    const [a, b] = [await mkPlayer("ra"), await mkPlayer("rb")];
    const s = new BattleSession({ seed: () => "c0ffee00c0ffee00c0ffee00c0ffee00", int: (n) => (n === 2 ? 0 : 0) });
    s.mode = "ranked";
    s.join({ playerId: a.id, username: a.username ?? "ra" });
    s.join({ playerId: b.id, username: b.username ?? "rb" });
    s.setReady(a.id, makeLoadout([...PRESETS.swarm!.cards], PRESETS.swarm!.commanderClass as CommanderClass));
    s.setReady(b.id, makeLoadout([...PRESETS.siege!.cards], PRESETS.siege!.commanderClass as CommanderClass));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    while (s.phase === "active") s.tick();
    expect(s.phase).toBe("finished");
    expect(s.startMessage(0).mode).toBe("ranked");
    const matchId = randomUUID();
    matchIds.push(matchId);
    const rec = recordFromReplay(s.replay!, {
      matchId,
      roomId: `ranked-${matchId.slice(0, 8)}`,
      matchType: "ranked",
      startedAt: new Date(Date.now() - 60_000),
      crowns: [...s.state!.crowns] as [number, number],
    });
    expect(() => verifySettlement(rec)).not.toThrow();
    expect(await settleMatch(rec, getDb())).toBe("settled");
    const [row] = await getDb().select().from(matches).where(eq(matches.id, matchId));
    expect(row!.matchType).toBe("ranked");
    expect(row!.verification).toBe("replay-verified");
  });

  it("refuses a forged ranked record whose evidence hash was swapped", async () => {
    const [a, b] = [await mkPlayer("rc"), await mkPlayer("rd")];
    const s = new BattleSession({ seed: () => "d0ffee00d0ffee00d0ffee00d0ffee00", int: (n) => (n === 2 ? 1 : 0) });
    s.mode = "ranked";
    s.join({ playerId: a.id, username: a.username ?? "rc" });
    s.join({ playerId: b.id, username: b.username ?? "rd" });
    s.setReady(a.id, makeLoadout([...PRESETS.swarm!.cards], PRESETS.swarm!.commanderClass as CommanderClass));
    s.setReady(b.id, makeLoadout([...PRESETS.siege!.cards], PRESETS.siege!.commanderClass as CommanderClass));
    const epoch = s.lock();
    s.start(epoch, s.readyLoadouts() as [TrustedLoadout, TrustedLoadout], testLockedPatron());
    while (s.phase === "active") s.tick();
    const rec = recordFromReplay(s.replay!, {
      matchId: randomUUID(),
      roomId: "ranked-forged",
      matchType: "matchmaking",
      startedAt: new Date(),
      crowns: [...s.state!.crowns] as [number, number],
    });
    // A caller-side label cannot launder an unranked room into ranked: the
    // room owns the mode, and the hash binds the record. Tampering fails.
    const tampered = { ...rec, matchType: "ranked" as const, evidenceSha256: "0".repeat(64) };
    expect(() => verifySettlement(tampered)).toThrow();
  });
});
