import { describe, expect, it } from "vitest";

import {
  accountXpLevelView,
  accountXpProgressPercent,
  accountXpReadStateForError,
  accountXpResultLabel,
  accountXpSourceLabel,
  failureAccountXp,
  formatAccountXpAwardDate,
  resolveAccountXp,
  validateAccountXpPayload,
  validateAccountXpResponse,
} from "./account-xp-model";

const award = (overrides: Record<string, unknown> = {}) => ({
  matchId: "match-1",
  source: "matchmaking",
  result: "win",
  amount: 100,
  policyVersion: 1,
  createdAt: "2026-10-29T12:00:00.000Z",
  ...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  policyVersion: 1,
  level: 2,
  totalXp: 100,
  currentLevelThreshold: 100,
  nextLevelThreshold: 225,
  xpIntoLevel: 0,
  xpToNext: 125,
  maxLevel: false,
  maxAccountLevel: 100,
  enabled: true,
  pvpDailyCap: 20,
  pvpRewardedToday: 1,
  awards: [award()],
  ...overrides,
});

describe("account XP payload validation", () => {
  it("accepts the authenticated success payload and preserves award rows", () => {
    const result = validateAccountXpResponse({ success: true, data: payload() });
    expect(result).toEqual({
      ok: true,
      payload: {
        ...payload(),
        awards: [award()],
      },
    });
  });

  it("requires the success envelope and data object", () => {
    expect(validateAccountXpResponse(null)).toMatchObject({ ok: false, reason: "not-an-object" });
    expect(validateAccountXpResponse({ success: true })).toMatchObject({ ok: false, reason: "missing-data" });
    expect(validateAccountXpResponse({ success: false, error: { code: "UNAUTHORIZED" } })).toMatchObject({
      ok: false,
      reason: "invalid-envelope",
      code: "UNAUTHORIZED",
    });
  });

  it.each([
    ["policyVersion", { policyVersion: 2 }, "invalid-policy-version"],
    ["level below 1", { level: 0 }, "invalid-level"],
    ["level above 100", { level: 101 }, "invalid-level"],
    ["negative total", { totalXp: -1 }, "invalid-total-xp"],
    ["numeric string", { totalXp: "100" }, "invalid-total-xp"],
    ["wrong current threshold", { currentLevelThreshold: 0 }, "invalid-current-threshold"],
    ["negative next threshold", { nextLevelThreshold: -1 }, "invalid-next-threshold"],
    ["negative XP into level", { xpIntoLevel: -1 }, "invalid-xp-into-level"],
    ["negative XP to next", { xpToNext: -1 }, "invalid-xp-to-next"],
    ["wrong max-account level", { maxAccountLevel: 99 }, "invalid-max-account-level"],
    ["missing enabled flag", { enabled: undefined }, "invalid-enabled"],
    ["daily count over cap", { pvpRewardedToday: 21 }, "invalid-rewarded-today"],
    ["missing awards", { awards: undefined }, "invalid-awards"],
  ] as const)("rejects malformed %s", (_label, overrides, reason) => {
    expect(validateAccountXpPayload(payload(overrides))).toMatchObject({ ok: false, reason });
  });

  it("rejects malformed source, result, duplicate and award rows", () => {
    expect(validateAccountXpPayload(payload({ awards: [award({ source: "practice" })] }))).toMatchObject({ ok: false, reason: "invalid-award" });
    expect(validateAccountXpPayload(payload({ awards: [award({ result: "unknown" })] }))).toMatchObject({ ok: false, reason: "invalid-award" });
    expect(validateAccountXpPayload(payload({ awards: [award(), award()] }))).toMatchObject({ ok: false, reason: "invalid-award" });
    expect(validateAccountXpPayload(payload({ awards: [award({ createdAt: "not-a-date" })] }))).toMatchObject({ ok: false, reason: "invalid-award" });
  });

  it("requires exact non-max threshold invariants", () => {
    expect(validateAccountXpPayload(payload({ totalXp: 225, xpIntoLevel: 125, xpToNext: 0 }))).toMatchObject({ ok: false, reason: "invalid-next-threshold" });
    expect(validateAccountXpPayload(payload({ totalXp: 150, xpIntoLevel: 1 }))).toMatchObject({ ok: false, reason: "invalid-xp-into-level" });
  });

  it("requires max-level null next fields and consistent XP", () => {
    const max = payload({
      level: 100,
      totalXp: 131175,
      currentLevelThreshold: 131175,
      nextLevelThreshold: null,
      xpIntoLevel: 0,
      xpToNext: null,
      maxLevel: true,
    });
    expect(validateAccountXpPayload(max)).toMatchObject({ ok: true });
    expect(validateAccountXpPayload({ ...max, nextLevelThreshold: 131176 })).toMatchObject({ ok: false, reason: "invalid-max-level" });
    expect(validateAccountXpPayload({ ...max, xpIntoLevel: 1 })).toMatchObject({ ok: false, reason: "invalid-xp-into-level" });
  });
});

