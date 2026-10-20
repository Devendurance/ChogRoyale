// B3.2c reconnect + activity exclusivity over real Colyseus WS. Drops are
// unconsented leaves (room.leave(false)); resumes are joinById with the
// rotating resumeToken, re-authed by the Privy header like every join.
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_QUEUE_ROOM,
  BATTLE_ROOM,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type PresenceMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import { MatchCoordinator } from "@/server/battle/matchmaking";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 29700 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-rc-replays-"));
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;
const PLAYERS: Record<string, Player> = {};
for (const n of [
  "alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi", "ivan", "judy",
  "mallory", "niaj", "olivia", "peggy", "rupert", "sybil", "trent", "ursula", "victor", "wendy",
]) PLAYERS[n] = player(n);

const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => ({ owner: "0x0", chainId: 143 }),
  loadNftCommander: async () => null,
  timeoutMs: 60,
};

beforeAll(async () => {
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
    matchLobbyMs: 1_500,
    queueMaxWaitMs: 15_000,
    reconnectGraceMs: 5_000,
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const ready = (preset: string, commander: CommanderChoice = { kind: "free", class: "scout" }) => ({ cards: [...PRESETS[preset]!.cards], commander });

interface Seen {
  start?: StartMessage;
  starts: StartMessage[];
  lobby?: LobbyMessage;
  errors: string[];
  frames: BattleFrame[];
  acks: AckMessage[];
  end?: EndMessage;
  aborted?: string;
  presence: PresenceMessage[];
}
function watch(room: Room): Seen {
  const seen: Seen = { starts: [], frames: [], acks: [], errors: [], presence: [] };
  room.onMessage("start", (m: StartMessage) => (seen.starts.push(m), (seen.start = m)));
  room.onMessage("lobby", (m: LobbyMessage) => (seen.lobby = m));
  room.onMessage("frame", (f: BattleFrame) => seen.frames.push(f));
  room.onMessage("ack", (a: AckMessage) => seen.acks.push(a));
  room.onMessage("end", (e: EndMessage) => (seen.end = e));
  room.onMessage("aborted", (a: { reason: string }) => (seen.aborted = a.reason));
  room.onMessage("presence", (p: PresenceMessage) => seen.presence.push(p));
  room.onMessage("error", (e: { reason: string }) => seen.errors.push(e.reason));
  return seen;
}
const until = async (cond: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const leaveQuietly = (room: Room, ms = 500) => Promise.race([room.leave().catch(() => false), sleep(ms)]);

/**
 * joinById can bounce off a transiently locked/full room while a dropped
 * seat's socket is still being freed; retry those matchmaker rejections but
 * surface real authorization errors (and real joins) immediately.
 */
async function resumeAttempt(
  c: Client,
  roomId: string,
  token: string,
  ms = 8_000
): Promise<{ ok: true; room: Room } | { ok: false; error: Error }> {
  const t0 = Date.now();
  for (;;) {
    try {
      return { ok: true, room: await c.joinById(roomId, { resume: token }) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/locked|full/i.test(msg) && Date.now() - t0 < ms) {
        await sleep(60);
        continue;
      }
      return { ok: false, error: e as Error };
    }
  }
}

/** Start a private room-code match between two named players. */
async function startedPair(nameA: string, nameB: string, deckA = "swarm", deckB = "antiSwarm") {
  const ca = client(`tok-${nameA}`);
  const ra = await ca.create(BATTLE_ROOM);
  const cb = client(`tok-${nameB}`);
  const rb = await cb.joinById(ra.roomId);
  const a = watch(ra);
  const b = watch(rb);
  ra.send("ready", ready(deckA));
  rb.send("ready", ready(deckB));
  await until(() => !!a.start && !!b.start);
  return { ca, cb, ra, rb, a, b, roomId: ra.roomId };
}

/** Drive both seats until the match ends (deploys + ready abilities). */
async function driveToEnd(getRooms: () => { ra: Room; rb: Room }, a: Seen, b: Seen, timeout = 90_000) {
  let n = 0;
  const drive = (room: Room, s: Seen) => {
    const f = s.frames.at(-1);
    if (!f || s.end) return;
    const readyA = f.abilities.find((x) => x.ready && !x.blockedBy);
    if (readyA) room.send("cmd", { type: "ability", cid: `ab${n++}`, abilityId: readyA.abilityId });
    const pick = f.hand.find((c) => {
      const k = s.start!.catalog[c]!;
      return (k.kind === "troop" || k.kind === "commander") && k.cost <= f.energy;
    });
    if (pick && f.tick % 15 === 0) room.send("cmd", { type: "deploy", cid: `d${n++}`, cardId: pick, x: n % 2 ? 30 : 70, y: s.start!.seat === 0 ? 60 : 100 });
  };
  const last = { a: -1, b: -1 };
  await until(() => {
    const { ra, rb } = getRooms();
    const fa = a.frames.at(-1);
    const fb = b.frames.at(-1);
    if (fa && fa.tick !== last.a) {
      last.a = fa.tick;
      drive(ra, a);
    }
    if (fb && fb.tick !== last.b) {
      last.b = fb.tick;
      drive(rb, b);
    }
    return !!a.end && !!b.end;
  }, timeout);
}

describe("B3.2c reconnect", () => {
  it("resumes a dropped seat with a full-state frame and finishes with an identical replay", async () => {
    const { ca, ra, rb, a, b, roomId } = await startedPair("alice", "bob");
    expect(a.start!.resumeToken).toMatch(/^[0-9a-f]{32}$/);
    expect(a.start!.resumed).toBe(false);
    await until(() => a.frames.length > 10);
    // Pre-drop command so the cid set can be probed after resume.
    ra.send("cmd", { type: "deploy", cid: "pre-drop", cardId: a.start!.deck[0], x: 30, y: 60 });
    await until(() => a.acks.some((x) => x.cid === "pre-drop"));
    // Unconsented drop: sim keeps running, bob keeps receiving frames.
    void ra.leave(false);
    await until(() => b.presence.some((p) => !p.opponentConnected));
    expect(b.presence.at(-1)!.reconnectDeadlineAt).toBeGreaterThan(Date.now());
    const bTickAtDrop = b.frames.at(-1)!.tick;
    await sleep(300);
    expect(b.frames.at(-1)!.tick).toBeGreaterThan(bTickAtDrop); // sim advanced for bob
    // Resume with the Privy header + resume token.
    const ra2 = await ca.joinById(roomId, { resume: a.start!.resumeToken });
    const a2 = watch(ra2);
    await until(() => !!a2.start && a2.frames.length > 0);
    expect(a2.start!.resumed).toBe(true);
    expect(a2.start!.resumeToken).not.toBe(a.start!.resumeToken); // rotated
    await until(() => b.presence.some((p) => p.opponentConnected));
    // The resync frame is a full snapshot consistent with the opponent's view.
    const snap = a2.frames[0]!;
    expect(snap.tick).toBeGreaterThanOrEqual(bTickAtDrop);
    const sameTick = b.frames.find((f) => f.tick === snap.tick);
    expect(sameTick).toBeTruthy();
    expect(snap.troops).toEqual(sameTick!.troops);
    expect(snap.structures).toEqual(sameTick!.structures);
    expect(snap.crowns).toEqual(sameTick!.crowns);
    expect(snap.chaos).toEqual(sameTick!.chaos);
    expect(snap.clockTicks).toBe(sameTick!.clockTicks);
    expect(snap.hand.length).toBe(4);
    expect(typeof snap.energy).toBe("number");
    // A resent pre-drop cid is rejected as a duplicate.
    ra2.send("cmd", { type: "deploy", cid: "pre-drop", cardId: a2.start!.deck[0], x: 30, y: 60 });
    await until(() => a2.acks.some((x) => x.cid === "pre-drop"));
    expect(a2.acks.find((x) => x.cid === "pre-drop")).toMatchObject({ ok: false, reason: "Duplicate command" });
    // Play to a real end.
    const curA: { room: Room; seen: Seen } = { room: ra2, seen: a2 };
    await driveToEnd(() => ({ ra: curA.room, rb }), a2, b);
    expect(a2.end!.replayIdentical).toBe(true);
    expect(a2.end!.stateHash).toBe(b.end!.stateHash);
    // A manual ability landed post-resume (ack ok or observed firing).
    expect(
      a2.acks.concat(b.acks).some((x) => x.cid.startsWith("ab") && x.ok) ||
        a2.frames.flatMap((f) => f.events).some((e) => e.type === "ability_fired")
    ).toBe(true);
    await Promise.all([leaveQuietly(ra2), leaveQuietly(rb)]);
  }, 120_000);

  it("rejects strangers, wrong tokens, rotated tokens and concurrent or double resumes", async () => {
    const { ca, ra, rb, a, b, roomId } = await startedPair("carol", "dave");
    await until(() => a.frames.length > 5);
    void ra.leave(false);
    await until(() => b.presence.some((p) => !p.opponentConnected));
    const oldToken = a.start!.resumeToken;
    // A third authenticated player holding the real token is not a seat owner.
    const stranger = await resumeAttempt(client("tok-erin"), roomId, oldToken);
    expect(stranger.ok).toBe(false);
    // The owner with a wrong token is rejected.
    const wrong = await resumeAttempt(ca, roomId, "0".repeat(32));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.message).toMatch(/authorized/i);
    // Two concurrent resumes: exactly one wins.
    const [r1, r2] = await Promise.allSettled([ca.joinById(roomId, { resume: oldToken }), client("tok-carol").joinById(roomId, { resume: oldToken })]);
    expect([r1, r2].filter((r) => r.status === "fulfilled").length).toBe(1);
    const won = (r1.status === "fulfilled" ? r1 : r2) as PromiseFulfilledResult<Room>;
    const a2 = watch(won.value);
    await until(() => !!a2.start);
    const newToken = a2.start!.resumeToken;
    // Resume while the seat is connected is rejected.
    await expect(ca.joinById(roomId, { resume: newToken })).rejects.toThrow(/Seat already connected|locked|full/i);
    // After a fresh drop the dead old token is rejected and the new token works.
    void won.value.leave(false);
    await until(() => b.presence.filter((p) => !p.opponentConnected).length >= 2);
    const stale = await resumeAttempt(ca, roomId, oldToken);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.message).toMatch(/authorized/i);
    const again = await resumeAttempt(ca, roomId, newToken);
    expect(again.ok).toBe(true);
    const ra3 = (again as { ok: true; room: Room }).room;
    const a3 = watch(ra3);
    await until(() => !!a3.start);
    await Promise.all([leaveQuietly(ra3), leaveQuietly(rb)]);
    await sleep(200); // let the active-match abort settle
  }, 60_000);

  it("expires the grace window: abort with no winner, resume refused, both released", async () => {
    const { ca, ra, rb, a, b, roomId } = await startedPair("frank", "grace");
    void ra.leave(false);
    await until(() => !!b.aborted, 15_000);
    expect(b.aborted).toMatch(/did not reconnect in time/);
    expect(b.end).toBeUndefined();
    await expect(ca.joinById(roomId, { resume: a.start!.resumeToken })).rejects.toThrow();
    // Both players are released and can queue again.
    const qa = await client("tok-frank").joinOrCreate(BATTLE_QUEUE_ROOM);
    const qb = await client("tok-grace").joinOrCreate(BATTLE_QUEUE_ROOM);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb)]);
    await leaveQuietly(rb);
  }, 30_000);

  it("still aborts immediately on a consented leave", async () => {
    const { ra, rb, b } = await startedPair("heidi", "ivan");
    await until(() => b.frames.length > 3);
    await ra.leave(); // consented
    await until(() => !!b.aborted);
    expect(b.aborted).toMatch(/disconnected/);
    await leaveQuietly(rb);
  }, 30_000);

  it("rejects resume after the match finished", async () => {
    const { ca, ra, rb, a, b, roomId } = await startedPair("judy", "mallory");
    await driveToEnd(() => ({ ra, rb }), a, b);
    await expect(ca.joinById(roomId, { resume: a.start!.resumeToken })).rejects.toThrow();
    await Promise.all([leaveQuietly(ra), leaveQuietly(rb)]);
  }, 120_000);
});

