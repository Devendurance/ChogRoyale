import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, or } from "drizzle-orm";
import { getDb, resetDbCache, routeDalToTestDb } from "@/db/client";
import { acceptRequest, sendRequest } from "@/db/friendships";
import { dmConversations, dmMessages, friendships, playerBlocks, players } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POST } from "./route";

vi.mock("@/lib/privy-server", async (orig) => {
  const mod = await orig<typeof import("@/lib/privy-server")>();
  return {
    ...mod,
    verifyPrivyToken: async (token: string) => {
      if (!token.startsWith("tok-")) throw new AppError("UNAUTHORIZED", "Invalid or expired credentials");
      return { privyDid: `did:privy:p5c_open_${token.slice(4)}`, sessionId: "s", appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "test" };
    },
  };
});

const names = ["a", "b", "pending", "stranger", "blocked", "incomplete", "banned"] as const;
const ids = names.map((_, index) => `e05c0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const [a, b, pending, stranger, blocked, incomplete] = ids;
const BASE = "http://localhost/api/players/me/messages/conversations";

function request(name: string | null, body: unknown, headers?: Record<string, string>) {
  return new Request(BASE, {
    method: "POST",
    headers: { ...(name ? { authorization: `Bearer tok-${name}` } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function open(name: string | null, peerId: string) {
  const res = await POST(request(name, { peerId }));
  return { res, body: await res.json() };
}

async function cleanup() {
  const db = getDb();
  const conversations = await db.select({ id: dmConversations.id }).from(dmConversations)
    .where(or(inArray(dmConversations.userA, ids), inArray(dmConversations.userB, ids)));
  if (conversations.length) await db.delete(dmMessages).where(inArray(dmMessages.conversationId, conversations.map((row) => row.id)));
  await db.delete(dmConversations).where(or(inArray(dmConversations.userA, ids), inArray(dmConversations.userB, ids)));
  await db.delete(friendships).where(or(inArray(friendships.userA, ids), inArray(friendships.userB, ids)));
  await db.delete(playerBlocks).where(or(inArray(playerBlocks.blocker, ids), inArray(playerBlocks.blocked, ids)));
  await db.delete(players).where(inArray(players.id, ids));
}

beforeAll(async () => {
  routeDalToTestDb();
  await cleanup();
  await getDb().insert(players).values(names.map((name, index) => ({
    id: ids[index],
    privyDid: `did:privy:p5c_open_${name}`,
    username: `p5c_open_${name}`,
    usernameKey: `p5c_open_${name}`,
    avatarId: "chog-1",
    onboardingStatus: name === "incomplete" ? "pending" : "complete",
    accountStatus: name === "banned" ? "banned" : "active",
  })));
  for (const peerId of [b, blocked]) {
    const sent = await sendRequest(a, peerId);
    await acceptRequest(peerId, sent.friendshipId);
  }
  await sendRequest(a, pending);
}, 60000);

afterAll(async () => {
  await cleanup();
  resetDbCache();
  vi.restoreAllMocks();
}, 60000);

describe("conversation opener", () => {
  it("requires a verified, active and onboarded caller", async () => {
    expect((await open(null, b)).res.status).toBe(401);
    expect((await open("incomplete", b)).res.status).toBe(403);
    expect((await open("banned", b)).res.status).toBe(403);
  });

  it("opens exactly one canonical conversation concurrently and reuses it without sending", async () => {
    const [first, second] = await Promise.all([open("a", b), open("b", a)]);
    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(200);
    expect(first.body.data).toEqual({ conversationId: expect.any(String) });
    expect(second.body.data).toEqual(first.body.data);
    expect((await open("a", b)).body.data).toEqual(first.body.data);
    const rows = await getDb().select().from(dmConversations).where(or(eq(dmConversations.userA, a), eq(dmConversations.userB, a)));
    expect(rows).toHaveLength(1);
    const messages = await getDb().select().from(dmMessages).where(eq(dmMessages.conversationId, first.body.data.conversationId));
    expect(messages).toEqual([]);
  });

  it("uses a neutral denial for unknown, incomplete, pending and unrelated peers", async () => {
    for (const peerId of [randomUUID(), incomplete, pending, stranger]) {
      const { res, body } = await open("a", peerId);
      expect(res.status).toBe(403);
      expect(body.error).toMatchObject({ code: "FORBIDDEN", message: "This player is unavailable." });
    }
  });

  it("refuses blocked pairs in both directions", async () => {
    // Leave the friendship present to prove the independent block guard.
    await getDb().insert(playerBlocks).values({ blocker: blocked, blocked: a });
    for (const [name, peerId] of [["a", blocked], ["blocked", a]]) {
      const { res, body } = await open(name, peerId);
      expect(res.status).toBe(403);
      expect(body.error.message).toBe("This player is unavailable.");
    }
  });

  it("rejects self, malformed ids, invalid JSON and oversized bodies", async () => {
    for (const body of [{ peerId: a }, { peerId: "bad-id" }, {}, "{", "x".repeat(1025)]) {
      expect((await POST(request("a", body))).status).toBe(400);
    }
    expect((await POST(request("a", { peerId: b }, { "content-length": "1025" }))).status).toBe(400);
  });

  it("derives caller identity only from authentication", async () => {
    const res = await POST(request("stranger", { peerId: b, sender: a, playerId: a }));
    expect(res.status).toBe(403);
    const spoof = await POST(request("a", { peerId: b, sender: stranger, playerId: stranger }));
    expect(spoof.status).toBe(200);
    expect((await spoof.json()).data).toEqual((await open("a", b)).body.data);
  });
});
