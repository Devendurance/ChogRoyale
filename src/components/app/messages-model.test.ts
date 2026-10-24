import { afterEach, describe, expect, it, vi } from "vitest";
import { messageError, messagingRequest, mergeMessages, peerName, validDraft, type Message } from "./messages-model";

const message = (id: string, createdAt: string, status: "sent" | "read" = "sent"): Message => ({ id, conversationId: "conversation", sender: "peer", content: "Hello", status, createdAt, readAt: status === "read" ? createdAt : null });
afterEach(() => vi.unstubAllGlobals());
describe("messaging model", () => {
  it("merges duplicate pages, applies server receipts and preserves chronological order", () => {
    const old = [message("b", "2026-10-24T10:01:00Z"), message("a", "2026-10-24T10:00:00Z")];
    const result = mergeMessages(old, [message("a", "2026-10-24T10:00:00Z", "read"), message("c", "2026-10-24T10:02:00Z")]);
    expect(result.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(result[0].status).toBe("read");
  });
  it("validates trimmed content at the server length boundary", () => {
    expect(validDraft(" \n ")).toBe(false);
    expect(validDraft("a".repeat(1000))).toBe(true);
    expect(validDraft("a".repeat(1001))).toBe(false);
    expect(validDraft(" hi ")).toBe(true);
  });
  it("uses public identity only with a neutral fallback", () => {
    expect(peerName({ id: "hidden", username: null, displayName: null, avatarId: null })).toBe("Player");
  });
  it.each([401, 403, 404, 429, 500, 503])("retains distinct HTTP failure %s without turning it into empty history", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    await expect(messagingRequest("/api/players/me/messages", async () => "token")).rejects.toMatchObject({ status, message: messageError(status) });
  });
  it("keeps credentials in headers and preserves the caller's retry key", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { message: "saved" } })));
    vi.stubGlobal("fetch", fetcher);
    const body = { conversationId: "conversation", content: "Hello", idempotencyKey: "same-key" };
    await messagingRequest("/api/players/me/messages", async () => "secret", body);
    await messagingRequest("/api/players/me/messages", async () => "secret", body);
    expect(fetcher.mock.calls[0][0]).not.toContain("secret");
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer secret");
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("fails closed on missing sessions, malformed envelopes and network failure", async () => {
    await expect(messagingRequest("/api/players/me/messages", async () => null)).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))));
    await expect(messagingRequest("/api/players/me/messages", async () => "token")).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(messagingRequest("/api/players/me/messages", async () => "token")).rejects.toMatchObject({ status: 503 });
  });
});
