// V2.1e live handoff: unranked queue -> server-assigned bot room over real
// Colyseus WS with injected deps. Verifies match_found provenance,
// reservation consumption into battle_practice, fallback identity in
// lobby/start, forged-key rejection, and cleanup. No DB, no PROD.

import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_PRACTICE_ROOM,
  BATTLE_QUEUE_ROOM,
  type LobbyMessage,
  type MatchFoundMessage,
  type QueueStatusMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 28200 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-fb-live-"));
let server: Server;

const player = (id: string) =>
  ({ id, privyDid: `did:privy:${id}`, username: id, usernameKey: id, displayName: id, avatarId: "chog-1", accountStatus: "active", onboardingStatus: "complete" }) as unknown as Player;
const PLAYERS: Record<string, Player> = { alice: player("alice"), bob: player("bob"), carol: player("carol") };

function nftRow(tokenId: string, cls: CommanderClass = "scout"): Commander {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    id: "cmdr-row", nftId: "nft-row", rulesetVersion: "v1", tokenId: tokenId, class: cls, affinity: cls,
    stats: t.stats, abilities: t.abilities, variant: "bastion", prestige: "Mythic", sourceTraits: [],
    unmatchedTraits: [], scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 },
    powerScore: t.powerScore, contentHash: `hash-${tokenId}`, previousContentHash: null,
    derivationCount: 1, derivedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Commander;
}

const entitlement: EntitlementDeps = {
  verifiedWallets: async () => [],
  ownerOf: async () => ({ owner: "0x0", chainId: 143 }),
  loadNftCommander: async (tokenId) => ({ tokenId, name: `CHOG #${tokenId}`, imageOriginal: null, commander: nftRow(tokenId) }),
  timeoutMs: 60,
};

beforeAll(async () => {
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
      unrankedFallback: { enabled: true, delayMs: 500, maxRooms: 8 },
    },
    "127.0.0.1"
  );
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const until = async (cond: () => boolean, ms = 30_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("V2.1e fallback handoff", () => {
  it("queue assigns a bot with provenance and the room identifies the fallback source", async () => {
    const c = client("tok-alice");
    const q = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
    let status: QueueStatusMessage | null = null;
    let found: MatchFoundMessage | null = null;
    q.onMessage("queue_status", (m: QueueStatusMessage) => (status = m));
    q.onMessage("match_found", (m: MatchFoundMessage) => (found = m));
    await until(() => status !== null);
    expect(status!.fallback).toEqual({ scheduledInMs: 500 });
    await until(() => found !== null);
    expect(found!.opponent).toBe("AI Opponent");
    expect(found!.mode).toBe("unranked");
    expect(found!.fallback?.source).toBe("unranked-fallback");
    expect(["medium", "hard"]).toContain(found!.fallback!.difficulty);
    await q.leave().catch(() => {});
    const room = await c.consumeSeatReservation(found!.reservation);
    let lobby: LobbyMessage | null = null;
    let start: StartMessage | null = null;
    room.onMessage("lobby", (m: LobbyMessage) => (lobby = m));
    room.onMessage("start", (m: StartMessage) => (start = m));
    await until(() => lobby !== null);
    expect(lobby!.players).toHaveLength(1);
    expect(lobby!.practice?.opponent.kind).toBe("bot");
    expect(lobby!.practice?.opponent.source).toBe("unranked-fallback");
    expect(lobby!.practice?.opponent.displayName).toBe("AI Opponent");
    room.send("ready", { cards: [...PRESETS.swarm!.cards], commander: { kind: "free", class: "scout" } });
    await until(() => start !== null);
    expect(start!.mode).toBe("practice");
    expect(start!.opponentKind).toBe("bot");
    expect(start!.practiceOpponent?.source).toBe("unranked-fallback");
    expect(start!.practiceOpponent?.botId).toBe(found!.fallback!.botId);
    expect(start!.practiceOpponent?.difficulty).toBe(found!.fallback!.difficulty);
    // Leaving frees the seat: no stuck activity after a fallback match.
    await room.leave();
    const q2 = await c.joinOrCreate(BATTLE_QUEUE_ROOM);
    let status2: QueueStatusMessage | null = null;
    q2.onMessage("queue_status", (m: QueueStatusMessage) => (status2 = m));
    await until(() => status2 !== null);
    expect(status2!.state).toBe("searching");
    await q2.leave().catch(() => {});
  });

  it("rejects forged fallback keys and keeps solo practice working", async () => {
    await expect(client("tok-bob").create(BATTLE_PRACTICE_ROOM, { fallbackKey: "forged-key" })).rejects.toThrow(/Unknown or expired fallback/);
    const r = await client("tok-carol").create(BATTLE_PRACTICE_ROOM);
    let lobby: LobbyMessage | null = null;
    r.onMessage("lobby", (m: LobbyMessage) => (lobby = m));
    await until(() => lobby !== null);
    expect(lobby!.practice?.opponent.source).toBe("practice");
    await r.leave().catch(() => {});
  });
});
