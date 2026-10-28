// V2.1g live wiring: fallback rooms with the rewards flag OFF send no
// bot_gold message and write nothing; with the flag ON a completed fallback
// match pays confirmed Gold once. Real Colyseus server + TEST DB.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

import { eq } from "drizzle-orm";
import { Client } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_QUEUE_ROOM,
  type BattleFrame,
  type BotGoldMessage,
  type EndMessage,
  type LobbyMessage,
  type MatchFoundMessage,

  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { inArray } from "drizzle-orm";

const PORT = 28300 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-botgold-flag-"));
let server: Server;
const PORT2 = 28400 + Math.floor(Math.random() * 200);
const URL2_ = `http://127.0.0.1:${PORT2}`;
const replayDir2 = mkdtempSync(path.join(os.tmpdir(), "chog-botgold-flag-on-"));
let serverOn: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;
const PLAYERS: Record<string, Player> = { flagoff: player("flagoff"), flagon: player("flagon") };

function nftRow(tokenId: string, cls: CommanderClass = "scout"): Commander {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    id: "cmdr-row", nftId: "nft-row", rulesetVersion: "v1", tokenId: tokenId, class: cls, affinity: cls,
    stats: t.stats, abilities: t.abilities, variant: "bastion", prestige: "Mythic", sourceTraits: [],
    unmatchedTraits: [], scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 },
    powerScore: t.powerScore, contentHash: `hash-${tokenId}`, derivationCount: 1, derivedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), previousContentHash: null,
  } as unknown as Commander;
}

const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => ({ owner: "0x0", chainId: 143 }),
  loadNftCommander: async (tokenId) => ({ tokenId, name: `CHOG #${tokenId}`, imageOriginal: null, commander: nftRow(tokenId) }),
  timeoutMs: 60,
};

beforeAll(async () => {
  routeDalToTestDb();
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  server = await startBattleServer(
    PORT,
    {
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
      reconnectGraceMs: 5_000,
      unrankedFallback: { enabled: true, delayMs: 400, maxRooms: 8 },
      // NOTE: no botGold dep here; the flag-ON case boots its own server below.
    },
    "127.0.0.1"
  );
  serverOn = await startBattleServer(
    PORT2,
    {
      verifier: async (t) => {
        if (!t.startsWith("tok-")) throw new Error("bad token");
        return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
      },
      loader: async (did) => PLAYERS[did.replace("did:privy:", "")] ?? null,
      entitlement,
      patrons: testPatronSource(),
      tickMs: 2,
      replayDir: replayDir2,
      closeAfterMs: 50,
      reconnectGraceMs: 5_000,
      unrankedFallback: { enabled: true, delayMs: 400, maxRooms: 8 },
      botGold: { enabled: true },
    },
    "127.0.0.1"
  );
  // The flag-ON human must be a real DB player (award FK), keeping the same Privy DID.
  const provisioned = await provisionPlayer({ privyDid: "did:privy:flagon" });
  livePlayerIds.push(provisioned.id);
  PLAYERS.flagon = { ...PLAYERS.flagon!, id: provisioned.id };
});
const liveMatchIds: string[] = [];
const livePlayerIds: string[] = [];

