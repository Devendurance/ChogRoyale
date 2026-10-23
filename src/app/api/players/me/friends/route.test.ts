import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET as listGet, POST as sendPost } from "./route";
import { GET as searchGet } from "./search/route";
import { POST as acceptPost } from "./[id]/accept/route";
import { POST as declinePost } from "./[id]/decline/route";
import { DELETE as removeDelete } from "./[id]/route";

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

const BASE = "http://localhost/api/players/me/friends";
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

type FriendRow = {
  friendshipId: string;
  status: string;
  incoming: boolean;
  player: { id: string; username: string | null };
};
const json = async (res: Response) =>
  (await res.json()) as {
    success: boolean;
    data: {
      friends?: FriendRow[];
      incoming?: FriendRow[];
      outgoing?: FriendRow[];
      results?: { player: { id: string }; status: string; friendshipId: string | null }[];
      friendship?: FriendRow;
    };
    error: { code: string; message: string };
  };

beforeAll(() => {
  routeDalToTestDb();
});

afterAll(async () => {
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
  vi.restoreAllMocks();
});

describe("friends routes", () => {
  it("rejects unauthenticated reads and sends", async () => {
    expect((await json(await listGet(req(BASE, null)))).success).toBe(false);
    const res = await json(
      await sendPost(req(BASE, null, { method: "POST", body: JSON.stringify({ playerId: randomUUID() }) }))
    );
    expect(res.success).toBe(false);
    expect(res.error.code).toBe("UNAUTHORIZED");
  });

  it("starts empty and searches by username", async () => {
    const tag = `srch${randomUUID().slice(0, 6)}`;
    const a = await onboarded(`fra_${tag}`);
    const b = await onboarded(`frb_${tag}`);
    const empty = await json(await listGet(req(BASE, a.username!)));
    expect(empty.data).toEqual({ friends: [], incoming: [], outgoing: [] });
    const found = await json(await searchGet(req(`${BASE}/search?q=frb_${tag}`, a.username!)));
    expect(found.data.results?.some((r) => r.player.id === b.id && r.status === "none")).toBe(true);
    const missing = await json(await searchGet(req(`${BASE}/search?q=`, a.username!)));
    expect(missing.success).toBe(false);
  });

  it("completes a full request lifecycle between two accounts", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`fa${tag}`);
    const b = await onboarded(`fb${tag}`);
    const sent = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    expect(sent.data.friendship!.status).toBe("pending");
    const fid: string = sent.data.friendship!.friendshipId;

    const again = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    expect(again.data.friendship!.friendshipId).toBe(fid);

    const forB = await json(await listGet(req(BASE, b.username!)));
    expect(forB.data.incoming).toHaveLength(1);

    const accepted = await json(await acceptPost(req(`${BASE}/${fid}/accept`, b.username!, { method: "POST" }), { params: Promise.resolve({ id: fid }) }));
    expect(accepted.data.friendship!.status).toBe("accepted");

    const listA = await json(await listGet(req(BASE, a.username!)));
    const listB = await json(await listGet(req(BASE, b.username!)));
    expect(listA.data.friends).toHaveLength(1);
    expect(listB.data.friends).toHaveLength(1);

    const removed = await json(await removeDelete(req(`${BASE}/${fid}`, b.username!, { method: "DELETE" }), { params: Promise.resolve({ id: fid }) }));
    expect(removed.data).toEqual({ removed: true });
    expect((await json(await listGet(req(BASE, a.username!)))).data.friends).toHaveLength(0);
  });

  it("rejects self requests, bad ids and strangers", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`fc${tag}`);
    const b = await onboarded(`fd${tag}`);
    const c = await onboarded(`fe${tag}`);
    const self = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: a.id }) }))
    );
    expect(self.error.code).toBe("BAD_REQUEST");
    const unknown = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: randomUUID() }) }))
    );
    expect(unknown.error.code).toBe("NOT_FOUND");
    const sent = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    const fid: string = sent.data.friendship!.friendshipId;
    const stranger = await json(await acceptPost(req(`${BASE}/${fid}/accept`, c.username!, { method: "POST" }), { params: Promise.resolve({ id: fid }) }));
    expect(stranger.error.code).toBe("NOT_FOUND");
    const ownAccept = await json(await acceptPost(req(`${BASE}/${fid}/accept`, a.username!, { method: "POST" }), { params: Promise.resolve({ id: fid }) }));
    expect(ownAccept.error.code).toBe("BAD_REQUEST");
    const strangerDelete = await json(await removeDelete(req(`${BASE}/${fid}`, c.username!, { method: "DELETE" }), { params: Promise.resolve({ id: fid }) }));
    expect(strangerDelete.error.code).toBe("NOT_FOUND");
  });

  it("declines incoming requests", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`ff${tag}`);
    const b = await onboarded(`fg${tag}`);
    const sent = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ playerId: b.id }) }))
    );
    const fid: string = sent.data.friendship!.friendshipId;
    const declined = await json(await declinePost(req(`${BASE}/${fid}/decline`, b.username!, { method: "POST" }), { params: Promise.resolve({ id: fid }) }));
    expect(declined.data).toEqual({ declined: true });
    expect((await json(await listGet(req(BASE, a.username!)))).data.outgoing).toHaveLength(0);
  });
});
