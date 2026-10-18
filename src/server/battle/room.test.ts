// Real Colyseus server + real SDK clients over WebSockets. Only the Privy
// verifier and player loader are injected (no network auth, no DB).
import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import { BATTLE_ROOM, type AckMessage, type BattleFrame, type EndMessage, type StartMessage } from "@/lib/battle-protocol";
import { startBattleServer } from "@/server/battle/server";

const PORT = 28000 + Math.floor(Math.random() * 1000);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-replays-"));
let server: Server;

const player = (id: string, onboarded = true) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: onboarded ? id : null, displayName: id, avatarId: onboarded ? "chog-1" : null, accountStatus: "active", onboardingStatus: onboarded ? "complete" : "pending" }) as unknown as Player;
const PLAYERS: Record<string, Player> = { alice: player("alice"), bob: player("bob"), newbie: player("newbie", false) };

beforeAll(async () => {
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(PORT, {
    // token "tok-<name>" verifies as did:privy:<name>; anything else is invalid.
    verifier: async (t) => {
      if (!t.startsWith("tok-")) throw new Error("bad token");
      return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
    },
    loader: async (did) => PLAYERS[did.replace("did:privy:", "")] ?? null,
    tickMs: 2,
    replayDir,
    closeAfterMs: 50,
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});

interface Seen {
  start?: StartMessage;
  frames: BattleFrame[];
  acks: AckMessage[];
  end?: EndMessage;
  aborted?: string;
}
function watch(room: Room): Seen {
  const seen: Seen = { frames: [], acks: [] };
  room.onMessage("start", (m: StartMessage) => (seen.start = m));
  room.onMessage("frame", (f: BattleFrame) => seen.frames.push(f));
  room.onMessage("ack", (a: AckMessage) => seen.acks.push(a));
  room.onMessage("end", (e: EndMessage) => (seen.end = e));
  room.onMessage("aborted", (a: { reason: string }) => (seen.aborted = a.reason));
  room.onMessage("lobby", () => {});
  room.onMessage("error", () => {});
  return seen;
}
const until = async (cond: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function pair(deckA = "swarm", deckB = "antiSwarm") {
  const ra = await client("tok-alice").create(BATTLE_ROOM);
  const rb = await client("tok-bob").joinById(ra.roomId);
  const a = watch(ra);
  const b = watch(rb);
  ra.send("ready", { deck: deckA });
  rb.send("ready", { deck: deckB });
  await until(() => !!a.start && !!b.start);
  return { ra, rb, a, b };
}

describe("B3.1 Colyseus battle room", () => {
  it("rejects missing, invalid and not-onboarded identities before seating", async () => {
    await expect(client().create(BATTLE_ROOM)).rejects.toThrow(/Authentication required/);
    await expect(client("forged").create(BATTLE_ROOM)).rejects.toThrow(/Invalid or expired/);
    await expect(client("tok-ghost").create(BATTLE_ROOM)).rejects.toThrow(/not provisioned/);
    await expect(client("tok-newbie").create(BATTLE_ROOM)).rejects.toThrow(/onboarding/);
  });

  it("never seats the same player twice", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    await expect(client("tok-alice").joinById(ra.roomId)).rejects.toThrow(/already seated/);
    await ra.leave();
  });

  it("starts a server-seeded match, validates input and keeps both clients consistent", async () => {
    const { ra, rb, a, b } = await pair();
    expect(new Set([a.start!.seat, b.start!.seat])).toEqual(new Set([0, 1]));
    expect(a.start!.opponent).toBe("bob");
    expect(JSON.stringify(a.start)).not.toMatch(/"seed"/);
    await until(() => a.frames.length > 5 && b.frames.length > 5);
    const mine = (s: Seen) => s.frames.at(-1)!;
    // Spell-free legal deploy: own lane, own territory.
    const deployY = (s: Seen) => (s.start!.seat === 0 ? 60 : 100);
    await until(() => mine(a).energy >= 5);
    const card = (s: Seen) => mine(s).hand.find((c) => s.start!.catalog[c]!.kind === "troop" && s.start!.catalog[c]!.cost <= mine(s).energy)!;
    const ca = card(a);
    ra.send("cmd", { type: "deploy", cid: "a1", cardId: ca, x: 30, y: deployY(a) });
    ra.send("cmd", { type: "deploy", cid: "a1", cardId: ca, x: 30, y: deployY(a) });
    rb.send("cmd", { type: "deploy", cid: "b1", cardId: card(b), x: 70, y: deployY(b) });
    rb.send("cmd", { type: "deploy", cid: "b2", cardId: mine(b).hand[0]!, x: 50, y: deployY(a) });
    rb.send("cmd", { type: "deploy", cid: "b3", cardId: "boulderback", x: 50, y: deployY(b), player: 0 });
    await until(() => a.acks.length >= 2 && b.acks.length >= 3);
    expect(a.acks.find((x) => x.cid === "a1" && x.ok)).toBeTruthy();
    expect(a.acks.find((x) => x.cid === "a1" && !x.ok)?.reason).toBe("Duplicate command");
    expect(b.acks.find((x) => x.cid === "b1")?.ok).toBe(true);
    expect(b.acks.find((x) => x.cid === "b2")?.ok).toBe(false);
    expect(b.acks.find((x) => x.cid === "b3")?.reason).toBe("Malformed command");
    await until(() => mine(a).troops.length >= 2 && mine(b).troops.length >= 2);
    // Same authoritative tick renders identically on both screens.
    const byTick = new Map(b.frames.map((f) => [f.tick, f]));
    const shared = a.frames.filter((f) => byTick.has(f.tick)).slice(-10);
    expect(shared.length).toBeGreaterThan(0);
    for (const f of shared) {
      const g = byTick.get(f.tick)!;
      expect(f.troops).toEqual(g.troops);
      expect(f.structures).toEqual(g.structures);
    }
    expect(mine(a).hand).not.toEqual(mine(b).hand);
    await ra.leave();
    await until(() => !!b.aborted);
    expect(b.aborted).toMatch(/No result recorded/);
    expect(b.end).toBeUndefined();
    await rb.leave().catch(() => {});
  });

  it("plays a full networked match to a real result with an identical replay record", async () => {
    const { ra, rb, a, b } = await pair("swarm", "siege");
    let n = 0;
    const drive = (room: Room, s: Seen) => {
      const f = s.frames.at(-1);
      if (!f || s.end) return;
      const ready = f.abilities.find((x) => x.ready && !x.blockedBy);
      if (ready && n % 3 === 0) room.send("cmd", { type: "ability", cid: `ab${n++}`, abilityId: ready.abilityId });
      const pick = f.hand.find((c) => {
        const k = s.start!.catalog[c]!;
        return (k.kind === "troop" || k.kind === "commander") && k.cost <= f.energy;
      });
      if (pick && f.tick % 15 === 0) room.send("cmd", { type: "deploy", cid: `d${n++}`, cardId: pick, x: n % 2 ? 30 : 70, y: s.start!.seat === 0 ? 60 : 100 });
    };
    const lastTick = { a: -1, b: -1 };
    await until(() => {
      const fa = a.frames.at(-1);
      const fb = b.frames.at(-1);
      if (fa && fa.tick !== lastTick.a) {
        lastTick.a = fa.tick;
        drive(ra, a);
      }
      if (fb && fb.tick !== lastTick.b) {
        lastTick.b = fb.tick;
        drive(rb, b);
      }
      return !!a.end && !!b.end;
    }, 90_000);
    expect(a.end!.stateHash).toBe(b.end!.stateHash);
    expect(a.end!.replayIdentical).toBe(true);
    expect([a.end!.result, b.end!.result].sort()).toEqual(a.end!.result === "draw" ? ["draw", "draw"] : ["loss", "win"]);
    expect(a.acks.filter((x) => x.ok).length + b.acks.filter((x) => x.ok).length).toBeGreaterThan(10);
    expect(a.frames.some((f) => f.structures.some((s) => s.hp < s.maxHp))).toBe(true);
    expect(a.frames.flatMap((f) => f.events).some((e) => e.type === "ability_fired" && e.trigger === "active")).toBe(true);
    const files = (await import("fs")).readdirSync(replayDir);
    expect(files.length).toBeGreaterThan(0);
    const rec = JSON.parse(readFileSync(path.join(replayDir, files[0]!), "utf8"));
    expect(rec.replayIdentical).toBe(true);
    expect(rec.commands.length).toBe(a.end!.commands);
    expect(existsSync(replayDir)).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 120_000);
});
