// Fair start and rematch lifecycle over real Colyseus WebSockets with injected
// auth. These prove the server contract and socket ordering, not browser
// rendering or a live two-device match.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker, type Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_PRACTICE_ROOM,
  BATTLE_QUEUE_ROOM,
  CLIENT_READY_MESSAGE,
  type ArmingMessage,
  type BattleFrame,
  type MatchFoundMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { attachOwnedRoom, createRoomOwner } from "@/app/dev/battle/battle-connection";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 28600 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const ARMING_MS = 700;
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;

const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => { throw new Error("no NFT reads"); },
  loadNftCommander: async () => { throw new Error("no NFT reads"); },
  timeoutMs: 60,
};

beforeAll(async () => {
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(PORT, {
    verifier: async (t) => {
      if (!t.startsWith("tok-")) throw new Error("bad token");
      return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
    },
    loader: async (did) => player(did.replace("did:privy:", "")),
    entitlement,
    patrons: testPatronSource(),
    replayDir: null,
    settlement: null,
    tickMs: 2,
    closeAfterMs: 300,
    reconnectGraceMs: 2_000,
    armingMs: ARMING_MS,
  });
});

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await sleep(5);
  }
};

/** Runs the real tick loop to its natural end without waiting on timers. */
function fastForward(roomId: string) {
  const room = matchMaker.getLocalRoomById(roomId) as unknown as { step(): void; session: { phase: string } };
  while (room.session.phase === "active") room.step();
}

const deck = Object.values(PRESETS)[0]!;
const ready = { cards: deck.cards, commander: { kind: "free", class: deck.commanderClass } };

interface Seat {
  room: Room;
  starts: StartMessage[];
  frames: BattleFrame[];
  acks: Array<{ ok: boolean; reason: string | null }>;
  aborted: string[];
  ended: unknown[];
  arming: ArmingMessage[];
  closed: boolean;
}

function watch(room: Room): Seat {
  const seat: Seat = { room, starts: [], frames: [], acks: [], aborted: [], ended: [], arming: [], closed: false };
  room.reconnection.enabled = false;
  room.onMessage("start", (m: StartMessage) => seat.starts.push(m));
  room.onMessage("frame", (m: BattleFrame) => seat.frames.push(m));
  room.onMessage("ack", (m: { ok: boolean; reason: string | null }) => seat.acks.push(m));
  room.onMessage("aborted", (m: { reason: string }) => seat.aborted.push(m.reason));
  room.onMessage("end", (m: unknown) => seat.ended.push(m));
  room.onMessage("arming", (m: ArmingMessage) => seat.arming.push(m));
  room.onMessage("lobby", () => {});
  room.onMessage("settlement", () => {});
  room.onMessage("presence", () => {});
  room.onMessage("error", () => {});
  room.onLeave(() => { seat.closed = true; });
  return seat;
}

const clientFor = (name: string) => new Client(URL_, { headers: { authorization: `Bearer tok-${name}` } });

async function practice(name: string): Promise<Seat> {
  const seat = watch(await clientFor(name).create(BATTLE_PRACTICE_ROOM, { difficulty: "hard" }));
  seat.room.send("ready", ready);
  await until(() => seat.starts.length > 0);
  return seat;
}

async function pair(a: string, b: string): Promise<[Seat, Seat]> {
  const first = await clientFor(a).create("battle");
  const second = await clientFor(b).joinById(first.roomId);
  const seats: [Seat, Seat] = [watch(first), watch(second)];
  for (const seat of seats) seat.room.send("ready", ready);
  await until(() => seats.every((s) => s.starts.length > 0));
  return seats;
}

