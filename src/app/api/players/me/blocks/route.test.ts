import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { friendships, playerBlocks, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET as listGet, POST as blockPost } from "./route";
import { DELETE as unblockDelete } from "./[id]/route";
import { GET as friendsGet } from "../friends/route";
import { GET as searchGet } from "../friends/search/route";

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

const BASE = "http://localhost/api/players/me/blocks";
const createdPlayerIds: string[] = [];

const req = (url: string, name: string | null, init?: RequestInit) =>
  new Request(url, {
    ...init,
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), ...(init?.headers ?? {}) },
  });

async function onboarded(name: string): Promise<Player> {
  const p = await provisionPlayer({ privyDid: `did:privy:${name}` });
  const [row] = await getDb()
    .update(players)
    .set({ username: name, usernameKey: name, avatarId: "chog-1", onboardingStatus: "complete" })
    .where(inArray(players.id, [p.id]))
    .returning();
  createdPlayerIds.push(p.id);
  return row!;
}

const json = async (res: Response) =>
  (await res.json()) as {
    success: boolean;
    data: { blocked?: { player: { id: string }; since: string } | { player: { id: string }; since: string }[]; unblocked?: boolean };
    error: { code: string; message: string };
  };

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
  vi.restoreAllMocks();
});

describe("blocks routes", () => {
  it("rejects unauthenticated reads and writes", async () => {
    expect((await json(await listGet(req(BASE, null)))).success).toBe(false);
    const res = await json(
      await blockPost(req(BASE, null, { method: "POST", body: JSON.stringify({ playerId: randomUUID() }) }))
    );
    expect(res.success).toBe(false);
    expect(res.error.code).toBe("UNAUTHORIZED");
    const del = await json(await unblockDelete(req(`${BASE}/${randomUUID()}`, null, { method: "DELETE" }), { params: Promise.resolve({ id: randomUUID() }) }));
    expect(del.success).toBe(false);
    expect(del.error.code).toBe("UNAUTHORIZED");
  });

  it("blocks, lists, and unblocks idempotently", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`ba${tag}`);
    const b = await onboarded(`bb${tag}`);
    const blocked = await json(
      await blockPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    expect(blocked.success).toBe(true);
    const again = await json(
      await blockPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    expect(again.success).toBe(true);
    const listed = (await json(await listGet(req(BASE, a.username!)))).data.blocked as { player: { id: string } }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].player.id).toBe(b.id);
    const other = (await json(await listGet(req(BASE, b.username!)))).data.blocked as unknown[];
    expect(other).toEqual([]);
    const un = await json(await unblockDelete(req(`${BASE}/${b.id}`, a.username!, { method: "DELETE" }), { params: Promise.resolve({ id: b.id }) }));
    expect(un.data).toEqual({ unblocked: true });
    const unAgain = await json(await unblockDelete(req(`${BASE}/${b.id}`, a.username!, { method: "DELETE" }), { params: Promise.resolve({ id: b.id }) }));
    expect(unAgain.data).toEqual({ unblocked: true });
  });

  it("rejects self-block and hides blocked search", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`bc${tag}`);
    const b = await onboarded(`bd${tag}`);
    const self = await json(
      await blockPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: a.id }) }))
    );
    expect(self.success).toBe(false);
    expect(self.error.code).toBe("BAD_REQUEST");
    await blockPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }));
    const found = (await (await searchGet(req(`http://localhost/api/players/me/friends/search?q=bd${tag}`, a.username!))).json()) as {
      success: boolean;
      data: { results: { player: { id: string } }[] };
    };
    expect(found.data.results.some((r) => r.player.id === b.id)).toBe(false);
    const friends = (await (await friendsGet(req("http://localhost/api/players/me/friends", a.username!))).json()) as {
      success: boolean;
      data: { friends: unknown[]; incoming: unknown[]; outgoing: unknown[] };
    };
    expect(friends.data).toEqual({ friends: [], incoming: [], outgoing: [] });
  });
});
