// V2.1e Unranked AI fallback: coordinator-level verification with
// controlled timers and a stub room factory. No server, no DB, no network.
// Human-first pairing, 20s server-owned deadline, medium/hard only,
// race safety, cancellation, capacity, and ranked isolation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchCoordinator } from "@/server/battle/matchmaking";
import type { SeatPlayer } from "@/server/battle/session";
import type { MatchFoundMessage, QueueStatusMessage, SeatReservation } from "@/lib/battle-protocol";

const player = (id: string): SeatPlayer => ({ playerId: id, username: id });

interface Sent {
  queue: { type: string; msg: unknown }[];
  closed: boolean;
}
function wire() {
  const sent: Sent = { queue: [], closed: false };
  return {
    sent,
    send: (type: string, msg: unknown) => {
      sent.queue.push({ type, msg });
    },
    close: () => {
      sent.closed = true;
    },
  };
}

interface StubRoom {
  roomId: string;
  reserve: (player: SeatPlayer) => Promise<SeatReservation>;
}
function stubFactory(rooms: { roomId: string; failReserve?: boolean; failCreate?: boolean; seen: { difficulty: string; key: string }[]; humanSeen?: { key: string }[] }) {
  let n = 0;
  return async (difficulty: "medium" | "hard", fallbackKey: string) => {
    rooms.seen.push({ difficulty, key: fallbackKey });
    if (rooms.failCreate) throw new Error("create failed");
    n += 1;
    const roomId = `bot-room-${n}`;
    const handle: StubRoom = {
      roomId,
      reserve: async (p) => {
        if (rooms.failReserve) throw new Error("reserve failed");
        return { name: p.playerId, sessionId: `sess-${n}`, roomId };
      },
    };
    return handle;
  };
}