describe("fair match start", () => {
  it("practice: the AI and the clock wait for the human's first paint", async () => {
    const seat = await practice("start-wait");
    expect(seat.starts[0]!.arming?.timeoutMs).toBeGreaterThan(0);
    await until(() => seat.frames.length > 0);
    await sleep(250);
    expect(seat.frames.every((f) => f.tick === 0 && f.troops.length === 0)).toBe(true);
    expect(seat.frames[0]!.clockTicks).toBeGreaterThan(0);
    expect(seat.frames[0]!.hand.length).toBeGreaterThan(0);
    seat.room.send(CLIENT_READY_MESSAGE);
    await until(() => seat.frames.some((f) => f.tick > 0));
    await seat.room.leave();
  });

  it("practice: commands are refused until the first tick", async () => {
    const seat = await practice("start-cmd");
    await until(() => seat.frames.length > 0);
    seat.room.send("cmd", { type: "deploy", cid: "early", cardId: deck.cards[0], x: 50, y: 20 });
    await until(() => seat.acks.length > 0);
    expect(seat.acks[0]).toMatchObject({ ok: false, reason: "The match has not started" });
    await seat.room.leave();
  });

  it("practice: a client that never loads aborts with no result and is free to play again", async () => {
    const seat = await practice("start-timeout");
    await until(() => seat.aborted.length > 0, ARMING_MS + 1000);
    expect(seat.aborted[0]).toMatch(/could not load in time/);
    expect(seat.ended).toEqual([]);
    expect(seat.frames.every((f) => f.tick === 0)).toBe(true);
    const next = await practice("start-timeout");
    expect(next.starts).toHaveLength(1);
    await next.room.leave();
    await seat.room.leave().catch(() => {});
  });

  it("practice: a frozen drop resumes frozen and must report ready again", async () => {
    const seat = await practice("start-drop");
    await until(() => seat.frames.length > 0);
    const resumeToken = seat.starts[0]!.resumeToken;
    await seat.room.leave(false);
    await until(() => seat.closed);
    await sleep(50);
    const back = watch(await clientFor("start-drop").joinById(seat.room.roomId, { resume: resumeToken }));
    await until(() => back.starts.length > 0 && back.frames.length > 0);
    expect(back.starts[0]).toMatchObject({ resumed: true });
    expect(back.starts[0]!.arming?.timeoutMs).toBeGreaterThan(0);
    expect(back.frames[0]!.tick).toBe(0);
    back.room.send(CLIENT_READY_MESSAGE);
    await until(() => back.frames.some((f) => f.tick > 0));
    await back.room.leave();
  });

  it("pvp: one ready seat cannot start the match, both seats can", async () => {
    const [a, b] = await pair("pvp-a", "pvp-b");
    await until(() => a.frames.length > 0 && b.frames.length > 0);
    a.room.send(CLIENT_READY_MESSAGE);
    a.room.send(CLIENT_READY_MESSAGE);
    await until(() => b.arming.length > 0);
    expect(b.arming[0]).toEqual({ opponentReady: true });
    await sleep(150);
    expect([...a.frames, ...b.frames].every((f) => f.tick === 0)).toBe(true);
    b.room.send(CLIENT_READY_MESSAGE);
    await until(() => a.frames.some((f) => f.tick > 0) && b.frames.some((f) => f.tick > 0));
    expect(a.frames.find((f) => f.tick > 0)!.tick).toBeLessThan(40);
    await a.room.leave();
    await b.room.leave().catch(() => {});
  });

  it("pvp: both seats leave tick 0 from the same state", async () => {
    const [a, b] = await pair("sync-a", "sync-b");
    await until(() => a.frames.length > 0 && b.frames.length > 0);
    expect(a.frames[0]!.clockTicks).toBe(b.frames[0]!.clockTicks);
    expect(a.frames[0]!.energy).toBe(b.frames[0]!.energy);
    await a.room.leave();
    await b.room.leave().catch(() => {});
  });

  it("pvp: the slow seat is named, nobody gets a result and nothing simulated", async () => {
    const [a, b] = await pair("slow-a", "slow-b");
    a.room.send(CLIENT_READY_MESSAGE);
    await until(() => a.aborted.length > 0 && b.aborted.length > 0, ARMING_MS + 1000);
    expect(a.aborted[0]).toMatch(/slow-b could not load/);
    expect(a.ended).toEqual([]);
    expect(b.ended).toEqual([]);
    expect([...a.frames, ...b.frames].every((f) => f.tick === 0)).toBe(true);
    await a.room.leave().catch(() => {});
    await b.room.leave().catch(() => {});
  });

  it("pvp: leaving while frozen aborts at once and cancels the wait", async () => {
    const [a, b] = await pair("quit-a", "quit-b");
    await a.room.leave();
    await until(() => b.aborted.length > 0, ARMING_MS / 2);
    expect(b.ended).toEqual([]);
    await b.room.leave().catch(() => {});
  });

  it("pvp: a resumed seat learns the opponent is already ready", async () => {
    const [a, b] = await pair("res-a", "res-b");
    await until(() => a.frames.length > 0);
    b.room.send(CLIENT_READY_MESSAGE);
    await until(() => a.arming.length > 0);
    const token = a.starts[0]!.resumeToken;
    await a.room.leave(false);
    await until(() => a.closed);
    await sleep(50);
    const back = watch(await clientFor("res-a").joinById(a.room.roomId, { resume: token }));
    await until(() => back.arming.length > 0);
    expect(back.arming[0]).toEqual({ opponentReady: true });
    back.room.send(CLIENT_READY_MESSAGE);
    await until(() => back.frames.some((f) => f.tick > 0));
    await back.room.leave();
    await b.room.leave().catch(() => {});
  });
});

