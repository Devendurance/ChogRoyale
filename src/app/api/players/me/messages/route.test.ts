import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { routeDalToTestDb, getDb, resetDbCache } from "@/db/client";
import { provisionPlayer } from "@/db/players";
import { sendRequest, acceptRequest } from "@/db/friendships";
import { dmConversations, dmMessages, friendships, playerBlocks, players, type Player } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { GET as listGet, POST as sendPost } from "./route";
import { GET as fetchGet } from "./[id]/route";
import { POST as readPost } from "./[id]/read/route";
import { getOrCreateConversation } from "@/db/messages";

// Identity comes only from the verified token: tok-<name> -> did:privy:<name>.
vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>() ;
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const BASE = "http://localhost/api/players/me/messages";
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

async function befriend(a: Player, b: Player) {
  const sent = await sendRequest(a.id, b.id);
  await acceptRequest(b.id, sent.friendshipId);
}

type ApiBody = { success: boolean; data: any; error: { code: string; message: string } };
const json = async (res: Response): Promise<ApiBody> => (await res.json()) as ApiBody;

beforeAll(() => {
  routeDalToTestDb();
}, 60000);

afterAll(async () => {
  await getDb().delete(dmMessages);
  await getDb().delete(dmConversations);
  await getDb().delete(friendships);
  await getDb().delete(playerBlocks);
  if (createdPlayerIds.length > 0) await getDb().delete(players).where(inArray(players.id, createdPlayerIds));
  resetDbCache();
  vi.restoreAllMocks();
}, 60000);

describe("messages routes", () => {
  it("rejects unauthenticated reads, sends and acks", async () => {
    expect((await json(await listGet(req(BASE, null)))).success).toBe(false);
    const sent = await json(
      await sendPost(req(BASE, null, { method: "POST", body: JSON.stringify({ conversationId: randomUUID(), content: "x", idempotencyKey: randomUUID() }) }))
    );
    expect(sent.success).toBe(false);
    expect(sent.error.code).toBe("UNAUTHORIZED");
    const fetched = await json(await fetchGet(req(`${BASE}/${randomUUID()}`, null), { params: Promise.resolve({ id: randomUUID() }) }));
    expect(fetched.error.code).toBe("UNAUTHORIZED");
    const acked = await json(
      await readPost(req(`${BASE}/${randomUUID()}/read`, null, { method: "POST", body: JSON.stringify({ messageId: randomUUID() }) }), { params: Promise.resolve({ id: randomUUID() }) })
    );
    expect(acked.error.code).toBe("UNAUTHORIZED");
  });

  it("runs a full send, fetch and read lifecycle between friends", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`ma${tag}`);
    const b = await onboarded(`mb${tag}`);
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);

    const sent = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ conversationId, content: "hello there", idempotencyKey: randomUUID() }) }))
    );
    expect(sent.success).toBe(true);
    expect(sent.data.message.sender).toBe(a.id);
    expect(sent.data.message.status).toBe("sent");

    const listed = await json(await listGet(req(BASE, b.username!)));
    expect(listed.data.conversations).toHaveLength(1);
    expect(listed.data.conversations[0].unread).toBe(1);
    expect(listed.data.conversations[0].lastMessage.snippet).toBe("hello there");
    expect(listed.data.conversations[0].peer.username).toBe(a.username);

    const fetched = await json(await fetchGet(req(`${BASE}/${conversationId}`, b.username!), { params: Promise.resolve({ id: conversationId }) }));
    expect(fetched.data.messages).toHaveLength(1);
    const mid: string = fetched.data.messages[0].id;

    const acked = await json(
      await readPost(req(`${BASE}/${conversationId}/read`, b.username!, { method: "POST", body: JSON.stringify({ messageId: mid }) }), { params: Promise.resolve({ id: conversationId }) })
    );
    expect(acked.data).toEqual({ read: true });
    const again = await json(await fetchGet(req(`${BASE}/${conversationId}`, b.username!), { params: Promise.resolve({ id: conversationId }) }));
    expect(again.data.messages[0].status).toBe("read");
  });

  it("ignores a spoofed sender and refuses strangers and nonfriends", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`mc${tag}`);
    const b = await onboarded(`md${tag}`);
    const s = await onboarded(`ms${tag}`);
    const n = await onboarded(`mn${tag}`);
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);

    // No sender field exists; an injected one must not take effect.
    const spoofed = await json(
      await sendPost(
        req(BASE, a.username!, { method: "POST", body: JSON.stringify({ conversationId, content: "mine", idempotencyKey: randomUUID(), sender: b.id }) })
      )
    );
    expect(spoofed.success).toBe(true);
    expect(spoofed.data.message.sender).toBe(a.id);

    const stranger = await json(await fetchGet(req(`${BASE}/${conversationId}`, s.username!), { params: Promise.resolve({ id: conversationId }) }));
    expect(stranger.success).toBe(false);
    expect(stranger.error.code).toBe("NOT_FOUND");

    const nonfriend = await json(
      await sendPost(req(BASE, n.username!, { method: "POST", body: JSON.stringify({ conversationId, content: "hi", idempotencyKey: randomUUID() }) }))
    );
    expect(nonfriend.success).toBe(false);
    expect(nonfriend.error.code).toBe("NOT_FOUND");

    const empty = await json(await listGet(req(BASE, s.username!)));
    expect(empty.data.conversations).toEqual([]);
  });

  it("rejects empty and oversized content", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await onboarded(`me${tag}`);
    const b = await onboarded(`mf${tag}`);
    await befriend(a, b);
    const { conversationId } = await getOrCreateConversation(a.id, b.id);
    const blank = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ conversationId, content: "  ", idempotencyKey: randomUUID() }) }))
    );
    expect(blank.success).toBe(false);
    const big = await json(
      await sendPost(req(BASE, a.username!, { method: "POST", body: JSON.stringify({ conversationId, content: "y".repeat(1001), idempotencyKey: randomUUID() }) }))
    );
    expect(big.success).toBe(false);
    expect(big.error.code).toBe("BAD_REQUEST");
  });
});
