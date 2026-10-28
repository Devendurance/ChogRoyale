// Real Colyseus server + real SDK clients over WebSockets. Only the Privy
// verifier, player loader and commander entitlement deps are injected (no
// network auth, no DB, no real chain reads).
import { existsSync, mkdtempSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_ROOM,
  CHOG_GENESIS_CHAIN_ID,
  CHOG_GENESIS_CONTRACT,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import type { EntitlementDeps, NftCommanderRecord } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { startBattleServer } from "@/server/battle/server";
import { testLockedPatron, testPatronSource } from "@/server/battle/test-helpers";
import { BattleRoom } from "@/server/battle/room";

const PORT = 28000 + Math.floor(Math.random() * 1000);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-replays-"));
let server: Server;

const player = (id: string, onboarded = true) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: onboarded ? id : null, displayName: id, avatarId: onboarded ? "chog-1" : null, accountStatus: "active", onboardingStatus: onboarded ? "complete" : "pending" }) as unknown as Player;
const PLAYERS: Record<string, Player> = { alice: player("alice"), bob: player("bob"), newbie: player("newbie", false) };

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

// Mutable so individual tests can reshape the "chain" between calls.
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
    // token "tok-<name>" verifies as did:privy:<name>; anything else is invalid.
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
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});

const ready = (preset: string, commander: CommanderChoice = { kind: "free", class: "scout" }) => ({ cards: [...PRESETS[preset]!.cards], commander });
const nftReady = (tokenId = TOKEN) => ({ cards: [...PRESETS.swarm!.cards], commander: { kind: "nft", chainId: CHOG_GENESIS_CHAIN_ID, contract: CHOG_GENESIS_CONTRACT, tokenId } satisfies CommanderChoice });

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