function coordinatorWith(overrides: {
  delayMs?: number;
  maxRooms?: number;
  random?: () => number;
  rooms?: { roomId: string; failReserve?: boolean; failCreate?: boolean; seen: { difficulty: string; key: string }[]; humanSeen?: { key: string }[] };
  enabled?: boolean;
}) {
  const rooms = overrides.rooms ?? { roomId: "", seen: [] as { difficulty: string; key: string }[] };
  const c = new MatchCoordinator({
    maxWaitMs: 300_000,
    closeDelayMs: 0,
    fallback: {
      createHumanRoom: async (matchKey) => {
        (rooms.humanSeen ??= []).push({ key: matchKey });
        const n = (rooms.humanSeen ?? []).length;
        const roomId = `human-room-${n}`;
        return { roomId, reserve: async (pl) => ({ name: pl.playerId, sessionId: `hsess-${n}`, roomId }) };
      },
      enabled: overrides.enabled ?? true,
      delayMs: overrides.delayMs ?? 20_000,
      maxRooms: overrides.maxRooms ?? 8,
      random: overrides.random,
      createBotRoom: stubFactory(rooms),
    },
  });
  return { c, rooms };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("V2.1e unranked AI fallback", () => {
  it("pairs two humans before the timeout with no fallback", async () => {
    const { c, rooms } = coordinatorWith({});
    const a = wire();
    const b = wire();
    c.enqueue(player("a"), a.send, a.close, "unranked");
    c.enqueue(player("b"), b.send, b.close, "unranked");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(rooms.seen).toHaveLength(0);
    const foundA = a.sent.queue.filter((m) => m.type === "match_found");
    const foundB = b.sent.queue.filter((m) => m.type === "match_found");
    expect(foundA).toHaveLength(1);
    expect(foundB).toHaveLength(1);
    expect((foundA[0]!.msg as MatchFoundMessage).fallback).toBeUndefined();
    c.dispose();
  });

  it("assigns one AI after 20s with typed bot provenance", async () => {
    const { c, rooms } = coordinatorWith({ random: () => 0.2 });
    const a = wire();
    c.enqueue(player("solo"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(rooms.seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(rooms.seen).toHaveLength(1);
    expect(rooms.seen[0]!.difficulty).toBe("medium");
    const found = a.sent.queue.filter((m) => m.type === "match_found");
    expect(found).toHaveLength(1);
    const msg = found[0]!.msg as MatchFoundMessage;
    expect(msg.opponent).toBe("AI Opponent");
    expect(msg.mode).toBe("unranked");
    expect(msg.fallback).toEqual({ botId: "practice-medium-v1", difficulty: "medium", source: "unranked-fallback" });
    expect(msg.reservation.roomId).toBe("bot-room-1");
    await vi.advanceTimersByTimeAsync(10);
    expect(a.sent.closed).toBe(true);
    c.dispose();
  });

  it("selects only medium or hard across rolls, never ultimate", async () => {
    const seen: string[] = [];
    const values = [0, 0.49, 0.5, 0.99, 0.01, 0.75, 0.3, 0.6];
    let i = 0;
    const { c, rooms } = coordinatorWith({ random: () => values[i++ % values.length]!, delayMs: 1_000 });
    for (let k = 0; k < values.length; k++) {
      const w = wire();
      c.enqueue(player(`p${k}`), w.send, w.close, "unranked");
      await vi.advanceTimersByTimeAsync(1_000);
    }
    for (const r of rooms.seen) {
      expect(["medium", "hard"]).toContain(r.difficulty);
      seen.push(r.difficulty);
    }
    expect(seen).toContain("medium");
    expect(seen).toContain("hard");
    expect(new Set(seen).size).toBe(2);
    c.dispose();
  });

  it("a human arriving just before the deadline wins over fallback", async () => {
    const { c, rooms } = coordinatorWith({});
    const a = wire();
    c.enqueue(player("early"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(19_999);
    const b = wire();
    c.enqueue(player("late"), b.send, b.close, "unranked");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rooms.seen).toHaveLength(0);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(1);
    expect(b.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(1);
    c.dispose();
  });

  it("simultaneous timeouts produce one room per ticket, never two per player", async () => {
    const { c, rooms } = coordinatorWith({});
    const a = wire();
    const b = wire();
    c.enqueue(player("x"), a.send, a.close, "unranked");
    c.enqueue(player("y"), b.send, b.close, "unranked");
    // Pair() runs synchronously at the second enqueue: humans pair, no fallback.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rooms.seen).toHaveLength(0);
    c.dispose();
  });

  it("two lone tickets timing out together each get exactly one room", async () => {
    const { c } = coordinatorWith({ delayMs: 5_000 });
    const a = wire();
    c.enqueue(player("lone1"), a.send, a.close, "unranked");
    // Advance in small steps so the second enqueue cannot pair with the first
    // after it already left for fallback.
    await vi.advanceTimersByTimeAsync(4_999);
    const b = wire();
    c.enqueue(player("lone2"), b.send, b.close, "unranked");
    await vi.advanceTimersByTimeAsync(1);
    // lone1 hits its deadline and leaves; lone2 stays waiting.
    const foundA1 = a.sent.queue.filter((m) => m.type === "match_found");
    expect(foundA1).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    const foundB = b.sent.queue.filter((m) => m.type === "match_found");
    expect(foundB).toHaveLength(1);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(1);
    c.dispose();
  });

  it("cancel before the deadline prevents fallback and frees the player", async () => {
    const { c, rooms } = coordinatorWith({});
    const a = wire();
    const t = c.enqueue(player("leaver"), a.send, a.close, "unranked");
    c.cancel("leaver", t.ticketId);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rooms.seen).toHaveLength(0);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(0);
    // Player is fully free: can queue again and get fallback normally.
    const a2 = wire();
    c.enqueue(player("leaver"), a2.send, a2.close, "unranked");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(rooms.seen).toHaveLength(1);
    c.dispose();
  });

  it("pins the room on handoff and blocks a second battle", async () => {
    const { c } = coordinatorWith({});
    const a = wire();
    c.enqueue(player("busy"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(1);
    const b = wire();
    expect(() => c.enqueue(player("busy"), b.send, b.close, "unranked")).toThrow(/Already in a battle/);
    expect(() => c.enqueue(player("busy"), b.send, b.close, "ranked")).toThrow(/Already in a battle/);
    // Stale queue cancel cannot release the room pin.
    c.cancel("busy", "stale-ticket");
    expect(() => c.enqueue(player("busy2"), b.send, b.close, "unranked")).not.toThrow();
    c.dispose();
  });

  it("room creation failure requeues without stuck pins", async () => {
    const rooms = { roomId: "", failCreate: true, seen: [] as { difficulty: string; key: string }[] };
    const { c } = coordinatorWith({ rooms, delayMs: 5_000 });
    const a = wire();
    c.enqueue(player("unlucky"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(0);
    // Still queued with a fresh deadline: the next attempt also fails, then
    // the player cancels cleanly with no stuck activity.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(c.waitingCount).toBe(1);
    c.dispose();
  });

  it("seat reservation failure requeues without stuck pins", async () => {
    const rooms = { roomId: "", failReserve: true, seen: [] as { difficulty: string; key: string }[] };
    const { c } = coordinatorWith({ rooms, delayMs: 5_000 });
    const a = wire();
    const t = c.enqueue(player("nores"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(0);
    expect(c.waitingCount).toBe(1);
    c.cancel("nores", t.ticketId);
    expect(c.waitingCount).toBe(0);
    c.dispose();
  });

  it("capacity exhaustion sends an honest retry, then fires after release", async () => {
    const { c, rooms } = coordinatorWith({ maxRooms: 1, delayMs: 5_000 });
    const a = wire();
    c.enqueue(player("first"), a.send, a.close, "unranked");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rooms.seen).toHaveLength(1);
    expect(c.fallbackRoomCount).toBe(1);
    const b = wire();
    c.enqueue(player("second"), b.send, b.close, "unranked");
    await vi.advanceTimersByTimeAsync(5_000);
    // No second room: honest retry status instead.
    expect(rooms.seen).toHaveLength(1);
    const statuses = b.sent.queue.filter((m) => m.type === "queue_status");
    expect(statuses.length).toBeGreaterThan(0);
    const last = statuses.at(-1)!.msg as QueueStatusMessage;
    expect(last.fallback).toEqual({ scheduledInMs: 5_000 });
    // A human-scale release (room disposed) lets the retry succeed.
    c.releaseFallbackRoom("bot-room-1");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rooms.seen).toHaveLength(2);
    const found = b.sent.queue.filter((m) => m.type === "match_found");
    expect(found).toHaveLength(1);
    c.dispose();
  });

  it("ranked tickets never get fallback", async () => {
    const { c, rooms } = coordinatorWith({});
    const a = wire();
    c.enqueue(player("ranked-solo"), a.send, a.close, "ranked");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rooms.seen).toHaveLength(0);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(0);
    expect(a.sent.queue.some((m) => m.type === "queue_status" && (m.msg as QueueStatusMessage).fallback !== undefined)).toBe(false);
    c.dispose();
  });

  it("fallback stays off by default and arms only when enabled", async () => {
    const plain = new MatchCoordinator({});
    const a = wire();
    plain.enqueue(player("s"), a.send, a.close, "unranked");
    expect(plain.fallbackDelayFor("unranked")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.sent.queue.filter((m) => m.type === "match_found")).toHaveLength(0);
    plain.dispose();
  });
});
