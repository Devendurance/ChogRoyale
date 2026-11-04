// Training Camp room over real Colyseus sockets with injected auth and a fake
// progress service. Proves the first lesson starts from the real PracticeRoom,
// completes only from an accepted troop deployment, and never writes for a
// duplicate. DB persistence is covered separately in src/db/tutorial.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_PRACTICE_ROOM,
  BATTLE_TUTORIAL_ROOM,
  type AckMessage,
  type BattleFrame,
  type StartMessage,
} from "@/lib/battle-protocol";
import { TUTORIAL_READY } from "@/lib/tutorial-camp";
import type { TutorialDeps } from "@/server/tutorial";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";
import type { EntitlementDeps } from "@/server/battle/entitlement";

const PORT = 31000 + Math.floor(Math.random() * 400);
const URL_ = `http://127.0.0.1:${PORT}`;
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;

const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => { throw new Error("no NFT reads"); },
  loadNftCommander: async () => { throw new Error("no NFT reads"); },
  timeoutMs: 60,
};

const completed: Array<{ playerId: string; stage: number }> = [];
let allowAdmission = true;
const tutorial: TutorialDeps = {
  admission: async () => ({ allowed: allowAdmission, access: allowAdmission ? "gate-off" : "training-required" }),
  progress: async () => ({ stage: 0, completedStages: 0, graduated: false, grandfathered: false, nextStage: 1, enforcement: false, access: "gate-off" }),
  complete: async (playerId, stage) => {
    completed.push({ playerId, stage });
    return { status: "completed", stage, completedStages: 1, graduated: false };
  },
};

beforeAll(async () => {
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(PORT, {
    armingMs: 0,
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
    closeAfterMs: 50,
    reconnectGraceMs: 2_000,
    tutorial,
  });
});

afterAll(async () => {
  await server?.gracefullyShutdown(false).catch(() => {});
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, ms = 8_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await sleep(5);
  }
};

interface Seen {
  room: Room;
  starts: StartMessage[];
  frames: BattleFrame[];
  acks: AckMessage[];
  tutorial: Array<{ completed: boolean; stage: number; replay: boolean; completedStages: number }>;
  errors: string[];
  closed: boolean;
}

function watch(room: Room): Seen {
  const seen: Seen = { room, starts: [], frames: [], acks: [], tutorial: [], errors: [], closed: false };
  room.reconnection.enabled = false;
  room.onMessage("start", (m: StartMessage) => seen.starts.push(m));
  room.onMessage("frame", (m: BattleFrame) => seen.frames.push(m));
  room.onMessage("ack", (m: AckMessage) => seen.acks.push(m));
  room.onMessage("tutorial", (m: Seen["tutorial"][number]) => seen.tutorial.push(m));
  room.onMessage("error", (e: { reason: string }) => seen.errors.push(e.reason));
  room.onMessage("lobby", () => {});
  room.onMessage("presence", () => {});
  room.onLeave(() => { seen.closed = true; });
  return seen;
}

const client = (name: string) => new Client(URL_, { headers: { authorization: `Bearer tok-${name}` } });

async function startTutorial(name: string): Promise<Seen> {
  const room = await client(name).create(BATTLE_TUTORIAL_ROOM, { stage: 1 });
  const seen = watch(room);
  room.send("ready", TUTORIAL_READY);
  await until(() => seen.starts.length > 0 && seen.frames.length > 0);
  return seen;
}

describe("Training Camp battle 1", () => {
  it("starts from the real PracticeRoom with the teaching loadout and Easy opponent", async () => {
    const seen = await startTutorial("tutorial-start");
    expect(seen.starts[0]!.tutorial).toEqual({ stage: 1, replay: false, completedStages: 0 });
    expect(seen.starts[0]!.practiceOpponent?.difficulty).toBe("easy");
    expect(seen.starts[0]!.practiceOpponent?.botId).toBe("practice-easy-v1");
    expect(seen.starts[0]!.deck).toEqual([...TUTORIAL_READY.cards, seen.starts[0]!.deck[7]]);
    expect(seen.tutorial[0]).toMatchObject({ stage: 1, completed: false, replay: false });
    await seen.room.leave();
  });

  it("completes only after a real accepted troop deployment", async () => {
    const seen = await startTutorial("tutorial-deploy");
    await until(() => seen.frames.some((f) => f.tick > 0));
    const frame = seen.frames.at(-1)!;
    const start = seen.starts[0]!;
    const troop = frame.hand.find((card) => start.catalog[card]?.kind === "troop" && start.catalog[card]!.cost <= frame.energy);
    expect(troop).toBeTruthy();
    const y = start.seat === 0 ? 60 : 100;
    seen.room.send("cmd", { type: "deploy", cid: "tutorial-troop", cardId: troop, x: 30, y });
    await until(() => seen.acks.some((a) => a.ok));
    await until(() => seen.tutorial.some((m) => m.completed));
    expect(completed).toContainEqual({ playerId: "tutorial-deploy", stage: 1 });
    const done = seen.tutorial.find((m) => m.completed)!;
    expect(done).toMatchObject({ stage: 1, completed: true, completedStages: 1 });
    await sleep(80);
    expect(completed.filter((entry) => entry.playerId === "tutorial-deploy")).toHaveLength(1);
    await seen.room.leave();
  });

  it("resumes the same stage and keeps the tutorial contract", async () => {
    const seen = await startTutorial("tutorial-resume");
    const token = seen.starts[0]!.resumeToken;
    const roomId = seen.room.roomId;
    await seen.room.leave(false);
    await until(() => seen.closed);
    let back: Seen | null = null;
    for (let attempt = 0; attempt < 100 && !back; attempt++) {
      try {
        back = watch(await client("tutorial-resume").joinById(roomId, { resume: token }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/locked|full/i.test(message)) throw error;
        await sleep(50);
      }
    }
    if (!back) throw new Error("tutorial room stayed locked");
    await until(() => back.starts.length > 0);
    expect(back.starts[0]!.resumed).toBe(true);
    expect(back.starts[0]!.tutorial).toEqual({ stage: 1, replay: false, completedStages: 0 });
    await back.room.leave();
  });

  it("rejects a later stage that is not built yet", async () => {
    await expect(client("tutorial-later").create(BATTLE_TUTORIAL_ROOM, { stage: 2 })).rejects.toThrow(/not available yet/);
  });

  it("admits a new practice room only when the server admission allows it", async () => {
    allowAdmission = false;
    await expect(client("tutorial-gate").create(BATTLE_PRACTICE_ROOM)).rejects.toThrow(/Finish Training Camp/);
    allowAdmission = true;
    const room = await client("tutorial-gate").create(BATTLE_PRACTICE_ROOM);
    await room.leave();
  });
});
