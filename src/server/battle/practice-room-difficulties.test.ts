// V2.1c Practice room lifecycle over real Colyseus WS with injected deps.
// Proves difficulty selection, identity through lobby/start/reconnect,
// duplicate-battle protection, no-reward end, and cleanup. No DB, no PROD.

import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import type { Player } from "@/db/schema";
import {
  BATTLE_PRACTICE_ROOM,
  type AckMessage,
  type BattleFrame,
  type CommanderChoice,
  type EndMessage,
  type LobbyMessage,
  type PracticeDifficulty,
  type PresenceMessage,
  type SettlementMessage,
  type StartMessage,
} from "@/lib/battle-protocol";
import { PRESETS } from "@/server/battle/session";
import type { EntitlementDeps } from "@/server/battle/entitlement";
import type { Commander } from "@/db/schema";
import { freeCommanderTemplates, type CommanderClass } from "@/lib/commanders";
import { startBattleServer } from "@/server/battle/server";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 28100 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-practice-diff-"));
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
    reconnectGraceMs: 5_000,
  });
});
afterAll(async () => {
  await server?.gracefullyShutdown(false);
});

const client = (token?: string) => new Client(URL_, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const ready = (preset = "swarm", commander: CommanderChoice = { kind: "free", class: "scout" }) => ({ cards: [...PRESETS[preset]!.cards], commander });

interface Seen {
  start?: StartMessage;
  starts: StartMessage[];
  lobby?: LobbyMessage;
  errors: string[];
  frames: BattleFrame[];
  acks: AckMessage[];
  end?: EndMessage;
  aborted?: string;
  settlement?: SettlementMessage;
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
  room.onMessage("settlement", (s: SettlementMessage) => (seen.settlement = s));
  room.onMessage("presence", (p: PresenceMessage) => seen.presence.push(p));
  room.onMessage("error", (e: { reason: string }) => seen.errors.push(e.reason));
  return seen;
}
/** joinById can bounce off a transiently locked room while the dropped socket frees; retry. */
async function resumeAttempt(c: Client, roomId: string, token: string, ms = 8_000): Promise<Room> {
  const t0 = Date.now();
  for (;;) {
    try {
      return await c.joinById(roomId, { resume: token });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/locked|full/i.test(msg) && Date.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      throw e;
    }
  }
}
const until = async (cond: () => boolean, ms = 30_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("V2.1c practice rooms", () => {
  it("defaults to Medium with honest AI identity and no bot players row", async () => {
    const r = await client("tok-alice").create(BATTLE_PRACTICE_ROOM);
    const s = watch(r);
    await until(() => !!s.lobby);
    expect(s.lobby!.players).toHaveLength(1);
    expect(s.lobby!.players[0]).toEqual({ username: "alice", ready: false });
    expect(s.lobby!.practice?.opponent).toEqual({ kind: "bot", botId: "practice-medium-v1", difficulty: "medium", displayName: "AI Opponent", source: "practice" });
    expect(s.lobby!.match?.mode).toBe("practice");
    r.send("ready", ready());
    await until(() => !!s.start);
    expect(s.start!.mode).toBe("practice");
    expect(s.start!.opponentKind).toBe("bot");
    expect(s.start!.practiceOpponent).toEqual({ kind: "bot", botId: "practice-medium-v1", difficulty: "medium", displayName: "AI Opponent", source: "practice" });
    expect(s.start!.opponent).toBe("AI Opponent");
    await r.leave();
  });

  it("creates Hard and Ultimate rooms with distinct identities simultaneously", async () => {
    const rh = await client("tok-alice").create(BATTLE_PRACTICE_ROOM, { difficulty: "hard" satisfies PracticeDifficulty });
    const sh = watch(rh);
    const ru = await client("tok-bob").create(BATTLE_PRACTICE_ROOM, { difficulty: "ultimate" satisfies PracticeDifficulty });
    const su = watch(ru);
    await until(() => !!sh.lobby && !!su.lobby);
    expect(sh.lobby!.practice?.opponent.botId).toBe("practice-hard-v1");
    expect(su.lobby!.practice?.opponent.botId).toBe("practice-ultimate-v1");
    expect(sh.lobby!.practice?.opponent.difficulty).toBe("hard");
    expect(su.lobby!.practice?.opponent.difficulty).toBe("ultimate");
    rh.send("ready", ready());
    ru.send("ready", ready("control"));
    await until(() => !!sh.start && !!su.start);
    expect(sh.start!.practiceOpponent?.botId).toBe("practice-hard-v1");
    expect(su.start!.practiceOpponent?.botId).toBe("practice-ultimate-v1");
    await until(() => sh.frames.length > 3 && su.frames.length > 3);
    await rh.leave();
    await ru.leave();
  });

  it("rejects unsupported difficulties server-side", async () => {
    await expect(client("tok-carol").create(BATTLE_PRACTICE_ROOM, { difficulty: "easy" })).rejects.toThrow(/Unsupported practice difficulty/);
    await expect(client("tok-carol").create(BATTLE_PRACTICE_ROOM, { difficulty: "HARD" })).rejects.toThrow(/Unsupported practice difficulty/);
  });

  it("blocks a second live battle, preserves Hard through reconnect, ends with no reward and frees the seat", { timeout: 180_000 }, async () => {
    const c = client("tok-carol");
    const r = await c.create(BATTLE_PRACTICE_ROOM, { difficulty: "hard" });
    const s = watch(r);
    r.send("ready", ready());
    await until(() => !!s.start && s.frames.length > 3);
    // Duplicate protection while the first battle is live.
    await expect(c.create(BATTLE_PRACTICE_ROOM, { difficulty: "medium" })).rejects.toThrow(/Already in a battle/);
    // Unconsented drop then resume with the rotating token.
    const token = s.start!.resumeToken;
    const roomId = r.roomId;
    await r.leave(false);
    const r2 = await resumeAttempt(c, roomId, token);
    const s2 = watch(r2);
    await until(() => s2.starts.length > 0);
    expect(s2.start!.resumed).toBe(true);
    expect(s2.start!.opponentKind).toBe("bot");
    expect(s2.start!.practiceOpponent).toEqual({ kind: "bot", botId: "practice-hard-v1", difficulty: "hard", displayName: "AI Opponent", source: "practice" });
    // Idle human: the Hard bot plays alone until a true result.
    // Drive occasional human deploys so the game ends by core rather than timeout.
    let lastDrive = -1;
    await until(() => {
      const f = s2.frames.at(-1);
      if (f && !s2.end && f.tick !== lastDrive && f.tick % 25 === 0) {
        lastDrive = f.tick;
        const pick = f.hand.find((c) => s2.start!.catalog[c]!.kind === "troop" && s2.start!.catalog[c]!.cost <= f.energy);
        if (pick) r2.send("cmd", { type: "deploy", cid: `drive-${f.tick}`, cardId: pick, x: 30, y: s2.start!.seat === 0 ? 60 : 100 });
      }
      return !!s2.end;
    }, 170_000);
    expect(["win", "loss", "draw"]).toContain(s2.end!.result);
    expect(s2.end!.practice).toEqual({ opponentKind: "bot", noReward: true, source: "practice" });
    expect(s2.end!.matchId).toBeTruthy();
    await until(() => !!s2.settlement);
    expect(s2.settlement!.status).toBe("disabled");
    await r2.leave().catch(() => {});
    // Seat freed: the same human can start again.
    const r3 = await c.create(BATTLE_PRACTICE_ROOM, { difficulty: "medium" });
    const s3 = watch(r3);
    await until(() => !!s3.lobby);
    expect(s3.lobby!.practice?.opponent.difficulty).toBe("medium");
    await r3.leave();
  });
});
