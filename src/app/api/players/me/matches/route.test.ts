import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { matchEvidence, matchParticipants, matches, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET } from "./route";
import { PRESETS } from "@/server/battle/session";

// Identity comes only from the verified token: tok-<name> -> did:privy:<name>.
vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>();
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const URL_ = "http://localhost/api/players/me/matches";
const createdPlayerIds: string[] = [];
const matchIds: string[] = [];

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  const db = getDb();
  if (matchIds.length > 0) {
    await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
    await db.delete(matchEvidence).where(inArray(matchEvidence.matchId, matchIds));
    await db.delete(matches).where(inArray(matches.id, matchIds));
  }
  if (createdPlayerIds.length > 0) await db.delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
});

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(eq(players.id, p.id))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

/** Direct insert: the history route reads settled rows, it doesn't mint them. */
async function seedMatch(a: Player, b: Player, settledAt: Date): Promise<string> {
  const matchId = randomUUID();
  matchIds.push(matchId);
  const deck8 = [...PRESETS.swarm!.cards, "cmdr:free-scout"];
  const db = getDb();
  await db.insert(matches).values({
    id: matchId,
    roomId: `room-${matchId.slice(0, 8)}`,
    matchType: "private",
    rulesetVersion: "v-test",
    protocolVersion: "b3.1",
    startedAt: new Date(settledAt.getTime() - 60_000),
    finishedAt: settledAt,
    settledAt,
    outcome: "win",
    winnerSeat: 0,
    endReason: "core",
    crowns0: 3,
    crowns1: 1,
    ticks: 1234,
    liveHash: `hash-${matchId}`,
    replayHash: `hash-${matchId}`,
    evidenceSha256: `ev-${matchId}`,
    verification: "replay-verified",
  });
  await db.insert(matchParticipants).values([
    {
      matchId,
      seat: 0,
      playerId: a.id,
      result: "win",
      crowns: 3,
      deck: deck8,
      commanderKind: "free",
      commanderClass: "scout",
      commanderIdentity: { kind: "free", class: "scout", name: "Scout Commander" },
    },
    {
      matchId,
      seat: 1,
      playerId: b.id,
      result: "loss",
      crowns: 1,
      deck: deck8,
      commanderKind: "free",
      commanderClass: "scout",
      commanderIdentity: { kind: "free", class: "scout", name: "Scout Commander" },
    },
  ]);
  return matchId;
}

const get = (name: string | null, query = "") =>
  GET(new Request(`${URL_}${query}`, { headers: name ? { authorization: `Bearer tok-${name}` } : {} }));
interface Item {
  matchId: string;
  matchType: string;
  result: string;
  mySeat: number;
  crowns: { mine: number; opponent: number };
  opponent: { username: string };
  stateHash: string;
}
const json = async (res: Response) => (await res.json()) as { success: boolean; data: { items: Item[]; nextCursor: string | null }; error?: { code: string } };

describe("match history route", () => {
  it("rejects missing and forged auth", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await GET(new Request(URL_, { headers: { authorization: "Bearer forged" } }))).status).toBe(401);
  });

  it("returns only the caller's matches, newest first, with keyset pagination", async () => {
    const me = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    const them = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    const other = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    const t = Date.now();
    const ids = [
      await seedMatch(me, them, new Date(t - 3000)),
      await seedMatch(me, them, new Date(t - 2000)),
      await seedMatch(me, them, new Date(t - 1000)),
    ];
    // Caller sees exactly their three matches; a third player sees none.
    const reqAs = async (p: Player, q = "") =>
      GET(new Request(`${URL_}${q}`, { headers: { authorization: `Bearer tok-${p.privyDid.replace("did:privy:", "")}` } }));
    const page1 = json(await reqAs(me, "?limit=1"));
    expect((await page1).data.items).toHaveLength(1);
    const p1 = await page1;
    expect(p1.data.items[0]!.matchId).toBe(ids[2]);
    expect(p1.data.items[0]!.result).toBe("win");
    expect(p1.data.items[0]!.crowns).toEqual({ mine: 3, opponent: 1 });
    expect(p1.data.items[0]!.opponent.username).toBe(them.username);
    expect(p1.data.nextCursor).toBeTruthy();
    const p2 = json(await reqAs(me, `?limit=1&cursor=${encodeURIComponent(p1.data.nextCursor!)}`));
    expect((await p2).data.items[0]!.matchId).toBe(ids[1]);
    const p3 = json(await reqAs(me, `?limit=1&cursor=${encodeURIComponent((await p2).data.nextCursor!)}`));
    expect((await p3).data.items[0]!.matchId).toBe(ids[0]);
    expect((await p3).data.nextCursor).toBeNull();
    const mine = json(await reqAs(other));
    expect((await mine).data.items).toHaveLength(0);
  });

  it("never leaks seeds, commands, evidence or the opponent's deck", async () => {
    const me = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    const them = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    await seedMatch(me, them, new Date());
    const res = await GET(new Request(URL_, { headers: { authorization: `Bearer tok-${me.privyDid.replace("did:privy:", "")}` } }));
    const text = await res.text();
    expect(JSON.parse(text).success).toBe(true);
    expect(text).not.toMatch(/seed|commands|evidence|replayHash|commanderIdentity.*opponent/);
    const parsed = JSON.parse(text) as { data: { items: Item[] } };
    expect(JSON.stringify(parsed.data.items[0]!.opponent)).toBe(JSON.stringify({ username: them.username }));
  });

  it("rejects a malformed cursor and limit", async () => {
    const me = await onboarded(`hist_${randomUUID().slice(0, 6)}`);
    const bad = await GET(new Request(`${URL_}?cursor=%%not-base64%%`, { headers: { authorization: `Bearer tok-${me.privyDid.replace("did:privy:", "")}` } }));
    expect(bad.status).toBe(400);
    const badLimit = await GET(new Request(`${URL_}?limit=abc`, { headers: { authorization: `Bearer tok-${me.privyDid.replace("did:privy:", "")}` } }));
    expect(badLimit.status).toBe(400);
  });
});