afterAll(async () => {
  await server?.gracefullyShutdown(false);
  await serverOn?.gracefullyShutdown(false);
  const db = getDb();
  const { botGoldAwards, botMatches } = await import("@/db/schema");
  if (liveMatchIds.length > 0) {
    await db.delete(botGoldAwards).where(inArray(botGoldAwards.matchId, liveMatchIds));
    await db.delete(botMatches).where(inArray(botMatches.matchId, liveMatchIds));
  }
  if (livePlayerIds.length > 0) {
    const { players } = await import("@/db/schema");
    await db.delete(players).where(inArray(players.id, livePlayerIds));
  }
  resetDbCache();
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const until = async (cond: () => boolean, ms = 30_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("V2.1g flag OFF fallback stays silent and writeless", () => {
  it("completes a fallback match with no bot_gold message and no bot rows", async () => {
    const c = client("tok-flagoff");
    const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
    let found: MatchFoundMessage | null = null;
    q.onMessage("match_found", (m: MatchFoundMessage) => (found = m));
    await until(() => found !== null);
    expect(found!.fallback?.source).toBe("unranked-fallback");
    await q.leave().catch(() => {});
    const room = await c.consumeSeatReservation(found!.reservation);
    let lobby: LobbyMessage | null = null;
    let start: StartMessage | null = null;
    let end: EndMessage | null = null;
    let botGold: BotGoldMessage | null = null;
    let lastFrame: BattleFrame | null = null;
    room.onMessage("lobby", (m: LobbyMessage) => (lobby = m));
    room.onMessage("start", (m: StartMessage) => (start = m));
    room.onMessage("end", (m: EndMessage) => (end = m));
    room.onMessage("bot_gold", (m: BotGoldMessage) => (botGold = m));
    room.onMessage("frame", (m: BattleFrame) => (lastFrame = m));
    await until(() => lobby !== null);
    room.send("ready", { cards: [...PRESETS.swarm!.cards], commander: { kind: "free", class: "scout" } });
    await until(() => start !== null);
    // Drive the human so the game ends by core quickly.
    let lastDrive = -1;
    await until(() => {
      const f = lastFrame;
      if (f && !end && f.tick !== lastDrive && f.tick % 25 === 0) {
        lastDrive = f.tick;
        const pick = f.hand.find((c) => start!.catalog[c]!.kind === "troop" && start!.catalog[c]!.cost <= f.energy);
        if (pick) room.send("cmd", { type: "deploy", cid: `drive-${f.tick}`, cardId: pick, x: 30, y: start!.seat === 0 ? 60 : 100 });
      }
      return !!end;
    }, 170_000);
    expect(["win", "loss", "draw"]).toContain(end!.result);
    // Flag OFF: no bot_gold message ever arrives, and nothing is stored.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(botGold).toBeNull();
    const db = getDb();
    const { botMatches, botGoldAwards } = await import("@/db/schema");
    expect(await db.select().from(botMatches).where(eq(botMatches.matchId, end!.matchId!))).toEqual([]);
    expect(await db.select().from(botGoldAwards).where(eq(botGoldAwards.matchId, end!.matchId!))).toEqual([]);
    await room.leave().catch(() => {});
  }, 180_000);
});

describe("V2.1g flag ON fallback pays confirmed Gold once", () => {
  it("sends bot_gold confirmed and stores one spendable award", async () => {
    const c = new Client(URL2_, { headers: { authorization: "Bearer tok-flagon" } });
    const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
    let found: MatchFoundMessage | null = null;
    q.onMessage("match_found", (m: MatchFoundMessage) => (found = m));
    await until(() => found !== null);
    expect(found!.fallback?.source).toBe("unranked-fallback");
    await q.leave().catch(() => {});
    const room = await c.consumeSeatReservation(found!.reservation);
    let lobby: LobbyMessage | null = null;
    let start: StartMessage | null = null;
    let end: EndMessage | null = null;
    let botGold: BotGoldMessage | null = null;
    let lastFrame: BattleFrame | null = null;
    room.onMessage("lobby", (m: LobbyMessage) => (lobby = m));
    room.onMessage("start", (m: StartMessage) => (start = m));
    room.onMessage("end", (m: EndMessage) => (end = m));
    room.onMessage("bot_gold", (m: BotGoldMessage) => (botGold = m));
    room.onMessage("frame", (m: BattleFrame) => (lastFrame = m));
    await until(() => lobby !== null);
    room.send("ready", { cards: [...PRESETS.swarm!.cards], commander: { kind: "free", class: "scout" } });
    await until(() => start !== null);
    let lastDrive = -1;
    await until(() => {
      const f = lastFrame;
      if (f && !end && f.tick !== lastDrive && f.tick % 25 === 0) {
        lastDrive = f.tick;
        const pick = f.hand.find((cc) => start!.catalog[cc]!.kind === "troop" && start!.catalog[cc]!.cost <= f.energy);
        if (pick) room.send("cmd", { type: "deploy", cid: `drive-${f.tick}`, cardId: pick, x: 30, y: start!.seat === 0 ? 60 : 100 });
      }
      return !!end;
    }, 170_000);
    expect(["win", "loss", "draw"]).toContain(end!.result);
    liveMatchIds.push(end!.matchId!);
    await until(() => botGold !== null, 30_000);
    expect(botGold!.source).toBe("unranked-fallback");
    expect(botGold!.status).toBe("confirmed");
    expect(botGold!.policyVersion).toBe(1);
    expect([20, 10, 15]).toContain(botGold!.amount);
    expect(botGold!.rewardedToday).toBe(1);
    expect(botGold!.dailyCap).toBe(5);
    const db = getDb();
    const { botGoldAwards, botMatches } = await import("@/db/schema");
    const awards = await db.select().from(botGoldAwards).where(eq(botGoldAwards.matchId, end!.matchId!));
    expect(awards).toHaveLength(1);
    expect(Number(awards[0]!.amount)).toBe(botGold!.amount);
    const ev = await db.select().from(botMatches).where(eq(botMatches.matchId, end!.matchId!));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.status).toBe("awarded");
    const { getGoldTotals } = await import("@/db/gold");
    expect((await getGoldTotals(PLAYERS.flagon!.id)).balance).toBe(botGold!.amount);
    await room.leave().catch(() => {});
  }, 240_000);
});
