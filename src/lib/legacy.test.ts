// Legacy domain tests (pure, fixtures inline).

import { describe, it, expect } from "vitest";
import {
  validateLegacyEventInput,
  evaluateAchievements,
  aggregateLegacyStats,
  isHistoryGrounding,
  type StoredLegacyEvent,
} from "@/lib/legacy";

function ev(partial: Partial<StoredLegacyEvent> & { authorityKey: string }): StoredLegacyEvent {
  return {
    category: "commander_appearance",
    tokenId: "1",
    matchId: "m1",
    matchStatus: "completed",
    payload: {},
    superseded: false,
    ...partial,
  };
}

describe("validateLegacyEventInput", () => {
  it("accepts a grounded appearance", () => {
    expect(() =>
      validateLegacyEventInput({
        authorityKey: "b3:m1:ca:1",
        category: "commander_appearance",
        tokenId: "1",
        matchId: "m1",
        matchStatus: "completed",
        payload: {},
        rulesetRefs: { commander: "v1" },
      })
    ).not.toThrow();
  });
  it("rejects cancelled matches, bad outcomes, bad ids", () => {
    const base = {
      authorityKey: "k",
      tokenId: "1",
      matchId: "m1",
      payload: {},
      rulesetRefs: {},
    };
    expect(() =>
      validateLegacyEventInput({ ...base, category: "patron_appearance", matchStatus: "cancelled" })
    ).toThrow();
    expect(() => validateLegacyEventInput({ ...base, category: "commander_outcome", matchStatus: "completed", payload: { result: "draw" } })).toThrow();
    expect(() => validateLegacyEventInput({ ...base, category: "commander_outcome", matchStatus: "completed", payload: {} })).toThrow();
    expect(() => validateLegacyEventInput({ ...base, category: "achievement", matchId: null, matchStatus: null, authorityKey: "" })).toThrow();
    expect(() => validateLegacyEventInput({ ...base, category: "achievement", matchId: null, matchStatus: null, tokenId: "abc" })).toThrow();
  });
  it("achievement category needs no match", () => {
    expect(() =>
      validateLegacyEventInput({
        authorityKey: "k2",
        category: "achievement",
        tokenId: "5",
        matchId: null,
        matchStatus: null,
        payload: {},
        rulesetRefs: {},
      })
    ).not.toThrow();
  });
});

describe("isHistoryGrounding", () => {
  it("only completed/finalized ground history", () => {
    expect(isHistoryGrounding("completed")).toBe(true);
    expect(isHistoryGrounding("finalized")).toBe(true);
    expect(isHistoryGrounding("cancelled")).toBe(false);
    expect(isHistoryGrounding("started")).toBe(false);
    expect(isHistoryGrounding(null)).toBe(false);
  });
});

describe("aggregateLegacyStats", () => {
  it("returns zeros for no events", () => {
    expect(aggregateLegacyStats([])).toEqual({
      patronAppearances: 0,
      commanderAppearances: 0,
      victories: 0,
      defeats: 0,
      achievements: [],
    });
  });
  it("counts distinct matches once and excludes cancelled/superseded", () => {
    const events = [
      ev({ authorityKey: "a1", matchId: "m1" }),
      ev({ authorityKey: "a2", matchId: "m1" }),
      ev({ authorityKey: "a3", matchId: "m2" }),
      ev({ authorityKey: "a4", matchId: "m3", matchStatus: "cancelled" }),
      ev({ authorityKey: "a5", matchId: "m4", superseded: true }),
      ev({ authorityKey: "o1", category: "commander_outcome", matchId: "m1", payload: { result: "victory" } }),
      ev({ authorityKey: "o2", category: "commander_outcome", matchId: "m2", payload: { result: "defeat" } }),
      ev({ authorityKey: "o3", category: "commander_outcome", matchId: "m9", matchStatus: "started", payload: { result: "victory" } }),
      ev({ authorityKey: "p1", category: "patron_appearance", matchId: "m1" }),
    ];
    expect(aggregateLegacyStats(events)).toEqual({
      patronAppearances: 1,
      commanderAppearances: 2,
      victories: 1,
      defeats: 1,
      achievements: ["first_blood", "first_victory"],
    });
  });
  it("is idempotent across re-evaluation", () => {
    const events = [ev({ authorityKey: "a1", matchId: "m1" })];
    expect(evaluateAchievements(events)).toEqual(evaluateAchievements(events));
  });
});
