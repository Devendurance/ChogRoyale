import { describe, expect, it, beforeEach, vi } from "vitest";
import {
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
});