describe("B3.2c activity exclusivity", () => {
  it("blocks queue while in a waiting private room, and frees on leave", async () => {
    const ra = await client("tok-niaj").create(BATTLE_ROOM);
    await expect(client("tok-niaj").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already in a battle/);
    await ra.leave();
    const q = await client("tok-niaj").joinOrCreate(BATTLE_QUEUE_ROOM);
    await leaveQuietly(q);
  });

  it("blocks room create/join while queued", async () => {
    const q = await client("tok-olivia").joinOrCreate(BATTLE_QUEUE_ROOM);
    await expect(client("tok-olivia").create(BATTLE_ROOM)).rejects.toThrow(/Already searching/);
    const other = await client("tok-peggy").create(BATTLE_ROOM);
    await expect(client("tok-olivia").joinById(other.roomId)).rejects.toThrow(/Already searching|full|locked/i);
    await leaveQuietly(q);
    await leaveQuietly(other);
  });

  it("a dropped player inside the grace window can neither queue nor create", async () => {
    const { ra, rb, b } = await startedPair("rupert", "sybil");
    void ra.leave(false);
    await until(() => b.presence.some((p) => !p.opponentConnected));
    await expect(client("tok-rupert").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already in a battle/);
    await expect(client("tok-rupert").create(BATTLE_ROOM)).rejects.toThrow(/Already in a battle/);
    // Let the grace expire so the pair is released for later tests.
    await until(() => !!b.aborted, 15_000);
    await leaveQuietly(rb);
  }, 30_000);

  it("releaseRoom with a different roomId does not free the activity", async () => {
    const c = new MatchCoordinator({ maxWaitMs: 60_000 });
    c.claimRoom("p1", "room-A");
    c.releaseRoom("p1", "room-B");
    expect(() => c.claimRoom("p1", "room-C")).toThrow(/Already in a battle/);
    c.releaseRoom("p1", "room-A");
    expect(() => c.claimRoom("p1", "room-C")).not.toThrow();
    c.dispose();
  });

  it("a matched-but-never-joined player cannot create a private room", async () => {
    const qa = await client("tok-trent").joinOrCreate(BATTLE_QUEUE_ROOM);
    let foundA: { roomId: string } | null = null;
    qa.onMessage("match_found", (m: { reservation: { roomId: string } }) => (foundA = m.reservation));
    const qb = await client("tok-ursula").joinOrCreate(BATTLE_QUEUE_ROOM);
    await until(() => !!foundA);
    await expect(client("tok-trent").create(BATTLE_ROOM)).rejects.toThrow(/Already in a battle/);
    // Let the unmatched room hit its lobby deadline so both are released.
    await sleep(2_500);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb)]);
  }, 30_000);

  it("releases both players after a normal end", async () => {
    const { ra, rb, a, b } = await startedPair("victor", "wendy", "swarm", "siege");
    await driveToEnd(() => ({ ra, rb }), a, b);
    const qa = await client("tok-victor").joinOrCreate(BATTLE_QUEUE_ROOM);
    const qb = await client("tok-wendy").joinOrCreate(BATTLE_QUEUE_ROOM);
    let found = 0;
    qa.onMessage("match_found", () => found++);
    qb.onMessage("match_found", () => found++);
    await until(() => found === 2);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb), leaveQuietly(ra), leaveQuietly(rb)]);
    await sleep(2_500); // fresh matched room hits its deadline and disposes
  }, 120_000);
});
