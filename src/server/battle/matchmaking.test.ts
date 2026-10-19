// B3.2b matchmaking over real Colyseus WS. Queue room + matched battle
// rooms share one MatchCoordinator; auth/entitlement deps are injected.
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
  CHOG_GENESIS_CHAIN_ID,
  CHOG_GENESIS_CONTRACT,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type MatchFoundMessage,
  type QueueStatusMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import type { EntitlementDeps, NftCommanderRecord } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { startBattleServer } from "@/server/battle/server";

const PORT = 29000 + Math.floor(Math.random() * 900);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-mm-replays-"));
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;
const PLAYERS: Record<string, Player> = {};
for (const n of ["alice", "bob", "carol", "dave", "erin"]) PLAYERS[n] = player(n);

const OWNER_ALICE = "0xa11ce";
const TOKEN = "1462";

function nftRow(tokenId: string, cls: CommanderClass = "scout"): Commander {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    id: "cmdr-row",
    nftId: "nft-row",
    rulesetVersion: "v1",
    tokenId,
    class: cls,
    affinity: cls,
    stats: t.stats,
    abilities: t.abilities,
    variant: "bastion",
    prestige: "Mythic",
    sourceTraits: [],
    unmatchedTraits: [],
    scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 },
    powerScore: t.powerScore,
    contentHash: `hash-${tokenId}`,
    previousContentHash: null,
    derivationCount: 1,
    derivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Commander;
}

