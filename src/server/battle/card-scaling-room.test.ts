// P2c server snapshot over real WS: purchased levels from verified DB
// rows freeze into the match, survive a mid-match drop+resume and a
// mid-match DB downgrade, and land in the settlement evidence. The
// unflagged path is covered by every existing room test (no snapshot).
// TEST branch only.
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { getEnv } from "@/lib/env";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import {
  cardXpAwards,
  cardXpProgress,
  cardXpRuns,
  goldEarnLedger,
  matchEvidence,
  matchParticipants,
  matches,
  players,
  rankedTrophyAwards,
  type Player,
} from "@/db/schema";
import { BATTLE_ROOM, type BattleFrame, type EndMessage, type StartMessage } from "@/lib/battle-protocol";
import { startBattleServer } from "@/server/battle/server";
import { SettlementService } from "@/server/battle/settlement";
import { testPatronSource } from "@/server/battle/test-helpers";

const PORT = 29800 + Math.floor(Math.random() * 200);
const URL_ = `http://127.0.0.1:${PORT}`;
const replayDir = mkdtempSync(path.join(os.tmpdir(), "chog-scale-ws-"));
const dirs: string[] = [replayDir];
let server: Server;

const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

async function cleanFixtures() {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(goldEarnLedger).where(inArray(goldEarnLedger.matchId, matchIds));
    await db.delete(rankedTrophyAwards).where(inArray(rankedTrophyAwards.matchId, matchIds));
    await db.delete(cardXpAwards).where(inArray(cardXpAwards.matchId, matchIds));
    await db.delete(cardXpRuns).where(inArray(cardXpRuns.matchId, matchIds));
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) {
    await db.delete(cardXpProgress).where(inArray(cardXpProgress.playerId, createdPlayerIds));
    await db.delete(players).where(inArray(players.id, createdPlayerIds));
  }
}