/** The panel's real ownership wrapper over real sockets. */
function panelSession() {
  const owner = createRoomOwner<Room>();
  const log: string[] = [];
  return {
    log,
    owner,
    attach: (room: Room) => {
      const { on, onClose } = attachOwnedRoom(room, owner);
      on("start", () => log.push("start"));
      on("frame", () => {});
      onClose(() => log.push("closed"));
    },
  };
}

describe("rematch lifecycle", () => {
  it("practice: three immediate rematches, with the old close landing mid-session", async () => {
    const panel = panelSession();
    let seat = await practice("again-practice");
    panel.attach(seat.room);
    for (let n = 0; n < 3; n++) {
      seat.room.send(CLIENT_READY_MESSAGE);
      await until(() => seat.frames.some((f) => f.tick > 0));
      fastForward(seat.room.roomId);
      await until(() => seat.ended.length > 0);
      // The press: disown, leave without waiting, then open the next room.
      const finished = seat;
      panel.owner.release();
      void finished.room.leave();
      const next = watch(await clientFor("again-practice").create(BATTLE_PRACTICE_ROOM, { difficulty: "hard" }));
      panel.attach(next.room);
      await until(() => finished.closed);
      next.room.send("ready", ready);
      await until(() => next.starts.length > 0);
      seat = next;
    }
    expect(panel.log).not.toContain("closed");
    await seat.room.leave();
    // Only the final current room ever reported a close.
    expect(panel.log).toEqual(["start", "start", "start", "closed"]);
  });

  it("unranked: a finished match can re-enter the queue before its close lands", async () => {
    const finish = async (a: Seat, b: Seat) => {
      a.room.send(CLIENT_READY_MESSAGE);
      b.room.send(CLIENT_READY_MESSAGE);
      await until(() => a.frames.some((f) => f.tick > 0));
      fastForward(a.room.roomId);
      await until(() => a.ended.length > 0 && b.ended.length > 0);
    };
    const match = async () => {
      const pairs = await Promise.all(["queue-a", "queue-b"].map(async (name) => {
        const client = clientFor(name);
        const queue = await client.joinOrCreate(BATTLE_QUEUE_ROOM);
        queue.onMessage("queue_status", () => {});
        const found = await new Promise<MatchFoundMessage>((resolve) => queue.onMessage("match_found", resolve));
        const seat = watch(await client.consumeSeatReservation(found.reservation));
        await queue.leave().catch(() => {});
        return seat;
      }));
      for (const seat of pairs) seat.room.send("ready", ready);
      await until(() => pairs.every((s) => s.starts.length > 0));
      return pairs as [Seat, Seat];
    };
    for (let n = 0; n < 3; n++) {
      const [a, b] = await match();
      await finish(a, b);
      // No wait for the close: the room pin was released at the result.
      void a.room.leave();
      void b.room.leave();
    }
  });

  it("a finished room closes itself on the result timer", async () => {
    const seat = await practice("close-timer");
    seat.room.send(CLIENT_READY_MESSAGE);
    await until(() => seat.frames.some((f) => f.tick > 0));
    fastForward(seat.room.roomId);
    await until(() => seat.ended.length > 0);
    expect(seat.closed).toBe(false);
    await until(() => seat.closed, 2_000);
  });

  it("the same player cannot hold two tickets at once", async () => {
    const client = clientFor("dup-queue");
    const queue = await client.joinOrCreate(BATTLE_QUEUE_ROOM);
    queue.onMessage("queue_status", () => {});
    await expect(clientFor("dup-queue").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already searching/);
    await queue.leave();
  });
});
