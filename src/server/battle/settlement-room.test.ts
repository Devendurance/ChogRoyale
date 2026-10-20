// B3.3a room-to-DB settlement integration over real Colyseus WS. Players
// are real TEST-branch rows (participants FK is RESTRICT); the settlement
// service writes to TEST through the shared DAL. Auth/entitlement stay
// injected; nothing here touches PROD or the chain.
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { and, eq, inArray } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { saveLoadout } from "@/db/loadouts";
import { matchEvidence, matchParticipants, matches, players, type Player } from "@/db/schema";
import {
  BATTLE_QUEUE_ROOM,
  BATTLE_ROOM,
  type CommanderChoice,
  type EndMessage,
  type MatchFoundMessage,
  type SettlementMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import { SettlementService } from "@/server/battle/settlement";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 30000 + Math.floor(Math.random() * 900);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-settle-replays-"));
const settleDir = mkdtempSync(path.join(os.tmpdir(), "chog-settle-outbox-"));
let server: Server;
let service: SettlementService;

const createdPlayerIds: string[] = [];
const PLAYERS: Record<string, Player> = {};
const onboarded = async (name: string): Promise<Player> => {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
};

// Free commanders only: no verified wallets, so NFT claims fail closed.
const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => { throw new Error("unreachable in this suite"); },
  loadNftCommander: async () => { throw new Error("unreachable in this suite"); },
  timeoutMs: 60,
};

beforeAll(async () => {
  routeDalToTestDb();
  for (const n of ["sa", "sb", "sc", "sd", "se", "sf", "sg", "sh", "si", "sj"]) PLAYERS[n] = await onboarded(`settle_${n}_${randomUUID().slice(0, 4)}`);
  service = new SettlementService({ dir: settleDir, retryDelaysMs: [0, 0, 0], sleep: async () => {} });
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(PORT, {
    verifier: async (t) => {
      if (!t.startsWith("tok-")) throw new Error("bad token");
      return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
    },
    loader: async (did) => PLAYERS[did.replace("did:privy:", "")] ?? null,
    entitlement,
    patrons: testPatronSource(),
    tickMs: 2,
    replayDir,
    closeAfterMs: 50,
    matchLobbyMs: 5_000,
    reconnectGraceMs: 400,
    settlement: service,
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
  service.stopSweeper();
  const db = getDb();
  const pids = createdPlayerIds;
  if (pids.length > 0) {
    const mids = (await db.select({ id: matchParticipants.matchId }).from(matchParticipants).where(inArray(matchParticipants.playerId, pids))).map((r) => r.id);
    if (mids.length > 0) {
      await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, mids));
      await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, mids));
      await db.delete(matches).where(inArray(matches.id, mids));
    }
    await db.delete(players).where(inArray(players.id, pids));
  }
  rmSync(settleDir, { recursive: true, force: true });
  rmSync(replayDir, { recursive: true, force: true });
  resetDbCache();
});

const client = (name: string) => new Client(URL_, { headers: { authorization: `Bearer tok-${name}` } });
const ready = (preset: string, commander: CommanderChoice = { kind: "free", class: "scout" }) => ({ cards: [...PRESETS[preset]!.cards], commander });