const PLAYERS: Record<string, Player> = {};
async function provisioned(suffix: string): Promise<Player> {
  const tag = `${suffix}${randomUUID().slice(0, 6)}`;
  const p = await provisionPlayer({ privyDid: `did:privy:scale_${tag}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: `sc${tag}`, usernameKey: `sc${tag}`.toLowerCase(), avatarId: "chog-1", onboardingStatus: "complete", accountStatus: "active" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  PLAYERS[`did:privy:${row!.privyDid.replace("did:privy:", "")}`] = row!;
  return row!;
}

beforeAll(async () => {
  routeDalToTestDb();
  await cleanFixtures();
  const appId = getEnv().NEXT_PUBLIC_PRIVY_APP_ID;
  const settlementDir = mkdtempSync(path.join(os.tmpdir(), "chog-scale-settle-"));
  dirs.push(settlementDir);
  server = await startBattleServer(PORT, {
    verifier: async (t) => {
      if (!t.startsWith("tok-")) throw new Error("bad token");
      return { appId, userId: `did:privy:${t.slice(4)}`, sessionId: "s", issuer: "privy.io", issuedAt: 0, expiration: 0 };
    },
    loader: async (did) => PLAYERS[did] ?? null,
    patrons: testPatronSource(),
    tickMs: 2,
    replayDir,
    closeAfterMs: 50,
    matchLobbyMs: 5_000,
    cardScaling: true,
    settlement: new SettlementService({ dir: settlementDir, retryDelaysMs: [], sleep: async () => {} }),
  });
});
afterAll(async () => {
  await cleanFixtures();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  resetDbCache();
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

interface Seen {
  start?: StartMessage;
  frames: BattleFrame[];
  end?: EndMessage;
}
function watch(room: Room): Seen {
  const seen: Seen = { frames: [] };
  room.onMessage("start", (m: StartMessage) => (seen.start = m));
  room.onMessage("frame", (f: BattleFrame) => seen.frames.push(f));
  room.onMessage("end", (e: EndMessage) => (seen.end = e));
  return seen;
}
const readyMsg = () => ({
  cards: ["boulderback", "choglings", "chaos_archer", "sparkcaster", "rift_sentry", "rift_snare", "chaos_bolt"],
  commander: { kind: "free", class: "scout" } as const,
});

describe("P2c server snapshot over WS", () => {
  it("freezes DB levels into evidence, survives drop+resume and a mid-match downgrade", async () => {
    const [a, b] = [await provisioned("la"), await provisioned("lb")];
    const db = getDb();
    await db.insert(cardXpProgress).values([
      { playerId: a.id, cardId: "boulderback", xp: 200, level: 10, purchasedLevel: 10 },
      { playerId: a.id, cardId: "choglings", xp: 200, level: 10, purchasedLevel: 10 },
    ]);
    const ca = client(`tok-${a.privyDid.replace("did:privy:", "")}`);
    const ra = await ca.create(BATTLE_ROOM);
    const cb = client(`tok-${b.privyDid.replace("did:privy:", "")}`);
    const rb = await cb.joinById(ra.roomId);
    const sa = watch(ra);
    const sb = watch(rb);
    ra.send("ready", readyMsg());
    rb.send("ready", readyMsg());
    await until(() => !!sa.start && !!sb.start);
    // Freeze check 1: P0 boulderback spawns with scaled maxHp (400 -> 544).
    // Drive mirrors the proven reconnect-suite driver: abilities plus the
    // first affordable troop/commander, so the match always terminates.
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
    // Mid-match downgrade in the DB: the live match must not move.
    await db.update(cardXpProgress).set({ purchasedLevel: 1 }).where(eq(cardXpProgress.playerId, a.id));
    // Drop P0 mid-match, then resume on the same seat.
    await until(() => (sa.frames.at(-1)?.tick ?? 0) > 30);
    const roomId = ra.roomId;
    const token = sa.start!.resumeToken;
    await ra.leave(false);
    // The room can report locked while the dropped socket frees; retry.
    let ra2: Room | null = null;
    const t0 = Date.now();
    for (;;) {
      try {
        ra2 = await ca.joinById(roomId, { resume: token });
        break;
      } catch (e) {
        if (/locked|full/i.test(e instanceof Error ? e.message : String(e)) && Date.now() - t0 < 8000) {
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
        throw e;
      }
    }
    const sa2 = watch(ra2);
    await until(() => !!sa2.start && sa2.start.resumed === true);
    // From here on only live rooms are touched: ra is closed and any send
    // on it would throw inside the poll loop.
    const last = { a: -1, b: -1 };
    await until(() => {
      const fa = sa2.frames.at(-1);
      const fb = sb.frames.at(-1);
      if (fa && fa.tick !== last.a) {
        last.a = fa.tick;
        drive(ra2, sa2);
      }
      if (fb && fb.tick !== last.b) {
        last.b = fb.tick;
        drive(rb, sb);
      }
      return !!sa2.end && !!sb.end;
    }, 150_000);
    expect(sa2.end!.replayIdentical).toBe(true);
    expect(sb.end!.replayIdentical).toBe(true);
    const matchId = sa2.end!.matchId!;
    matchIds.push(matchId);
    const scaledSpawn = [...sa.frames, ...sa2.frames, ...sb.frames]
      .flatMap((f) => f.troops)
      .find((t) => t.owner === sa.start!.seat && t.cardId === "boulderback");
    expect(scaledSpawn?.maxHp).toBe(544);
    // Evidence carries the frozen pre-downgrade snapshot, keyed per seat.
    // The room broadcasts `end` before the async settlement write lands,
    // so poll for the durable row instead of racing it.
    let ev: { evidence: unknown } | undefined;
    const tEv = Date.now();
    while (!ev) {
      if (Date.now() - tEv > 20_000) throw new Error("settlement evidence never landed");
      [ev] = await db.select().from(matchEvidence).where(eq(matchEvidence.matchId, matchId));
      if (!ev) await new Promise((r) => setTimeout(r, 100));
    }
    const cfg = (ev!.evidence as { config: { cardLevels?: [{ [k: string]: number }, { [k: string]: number }] } }).config;
    const seatA = sa.start!.seat;
    expect(cfg.cardLevels?.[seatA]).toMatchObject({ boulderback: 10, choglings: 10 });
    expect(cfg.cardLevels?.[1 - seatA as 0 | 1]).toEqual({});
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(m!.matchType).toBe("private");
    expect(m!.verification).toBe("replay-verified");
  }, 180_000);
});