const chain: { ownerOf: EntitlementDeps["ownerOf"]; load: EntitlementDeps["loadNftCommander"]; wallets: (pid: string) => Promise<string[]> } = {
  ownerOf: async () => ({ owner: OWNER_ALICE, chainId: CHOG_GENESIS_CHAIN_ID }),
  load: async (tokenId): Promise<NftCommanderRecord> => ({ tokenId, name: "CHOG #1462", imageOriginal: "ipfs://img", commander: nftRow(tokenId) }),
  wallets: async (pid) => (pid === "alice" ? [OWNER_ALICE] : []),
};
const entitlement: EntitlementDeps = {
  verifiedWallets: (pid) => chain.wallets(pid),
  ownerOf: (t) => chain.ownerOf(t),
  loadNftCommander: (t) => chain.load(t),
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

const ready = (preset: string, commander: CommanderChoice = { kind: "free", class: "scout" }) => ({ cards: [...PRESETS[preset]!.cards], commander });
const nftReady = (tokenId = TOKEN) => ({ cards: [...PRESETS.swarm!.cards], commander: { kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId } satisfies CommanderChoice });

interface QSeen {
  status: QueueStatusMessage[];
  found?: MatchFoundMessage;
  timeout?: string;
  left: boolean;
}
function watchQueue(room: Room): QSeen {
  const seen: QSeen = { status: [], left: false };
  room.onMessage("queue_status", (m: QueueStatusMessage) => seen.status.push(m));
  room.onMessage("match_found", (m: MatchFoundMessage) => (seen.found = m));
  room.onMessage("queue_timeout", (m: { reason: string }) => (seen.timeout = m.reason));
  room.onLeave(() => (seen.left = true));
  return seen;
}

interface Seen {
  start?: StartMessage;
  lobby?: LobbyMessage;
  errors: string[];
  frames: BattleFrame[];
  acks: AckMessage[];
  end?: EndMessage;
  aborted?: string;
}
function watch(room: Room): Seen {
  const seen: Seen = { frames: [], acks: [], errors: [] };
  room.onMessage("start", (m: StartMessage) => (seen.start = m));
  room.onMessage("lobby", (m: LobbyMessage) => (seen.lobby = m));
  room.onMessage("frame", (f: BattleFrame) => seen.frames.push(f));
  room.onMessage("ack", (a: AckMessage) => seen.acks.push(a));
  room.onMessage("end", (e: EndMessage) => (seen.end = e));
  room.onMessage("aborted", (a: { reason: string }) => (seen.aborted = a.reason));
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
/** The server closes queue sockets; leave() on a closed/reconnecting socket can hang. */
const leaveQuietly = (room: Room, ms = 500) => Promise.race([room.leave().catch(() => {}), sleep(ms)]);

/** Queue `name` in, wait for match_found, consume the reservation, return the battle room + watcher. */
async function queueIntoBattle(name: string) {
  const c = client(`tok-${name}`);
  const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
  const qs = watchQueue(q);
  await until(() => !!qs.found);
  const room = await c.consumeSeatReservation(qs.found!.reservation);
  const seen = watch(room);
  await leaveQuietly(q);
  return { c, q, qs, room, seen };
}

describe("B3.2b matchmaking", () => {
  it("rejects missing and forged tokens on the queue", async () => {
    await expect(client().joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Authentication required/);
    await expect(client("forged").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Invalid or expired/);
  });

  it("matches two queued players, runs a real match and replays identically", async () => {
    const [a, b] = await Promise.all([queueIntoBattle("alice"), queueIntoBattle("bob")]);
    expect(a.qs.found!.opponent).toBe("bob");
    expect(b.qs.found!.opponent).toBe("alice");
    expect(a.qs.found!.reservation.roomId).toBe(b.qs.found!.reservation.roomId);
    expect(a.qs.found!.reservation.sessionId).not.toBe(b.qs.found!.reservation.sessionId);
    // Matched lobby carries the opponent name and a deadline, never a deck.
    await until(() => !!a.seen.lobby?.match && !!b.seen.lobby?.match);
    expect(a.seen.lobby!.match!.opponent).toBe("bob");
    expect(a.seen.lobby!.match!.deadlineAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(a.seen.lobby)).not.toMatch(/deck|tokenId/);
    a.room.send("ready", ready("swarm", { kind: "free", class: "reaver" }));
    b.room.send("ready", ready("siege", { kind: "free", class: "warden" }));
    await until(() => !!a.seen.start && !!b.seen.start);
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
      const fa = a.seen.frames.at(-1);
      const fb = b.seen.frames.at(-1);
      if (fa && fa.tick !== last.a) {
        last.a = fa.tick;
        drive(a.room, a.seen);
      }
      if (fb && fb.tick !== last.b) {
        last.b = fb.tick;
        drive(b.room, b.seen);
      }
      return !!a.seen.end && !!b.seen.end;
    }, 90_000);
    expect(a.seen.end!.replayIdentical).toBe(true);
    expect(a.seen.end!.stateHash).toBe(b.seen.end!.stateHash);
    // At least one manual ability command was accepted over the wire.
    expect(
      a.seen.acks.concat(b.seen.acks).some((x) => x.cid.startsWith("ab") && x.ok) ||
        a.seen.frames.flatMap((f) => f.events).some((e) => e.type === "ability_fired")
    ).toBe(true);
    await Promise.all([leaveQuietly(a.room), leaveQuietly(b.room)]);
  }, 120_000);

  it("cancel search frees the slot and a later joiner keeps waiting alone", async () => {
    const qa = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sa = watchQueue(qa);
    await until(() => sa.status.length > 0);
    await leaveQuietly(qa);
    const qb = await client("tok-bob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await until(() => sb.status.some((s) => s.waiting === 1));
    await sleep(300);
    expect(sb.found).toBeUndefined();
    await leaveQuietly(qb);
  });

  it("rejects a duplicate queue from the same player and never self-matches", async () => {
    const q1 = await client("tok-carol").joinOrCreate(BATTLE_QUEUE_ROOM);
    const s1 = watchQueue(q1);
    await until(() => s1.status.length > 0);
    await expect(client("tok-carol").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already searching/);
    await sleep(300);
    expect(s1.found).toBeUndefined();
    await leaveQuietly(q1);
  });

  it("pairs four concurrent joins into two matches, three into one plus a waiter", async () => {
    const names = ["alice", "bob", "carol", "dave"];
    const queues = await Promise.all(names.map((n) => client(`tok-${n}`).joinOrCreate(BATTLE_QUEUE_ROOM)));
    const seen = queues.map(watchQueue);
    await until(() => seen.every((s) => !!s.found));
    const roomIds = new Set(seen.map((s) => s.found!.reservation.roomId));
    expect(roomIds.size).toBe(2);
    // Each player appears in exactly one match and each match has a real opponent.
    for (const s of seen) expect(names).toContain(s.found!.opponent);
    // Nobody consumes: the lobby deadline aborts both rooms and releases all four.
    await sleep(2_500);
    // Three fresh concurrent joins pair two and leave one waiting.
    const trio = ["alice", "bob", "carol"];
    const q3 = await Promise.all(trio.map((n) => client(`tok-${n}`).joinOrCreate(BATTLE_QUEUE_ROOM)));
    const s3 = q3.map(watchQueue);
    await until(() => s3.filter((s) => !!s.found).length === 2);
    const waiter = s3.find((s) => !s.found)!;
    await until(() => waiter.status.some((s) => s.waiting >= 1));
    await Promise.all(q3.map((q) => leaveQuietly(q)));
    await Promise.all(queues.map((q) => leaveQuietly(q)));
    // The second trio match's room also needs its deadline to release them.
    await sleep(2_500);
  }, 30_000);

  it("rejects strangers and self-service matchKeys on a matched room", async () => {
    const qa = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sa = watchQueue(qa);
    const qb = await client("tok-bob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await until(() => !!sa.found && !!sb.found);
    const roomId = sa.found!.reservation.roomId;
    // A third player cannot joinById a private matched room.
    await expect(client("tok-carol").joinById(roomId)).rejects.toThrow(/Not a player|private|full|locked/i);
    // Clients cannot forge a matched room.
    await expect(client("tok-carol").create(BATTLE_ROOM, { matchKey: "deadbeef" })).rejects.toThrow(/Unknown or expired|match/i);
    // The same reservation cannot be consumed twice.
    const c = client("tok-alice");
    const r1 = await c.consumeSeatReservation(sa.found!.reservation);
    await expect(c.consumeSeatReservation(sa.found!.reservation)).rejects.toThrow(/consumed|expired|MATCHMAKE/i);
    await r1.leave().catch(() => {});
    // r1 leaving before start aborts the room; wait for cleanup.
    await sleep(2_500);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb)]);
  }, 30_000);

  it("a disconnect before start aborts the match and releases both players", async () => {
    const [a, b] = await Promise.all([queueIntoBattle("alice"), queueIntoBattle("bob")]);
    await until(() => !!a.seen.lobby && !!b.seen.lobby);
    await a.room.leave();
    await until(() => !!b.seen.aborted);
    expect(b.seen.aborted).toMatch(/Opponent left/);
    // Both players can queue again after the abort released them.
    const qa = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sa2 = watchQueue(qa);
    const qb = await client("tok-bob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb2 = watchQueue(qb);
    await until(() => !!sa2.found && !!sb2.found);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb), leaveQuietly(b.room)]);
    await sleep(2_500); // let the fresh matched room hit its lobby deadline
  }, 30_000);

  it("keeps a player out of the queue while their match is live, frees them after it ends", async () => {
    const [a, b] = await Promise.all([queueIntoBattle("alice"), queueIntoBattle("bob")]);
    a.room.send("ready", ready("swarm"));
    b.room.send("ready", ready("siege"));
    await until(() => !!a.seen.start && !!b.seen.start);
    await expect(client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM)).rejects.toThrow(/Already in a match/);
    await a.room.leave(); // aborts the active match
    await until(() => !!b.seen.aborted);
    await sleep(300);
    const q = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    await leaveQuietly(q);
    await leaveQuietly(b.room);
  }, 30_000);

  it("expires a lonely ticket with queue_timeout", async () => {
    const q = await client("tok-erin").joinOrCreate(BATTLE_QUEUE_ROOM);
    const s = watchQueue(q);
    await until(() => !!s.timeout, 10_000);
    expect(s.timeout).toMatch(/No opponent found/);
    await until(() => s.left, 5_000);
    // Freed: erin can queue again.
    const q2 = await client("tok-erin").joinOrCreate(BATTLE_QUEUE_ROOM);
    await leaveQuietly(q2);
  });

  it("aborts a matched room that is never joined and releases both players", async () => {
    const qa = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sa = watchQueue(qa);
    const qb = await client("tok-bob").joinOrCreate(BATTLE_QUEUE_ROOM);
    const sb = watchQueue(qb);
    await until(() => !!sa.found && !!sb.found);
    // Nobody consumes; the lobby deadline aborts and releases the pair.
    await sleep(2_500);
    const q2 = await client("tok-alice").joinOrCreate(BATTLE_QUEUE_ROOM);
    const s2 = watchQueue(q2);
    await until(() => s2.status.length > 0 || !!s2.found);
    await leaveQuietly(q2);
    await Promise.all([leaveQuietly(qa), leaveQuietly(qb)]);
  }, 30_000);

  it("NFT entitlement failure in a matched room un-readies only that player, free re-ready starts", async () => {
    const [a, b] = await Promise.all([queueIntoBattle("alice"), queueIntoBattle("bob")]);
    let calls = 0;
    const prev = chain.ownerOf;
    chain.ownerOf = async () => ({ owner: ++calls === 1 ? OWNER_ALICE : "0xthief", chainId: CHOG_GENESIS_CHAIN_ID });
    try {
      a.room.send("ready", nftReady());
      await until(() => a.seen.lobby?.players.find((p) => p.username === "alice")?.ready === true);
      b.room.send("ready", ready("siege"));
      await until(() => a.seen.errors.some((e) => e.includes("match start")));
      expect(a.seen.errors.at(-1)).toMatch(/Commander entitlement failed at match start/);
      chain.ownerOf = prev;
      // Alice falls back to a free commander and the match starts normally.
      a.room.send("ready", ready("swarm"));
      await until(() => !!a.seen.start && !!b.seen.start);
    } finally {
      chain.ownerOf = prev;
    }
    await Promise.all([leaveQuietly(a.room), leaveQuietly(b.room)]);
  }, 30_000);
});
