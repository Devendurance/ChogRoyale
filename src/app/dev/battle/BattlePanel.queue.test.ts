import { describe, expect, it, beforeEach, vi } from "vitest";
import type { LobbyMessage } from "@/lib/battle-protocol";
import {
  lobbyWaitingForMessage,
  completeQueueHandoff,
  createQueueHandoffGate,
  queueFallbackRemainingSeconds,
  readResume,
  resumeKeyForOrigin,
  resumeOriginForStart,
  validateMatchFoundMessage,
} from "./BattlePanel";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "" }) }));
vi.mock("next/font/google", () => ({ Georama: () => ({ variable: "" }), Lilita_One: () => ({ variable: "" }) }));

const reservation = { name: "battle", sessionId: "session-1", roomId: "room-1" };

describe("BattlePanel queue handoff", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it("keeps the lobby handoff visible while its first message is still pending", () => {
    expect(lobbyWaitingForMessage("lobby", null)).toBe(true);
    expect(lobbyWaitingForMessage("connecting", null)).toBe(false);
    expect(lobbyWaitingForMessage("lobby", {} as LobbyMessage)).toBe(false);
  });

  it("shows a fallback countdown only when the server advertises one", () => {
    expect(queueFallbackRemainingSeconds({ state: "searching", waiting: 1, since: 10_000 }, 10_500)).toBeNull();
    expect(queueFallbackRemainingSeconds({ state: "searching", waiting: 1, since: 10_000, fallback: { scheduledInMs: 20_000 } }, 28_501)).toBe(2);
    expect(queueFallbackRemainingSeconds({ state: "searching", waiting: 1, since: 10_000, fallback: { scheduledInMs: 20_000 } }, 31_000)).toBe(0);
  });

  it("accepts a validated human handoff and the server-owned fallback shape", () => {
    expect(validateMatchFoundMessage({ reservation, opponent: "Rival", mode: "unranked" }, "unranked")).toMatchObject({ ok: true, origin: "pvp" });
    expect(validateMatchFoundMessage({ reservation, opponent: "AI Opponent", mode: "unranked", fallback: { botId: "practice-hard-v1", difficulty: "hard", source: "unranked-fallback" } }, "unranked")).toMatchObject({ ok: true, origin: "unranked-fallback" });
  });

  it("uses authoritative Practice provenance when selecting the resume origin", () => {
    expect(resumeOriginForStart({ mode: "practice", practiceOpponent: { kind: "bot", botId: "practice-hard-v1", difficulty: "hard", displayName: "AI Opponent", source: "unranked-fallback" } }, "unranked-fallback")).toBe("unranked-fallback");
    expect(resumeOriginForStart({ mode: "practice", practiceOpponent: { kind: "bot", botId: "practice-hard-v1", difficulty: "hard", displayName: "AI Opponent", source: "unranked-fallback" } }, "practice")).toBeNull();
    expect(resumeOriginForStart({ mode: "practice", practiceOpponent: { kind: "bot", botId: "practice-medium-v1", difficulty: "medium", displayName: "AI Opponent", source: "practice" } }, "practice")).toBe("practice");
    expect(resumeOriginForStart({ mode: "matchmaking", practiceOpponent: undefined }, "pvp")).toBe("pvp");
  });

  it("rejects an invalid fallback before its reservation can be consumed", () => {
    expect(validateMatchFoundMessage({ reservation, opponent: "Rival", mode: "unranked", fallback: { botId: "practice-ultimate-v1", difficulty: "ultimate", source: "unranked-fallback" } }, "unranked")).toMatchObject({ ok: false });
    expect(validateMatchFoundMessage({ reservation, opponent: "AI Opponent", mode: "ranked", fallback: { botId: "practice-medium-v1", difficulty: "medium", source: "unranked-fallback" } }, "ranked")).toMatchObject({ ok: false });
  });

  it("keeps fallback and practice/PvP resume slots separate and reads fallback from Unranked", () => {
    expect(resumeKeyForOrigin("unranked-fallback")).not.toBe(resumeKeyForOrigin("pvp"));
    const fallbackKey = resumeKeyForOrigin("unranked-fallback");
    sessionStorage.setItem(fallbackKey, JSON.stringify({ mode: "practice", origin: "unranked-fallback", roomId: "room-f", resumeToken: "token-f" }));
    expect(readResume("unranked")).toMatchObject({ origin: "unranked-fallback", roomId: "room-f" });
    expect(readResume("practice")).toBeNull();
    sessionStorage.setItem(resumeKeyForOrigin("pvp"), JSON.stringify({ mode: "private", origin: "pvp", roomId: "room-p", resumeToken: "token-p" }));
    expect(readResume("unranked")).toMatchObject({ origin: "unranked-fallback", roomId: "room-f" });
    expect(readResume("private")).toMatchObject({ origin: "pvp", roomId: "room-p" });
  });

  it("keeps a fast queue close from invalidating a delayed handoff", async () => {
    let current = true;
    let resolveRoom!: (room: { id: string }) => void;
    let attached = false;
    let queueLeft = false;
    let queueLeaveStarted = false;
    const nextRoom = { id: "battle-1" };
    const handoff = completeQueueHandoff({
      consume: () => new Promise<{ id: string }>((resolve) => { resolveRoom = resolve; }),
      // The queue's onLeave sees the handoff marker and leaves this generation
      // current even though its socket closes before the reservation resolves.
      isCurrent: () => current,
      attach: () => { attached = true; },
      leaveQueue: async () => {
        queueLeaveStarted = true;
        expect(attached).toBe(true);
        await Promise.resolve();
        queueLeft = true;
      },
      leaveRoom: async () => {},
    });
    resolveRoom(nextRoom);
    const result = await handoff;
    expect(result).toBe("attached");
    expect(queueLeaveStarted).toBe(true);
    expect(queueLeft).toBe(true);
  });

  it("claims only the first match_found delivery", () => {
    const gate = createQueueHandoffGate();
    expect(gate.claim()).toBe(true);
    expect(gate.claim()).toBe(false);
  });

  it("disposes a reservation that resolves after cancellation", async () => {
    let current = true;
    let resolveRoom!: (room: { id: string }) => void;
    let attached = 0;
    let left = 0;
    const handoff = completeQueueHandoff({
      consume: () => new Promise<{ id: string }>((resolve) => { resolveRoom = resolve; }),
      isCurrent: () => current,
      attach: () => { attached += 1; },
      leaveQueue: async () => {},
      leaveRoom: async () => { left += 1; },
    });
    current = false;
    resolveRoom({ id: "late-room" });
    await expect(handoff).resolves.toBe("cancelled");
    expect(attached).toBe(0);
    expect(left).toBe(1);
  });
});