async function pair(deckA = "swarm", deckB = "antiSwarm") {
  const ra = await client("tok-alice").create(BATTLE_ROOM);
  const rb = await client("tok-bob").joinById(ra.roomId);
  const a = watch(ra);
  const b = watch(rb);
  ra.send("ready", ready(deckA));
  rb.send("ready", ready(deckB));
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

  it("replays an authenticated human lobby after the initial delivery was missed", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    await new Promise((resolve) => setTimeout(resolve, 50));
    let deliveries = 0;
    let lobby: LobbyMessage | null = null;
    ra.onMessage("lobby", (m: LobbyMessage) => { deliveries += 1; lobby = m; });
    const before = deliveries;
    ra.send("lobby_sync");
    await until(() => deliveries > before);
    const replayedLobby = lobby as unknown as LobbyMessage;
    expect(replayedLobby.phase).toBe("waiting");
    expect(replayedLobby.players).toHaveLength(2);
    expect(replayedLobby.players[0]?.username).toBe("alice");
    expect(replayedLobby.players[1]?.username).toBe("");
    await ra.leave();
  });

  it("starts a server-seeded match, validates input and keeps both clients consistent", async () => {
    const { ra, rb, a, b } = await pair();
    expect(new Set([a.start!.seat, b.start!.seat])).toEqual(new Set([0, 1]));
    expect(a.start!.opponent).toBe("bob");
    expect(JSON.stringify(a.start)).not.toMatch(/"seed"/);
    // The opponent's loadout is never exposed: lobby players carry no deck or commander info.
    expect(a.start!.commander.kind).toBe("free");
    expect(JSON.stringify(a.lobby!.players)).not.toMatch(/card|commander|deck/);
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

  it("starts with two different player-built decks and unready edits before lock", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    const custom = { cards: ["choglings", "rift_runner", "chaos_archer", "sparkcaster", "boulderback", "hexwing", "frostshell"], commander: { kind: "free", class: "reaver" } satisfies CommanderChoice };
    ra.send("ready", custom);
    await until(() => a.lobby?.players.some((p) => p.username === "alice" && p.ready) ?? false);
    expect(a.lobby!.mine!.commander.class).toBe("reaver");
    ra.send("unready");
    await until(() => a.lobby?.players.every((p) => !p.ready) ?? false);
    ra.send("ready", custom);
    rb.send("ready", ready("siege", { kind: "free", class: "warden" }));
    await until(() => !!a.start && !!b.start);
    expect(a.start!.deck).toEqual([...custom.cards, "cmdr:free-reaver"]);
    expect(b.start!.deck[7]).toBe("cmdr:free-warden");
    expect(a.start!.deck.length).toBe(8);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  });

  it("rejects malformed and forged readies without seating a loadout", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    ra.send("ready", { deck: "swarm" });
    ra.send("ready", { cards: ["x"], commander: { kind: "free", class: "scout" } });
    // NFT claim from bob, who has no verified wallet holding the token.
    rb.send("ready", nftReady());
    await until(() => a.errors.length + b.errors.length >= 3);
    expect(a.errors).toContain("Malformed ready");
    expect(b.errors.some((e) => /not owned by a verified linked wallet/.test(e))).toBe(true);
    expect(b.lobby?.players.every((p) => !p.ready)).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  });

  it("fails closed at match start when ownership changed between confirm and lock", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    let calls = 0;
    const prev = chain.ownerOf;
    chain.ownerOf = async () => ({ owner: ++calls === 1 ? OWNER_ALICE : "0xthief", chainId: CHOG_GENESIS_CHAIN_ID });
    try {
      ra.send("ready", nftReady());
      await until(() => a.lobby?.players.find((p) => p.username === "alice")?.ready === true);
      rb.send("ready", ready("siege"));
      await until(() => a.errors.some((e) => e.includes("match start")));
      expect(a.errors.at(-1)).toMatch(/Commander entitlement failed at match start: .*not owned/);
      expect(a.start).toBeUndefined();
      expect(b.start).toBeUndefined();
      // The NFT player is un-readied and told why; bob stays ready.
      await until(() => a.lobby?.players.find((p) => p.username === "alice")?.ready === false);
      expect(b.lobby?.players.find((p) => p.username === "bob")?.ready).toBe(true);
    } finally {
      chain.ownerOf = prev;
    }
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  });

  it("rejects an NFT ready when the chain read times out, then accepts a free fallback", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    const prev = chain.ownerOf;
    chain.ownerOf = () => new Promise<{ owner: string; chainId: number }>(() => {});
    try {
      ra.send("ready", nftReady());
      await until(() => a.errors.some((e) => /ownership check unavailable/i.test(e)), 5_000);
    } finally {
      chain.ownerOf = prev;
    }
    ra.send("ready", ready("swarm"));
    rb.send("ready", ready("siege"));
    await until(() => !!a.start && !!b.start);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  });

  it("rejects ready messages after the match started", async () => {
    const { ra, a } = await pair();
    ra.send("ready", ready("siege"));
    await until(() => a.errors.some((e) => /Not waiting|locked/i.test(e)));
    await ra.leave().catch(() => {});
  });

  it("starts an NFT-owned loadout and only that seat sees the NFT identity", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    ra.send("ready", nftReady());
    rb.send("ready", ready("antiSwarm", { kind: "free", class: "deadeye" }));
    await until(() => !!a.start && !!b.start);
    expect(a.start!.commander).toMatchObject({ kind: "nft", tokenId: TOKEN, class: "scout", variant: "bastion", basis: "direct-owner", name: "CHOG #1462" });
    expect(a.start!.commander.verifiedAt).not.toBeNull();
    expect(a.start!.catalog[a.start!.commander.cardId]?.name).toContain("CHOG #1462");
    expect(b.start!.commander.kind).toBe("free");
    // Bob never receives alice's NFT identity: not in his start, lobby or frames.
    expect(JSON.stringify(b.start)).not.toContain("CHOG #1462");
    expect(JSON.stringify(b.start)).not.toContain(TOKEN);
    expect(JSON.stringify(b.lobby)).not.toContain("CHOG");
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  });

  it("plays a full networked match with an NFT commander to a real result with an identical replay record", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    ra.send("ready", nftReady());
    rb.send("ready", ready("siege"));
    await until(() => !!a.start && !!b.start);
    let n = 0;
    const drive = (room: Room, s: Seen) => {
      const f = s.frames.at(-1);
      if (!f || s.end) return;
      const readyA = f.abilities.find((x) => x.ready && !x.blockedBy);
      if (readyA && n % 3 === 0) room.send("cmd", { type: "ability", cid: `ab${n++}`, abilityId: readyA.abilityId });
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
    // The NFT commander was actually deployed and its abilities offered.
    expect(a.frames.flatMap((f) => f.events).some((e) => e.type === "commander_deployed")).toBe(true);
    const files = (await import("fs")).readdirSync(replayDir);
    expect(files.length).toBeGreaterThan(0);
    const rec = JSON.parse(readFileSync(path.join(replayDir, files.at(-1)!), "utf8"));
    expect(rec.replayIdentical).toBe(true);
    expect(rec.commands.length).toBe(a.end!.commands);
    expect(rec.commanders.some((c: { kind: string }) => c.kind === "nft")).toBe(true);
    expect(existsSync(replayDir)).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 120_000);

  it("plays a match with the Chog Burrow spawner and both clients see the building and scrappers identically", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    const burrowDeck = { cards: ["chog_burrow", "choglings", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt"], commander: { kind: "free", class: "warden" } satisfies CommanderChoice };
    ra.send("ready", burrowDeck);
    rb.send("ready", ready("antiSwarm"));
    await until(() => !!a.start && !!b.start);
    // The spawner is an ordinary selectable card; the scrapper is display-only.
    expect(a.start!.catalog.chog_burrow?.kind).toBe("building");
    expect(a.start!.catalog.burrow_scrapper?.name).toBe("Burrow Scrapper");
    expect(a.start!.deck).toContain("chog_burrow");
    expect(a.start!.deck).not.toContain("burrow_scrapper");
    let n = 0;
    const drive = (room: Room, s: Seen) => {
      const f = s.frames.at(-1);
      if (!f || s.end) return;
      const readyA = f.abilities.find((x) => x.ready && !x.blockedBy);
      if (readyA && n % 3 === 0) room.send("cmd", { type: "ability", cid: `ab${n++}`, abilityId: readyA.abilityId });
      const y = s.start!.seat === 0 ? 60 : 100;
      // Prioritize the burrow so the test always exercises the spawner.
      const pick = f.hand.find((c) => c === "chog_burrow" && f.energy >= 4)
        ?? f.hand.find((c) => {
          const k = s.start!.catalog[c]!;
          return (k.kind === "troop" || k.kind === "commander" || k.kind === "building") && k.cost <= f.energy;
        });
      if (pick && f.tick % 15 === 0) room.send("cmd", { type: "deploy", cid: `d${n++}`, cardId: pick, x: n % 2 ? 30 : 70, y });
    };
    const lastTick = { a: -1, b: -1 };
    await until(() => {
      const fa = a.frames.at(-1);
      const fb = b.frames.at(-1);
      if (fa && fa.tick !== lastTick.a) { lastTick.a = fa.tick; drive(ra, a); }
      if (fb && fb.tick !== lastTick.b) { lastTick.b = fb.tick; drive(rb, b); }
      return !!a.end && !!b.end;
    }, 90_000);
    // A burrow was placed and scrappers appeared as ordinary troop views.
    expect(a.frames.some((f) => f.buildings.some((x) => x.cardId === "chog_burrow"))).toBe(true);
    expect(a.frames.some((f) => f.troops.some((t) => t.cardId === "burrow_scrapper"))).toBe(true);
    const spawnEvents = a.frames.flatMap((f) => f.events).filter((e) => e.type === "unit_spawned" || e.type === "spawn_skipped");
    expect(spawnEvents.length).toBeGreaterThan(0);
    // Shared ticks render identically on both screens, scrappers included.
    const byTick = new Map(b.frames.map((f) => [f.tick, f]));
    const shared = a.frames.filter((f) => byTick.has(f.tick)).slice(-10);
    expect(shared.length).toBeGreaterThan(0);
    for (const f of shared) {
      const g = byTick.get(f.tick)!;
      expect(f.troops).toEqual(g.troops);
      expect(f.buildings).toEqual(g.buildings);
    }
    // Spawner buildings expose the wave countdown on both views.
    const withTimer = a.frames.flatMap((f) => f.buildings).find((x) => x.cardId === "chog_burrow" && x.nextSpawnAt !== undefined);
    expect(withTimer?.spawnsLeft).toBeGreaterThanOrEqual(0);
    expect(a.end!.stateHash).toBe(b.end!.stateHash);
    expect(a.end!.replayIdentical).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 120_000);

  it("plays a match with the Rift Mortar and both clients see siege_fired and shell impacts identically", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    const mortarDeck = { cards: ["rift_mortar", "choglings", "chaos_archer", "sparkcaster", "hexwing", "rift_snare", "chaos_bolt"], commander: { kind: "free", class: "warden" } satisfies CommanderChoice };
    ra.send("ready", mortarDeck);
    rb.send("ready", ready("antiSwarm"));
    await until(() => !!a.start && !!b.start);
    expect(a.start!.catalog.rift_mortar?.kind).toBe("building");
    expect(a.start!.deck).toContain("rift_mortar");
    let n = 0;
    const drive = (room: Room, s: Seen) => {
      const f = s.frames.at(-1);
      if (!f || s.end) return;
      const readyA = f.abilities.find((x) => x.ready && !x.blockedBy);
      if (readyA && n % 3 === 0) room.send("cmd", { type: "ability", cid: `ab${n++}`, abilityId: readyA.abilityId });
      // Mortars need river-side cells to reach the enemy lane towers.
      const y = s.start!.seat === 0 ? 68 : 92;
      const pick = f.hand.find((c) => c === "rift_mortar" && f.energy >= 5)
        ?? f.hand.find((c) => {
          const k = s.start!.catalog[c]!;
          return (k.kind === "troop" || k.kind === "commander" || k.kind === "building") && k.cost <= f.energy;
        });
      // x 40/60 sit between bridge and ford mouth spans but still reach a lane tower.
      if (pick && f.tick % 15 === 0) room.send("cmd", { type: "deploy", cid: `d${n++}`, cardId: pick, x: n % 2 ? 40 : 60, y });
    };
    const lastTick = { a: -1, b: -1 };
    await until(() => {
      const fa = a.frames.at(-1);
      const fb = b.frames.at(-1);
      if (fa && fa.tick !== lastTick.a) { lastTick.a = fa.tick; drive(ra, a); }
      if (fb && fb.tick !== lastTick.b) { lastTick.b = fb.tick; drive(rb, b); }
      return !!a.end && !!b.end;
    }, 90_000);
    expect(a.frames.some((f) => f.buildings.some((x) => x.cardId === "rift_mortar"))).toBe(true);
    const events = a.frames.flatMap((f) => f.events);
    const fired = events.filter((e) => e.type === "siege_fired");
    const impacts = events.filter((e) => e.type === "spell_impact" && e.cardId === "rift_mortar");
    expect(fired.length).toBeGreaterThan(0);
    expect(impacts.length).toBeGreaterThan(0);
    // Shared ticks render identically on both screens, mortar and shells included.
    const byTick = new Map(b.frames.map((f) => [f.tick, f]));
    const shared = a.frames.filter((f) => byTick.has(f.tick)).slice(-10);
    expect(shared.length).toBeGreaterThan(0);
    for (const f of shared) {
      const g = byTick.get(f.tick)!;
      expect(f.buildings).toEqual(g.buildings);
      expect(f.impacts).toEqual(g.impacts);
      expect(f.events).toEqual(g.events);
    }
    // In-flight shells show up in the impact views with the shell radius.
    const shellViews = a.frames.flatMap((f) => f.impacts).filter((i) => i.cardId === "rift_mortar");
    expect(shellViews.every((i) => i.radius === 4)).toBe(true);
    expect(a.end!.stateHash).toBe(b.end!.stateHash);
    expect(a.end!.replayIdentical).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 120_000);

  it("locks an authentic patron, shows it in start, and plays identical chaos on both clients", async () => {
    const ra = await client("tok-alice").create(BATTLE_ROOM);
    const rb = await client("tok-bob").joinById(ra.roomId);
    const a = watch(ra);
    const b = watch(rb);
    ra.send("ready", ready("swarm"));
    rb.send("ready", ready("antiSwarm"));
    await until(() => !!a.start && !!b.start);
    expect(a.start!.patron.tokenId).toBe(testLockedPatron().tokenId);
    expect(a.start!.patron.name).toBe(`CHOG #${testLockedPatron().tokenId}`);
    expect(a.start!.patron).toEqual(b.start!.patron);
    let n = 0;
    const drive = (room: Room, s: Seen) => {
      const f = s.frames.at(-1);
      if (!f || s.end) return;
      const pick = f.hand.find((c) => s.start!.catalog[c]!.cost <= f.energy);
      if (pick && f.tick % 15 === 0) room.send("cmd", { type: "deploy", cid: `d${n++}`, cardId: pick, x: 50, y: s.start!.seat === 0 ? 60 : 100 });
    };
    const lastTick = { a: -1, b: -1 };
    await until(() => {
      const fa = a.frames.at(-1);
      const fb = b.frames.at(-1);
      if (fa && fa.tick !== lastTick.a) { lastTick.a = fa.tick; drive(ra, a); }
      if (fb && fb.tick !== lastTick.b) { lastTick.b = fb.tick; drive(rb, b); }
      return !!a.end && !!b.end;
    }, 90_000);
    // The locked patron drives identical Chaos views on both clients.
    const byTick = new Map(b.frames.map((f) => [f.tick, f]));
    const shared = a.frames.filter((f) => byTick.has(f.tick));
    for (const f of shared) expect(f.chaos).toEqual(byTick.get(f.tick)!.chaos);
    expect(a.frames.some((f) => f.chaos.length > 0)).toBe(true);
    expect(a.end!.stateHash).toBe(b.end!.stateHash);
    expect(a.end!.replayIdentical).toBe(true);
    await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
  }, 120_000);

  it("does not start when no authentic patron is available", async () => {
    const held = BattleRoom.deps.patrons;
    BattleRoom.deps.patrons = testPatronSource(null);
    try {
      const ra = await client("tok-alice").create(BATTLE_ROOM);
      const rb = await client("tok-bob").joinById(ra.roomId);
      const a = watch(ra);
      const b = watch(rb);
      ra.send("ready", ready("swarm"));
      rb.send("ready", ready("antiSwarm"));
      await until(() => a.errors.length > 0 && b.errors.length > 0);
      expect(a.errors).toContain("No authentic Arena Patron available, match cannot start");
      expect(b.errors).toContain("No authentic Arena Patron available, match cannot start");
      expect(a.start).toBeUndefined();
      await until(() => !!a.lobby && a.lobby.players.every((p) => !p.ready));
      await Promise.all([ra.leave().catch(() => {}), rb.leave().catch(() => {})]);
    } finally {
      BattleRoom.deps.patrons = held;
    }
  }, 60_000);
});