describe("account XP read view", () => {
  it("shares the server projection between Profile and Progress without deriving a level", () => {
    const summary = resolveAccountXp(payload({ totalXp: 162, xpIntoLevel: 62, xpToNext: 63 }));
    expect(accountXpLevelView(summary)).toMatchObject({
      state: "ready",
      level: 2,
      totalXp: 162,
      nextLevelThreshold: 225,
      xpToNext: 63,
    });
    expect(accountXpLevelView(null)).toMatchObject({ state: "loading", level: null, totalXp: null });
    expect(accountXpLevelView(failureAccountXp("migration"))).toMatchObject({ state: "unavailable", level: null });
  });

  it("returns ready only for an enabled, validated response", () => {
    const view = resolveAccountXp({ success: true, data: payload({ awards: [award({ source: "unranked-fallback", result: "loss", amount: 20 })] }) });
    expect(view).toMatchObject({ state: "ready", level: 2, totalXp: 100, xpToNext: 125, enabled: true });
    expect(view.awards[0]).toMatchObject({ source: "unranked-fallback", result: "loss", amount: 20 });
    expect(accountXpProgressPercent(view)).toBe(0);
  });

  it("keeps a valid disabled response distinct and does not expose Level 1 as active progress", () => {
    const view = resolveAccountXp({ success: true, data: payload({ enabled: false, awards: [], totalXp: 0, level: 1, currentLevelThreshold: 0, nextLevelThreshold: 100, xpIntoLevel: 0, xpToNext: 100 }) });
    expect(view).toMatchObject({ state: "disabled", level: null, totalXp: null, enabled: false, awards: [] });
    expect(view.data).toMatchObject({ enabled: false, level: 1 });
    expect(accountXpProgressPercent(view)).toBeNull();
  });

  it("returns malformed rather than fabricating progression", () => {
    const view = resolveAccountXp({ success: true, data: payload({ level: 0 }) });
    expect(view).toMatchObject({ state: "malformed", level: null, totalXp: null, awards: [], reason: "invalid-level" });
    expect(accountXpProgressPercent(view)).toBeNull();
  });

  it("maps auth, setup lock, migration, service, malformed and network failures", () => {
    expect(accountXpReadStateForError({ code: "UNAUTHORIZED", status: 401 })).toBe("auth");
    expect(accountXpReadStateForError({ code: "FORBIDDEN", status: 403 })).toBe("forbidden");
    expect(accountXpReadStateForError({ code: "SERVICE_UNAVAILABLE", status: 503 })).toBe("migration");
    expect(accountXpReadStateForError({ code: "INTERNAL_ERROR", status: 500 })).toBe("unavailable");
    expect(accountXpReadStateForError("MALFORMED")).toBe("malformed");
    expect(accountXpReadStateForError("NETWORK")).toBe("network");
    expect(failureAccountXp("auth")).toMatchObject({ state: "auth", level: null, totalXp: null });
  });
});

describe("account XP display helpers", () => {
  it("computes a bounded bar only from ready server fields", () => {
    const view = resolveAccountXp(payload({ totalXp: 162, xpIntoLevel: 62, xpToNext: 63 }));
    expect(accountXpProgressPercent(view)).toBe(50);
    expect(accountXpProgressPercent({ ...view, state: "ready", maxLevel: true })).toBe(100);
    expect(accountXpProgressPercent({ ...view, state: "disabled" })).toBeNull();
  });

  it("labels award source, result and dates without exposing raw internals", () => {
    expect(accountXpSourceLabel("matchmaking")).toBe("Unranked PvP");
    expect(accountXpSourceLabel("unranked-fallback")).toBe("Unranked AI");
    expect(accountXpResultLabel("win")).toBe("Victory");
    expect(accountXpResultLabel("loss")).toBe("Defeat");
    expect(accountXpResultLabel("draw")).toBe("Draw");
    expect(formatAccountXpAwardDate("2026-10-29T12:00:00.000Z")).toBe("29 Oct 2026");
    expect(formatAccountXpAwardDate("bad-date")).toBeNull();
  });
});