interface Seen {
  start?: StartMessage;
  end?: EndMessage;
  settlement?: SettlementMessage;
  aborted?: string;
}
function watch(room: Room): Seen {
  const seen: Seen = {};
  room.onMessage("start", (m: StartMessage) => (seen.start = m));
  room.onMessage("end", (e: EndMessage) => (seen.end = e));
  room.onMessage("settlement", (m: SettlementMessage) => (seen.settlement = m));
  room.onMessage("aborted", (a: { reason: string }) => (seen.aborted = a.reason));
  return seen;
}
const until = async (cond: () => boolean, ms = 30_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rowsFor = async (playerId: string) => getDb().select().from(matchParticipants).where(eq(matchParticipants.playerId, playerId));

async function privatePair(na: string, nb: string) {
  const ra = await client(na).create(BATTLE_ROOM);
  const rb = await client(nb).joinById(ra.roomId);
  const a = watch(ra);
  const b = watch(rb);
  ra.send("ready", ready("swarm"));
  rb.send("ready", ready("siege"));
  await until(() => !!a.start && !!b.start);
  return { ra, rb, a, b };
}

describe("B3.3a room settlement", () => {
  it("settles a finished private match with match_type private", async () => {
    const { ra, rb, a, b } = await privatePair("sa", "sb");
    await until(() => !!a.end && !!b.end, 60_000);
    expect(a.end!.matchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.end!.matchId).toBe(b.end!.matchId);
    await until(() => !!a.settlement && !!b.settlement, 60_000);
    expect(a.settlement!.status).toBe("settled");
    expect(b.settlement!.status).toBe("settled");
    const [m] = await getDb().select().from(matches).where(eq(matches.id, a.end!.matchId!));
    expect(m.matchType).toBe("private");
    expect(m.verification).toBe("replay-verified");
    const parts = await getDb().select().from(matchParticipants).where(eq(matchParticipants.matchId, m.id));
    expect(parts).toHaveLength(2);
    expect(new Set(parts.map((p) => p.playerId))).toEqual(new Set([PLAYERS.sa!.id, PLAYERS.sb!.id]));
    for (const p of parts) expect(p.deck).toHaveLength(8);
    // The settled participant snapshot is immutable history: saving a
    // different account loadout afterwards must not change it.
    const before = parts.find((p) => p.playerId === PLAYERS.sa!.id)!;
    await saveLoadout(PLAYERS.sa!.id, { cards: [...PRESETS.antiSwarm!.cards], commander: { kind: "free", class: "warden" } }, null);
    const [after] = await getDb()
      .select()
      .from(matchParticipants)
      .where(and(eq(matchParticipants.matchId, m.id), eq(matchParticipants.playerId, PLAYERS.sa!.id)));
    expect(after!.deck).toEqual(before.deck);
    expect(after!.commanderIdentity).toEqual(before.commanderIdentity);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 90_000);

  it("settles a finished matchmaking match with match_type matchmaking", async () => {
    const found = async (name: string) => {
      const c = client(name);
      const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
      const seen: { m?: MatchFoundMessage } = {};
      q.onMessage("match_found", (m: MatchFoundMessage) => (seen.m = m));
      await until(() => !!seen.m);
      const room = await c.consumeSeatReservation(seen.m!.reservation);
      return { room, seen: watch(room) };
    };
    const [a, b] = await Promise.all([found("sc"), found("sd")]);
    a.room.send("ready", ready("swarm"));
    b.room.send("ready", ready("antiSwarm"));
    await until(() => !!a.seen.start && !!b.seen.start);
    await until(() => !!a.seen.settlement && !!b.seen.settlement, 60_000);
    expect(a.seen.settlement!.status).toBe("settled");
    const [m] = await getDb().select().from(matches).where(eq(matches.id, a.seen.end!.matchId!));
    expect(m.matchType).toBe("matchmaking");
    await Promise.all([a.room.leave().catch(() => {}), b.room.leave().catch(() => {})]);
  }, 90_000);

  it("writes nothing for a consented-leave abort", async () => {
    const { ra, rb, a, b } = await privatePair("se", "sf");
    await until(() => a.start && b.start ? true : false);
    await sleep(20);
    await ra.leave(); // consented -> immediate abort, no result
    await until(() => !!b.aborted);
    await sleep(50);
    expect(a.settlement).toBeUndefined();
    expect(b.settlement).toBeUndefined();
    expect(await rowsFor(PLAYERS.se!.id)).toHaveLength(0);
    expect(await rowsFor(PLAYERS.sf!.id)).toHaveLength(0);
    await rb.leave().catch(() => {});
  }, 60_000);

  it("writes nothing when the reconnect grace expires", async () => {
    const { ra, rb, a, b } = await privatePair("sg", "sh");
    void ra.leave(false); // unconsented drop
    await until(() => !!b.aborted, 30_000);
    expect(b.aborted).toMatch(/did not reconnect/);
    await sleep(50);
    expect(a.settlement).toBeUndefined();
    expect(await rowsFor(PLAYERS.sg!.id)).toHaveLength(0);
    expect(await rowsFor(PLAYERS.sh!.id)).toHaveLength(0);
    await rb.leave().catch(() => {});
  }, 60_000);

  it("a drop-and-resume mid-match still settles exactly once", async () => {
    const { ra, rb, a, b } = await privatePair("si", "sj");
    void ra.leave(false);
    // The drop needs a beat to unlock the room; retry only transient matchmaker rejections.
    let resumed: Room | null = null;
    for (let i = 0; i < 20 && !resumed; i += 1) {
      try {
        resumed = await client("si").joinById(ra.roomId, { resume: a.start!.resumeToken });
      } catch (e) {
        if (!/locked|full|not found|seat/i.test(e instanceof Error ? e.message : String(e))) throw e;
        await sleep(25);
      }
    }
    expect(resumed).not.toBeNull();
    const a2 = watch(resumed!);
    await until(() => !!a2.start && a2.start.resumed);
    await until(() => !!a2.end && !!b.end, 60_000);
    await until(() => !!a2.settlement && !!b.settlement, 60_000);
    expect(a2.settlement!.status).toBe("settled");
    const rows = await getDb().select().from(matches).where(eq(matches.id, a2.end!.matchId!));
    expect(rows).toHaveLength(1);
    expect(await rowsFor(PLAYERS.si!.id)).toHaveLength(1);
    await Promise.all([resumed!.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 90_000);
});
