// Focused tests for the A3.1 profile model. These are the rules the profile
// screen shows: the verified record states, the join date and the three honest
// account labels. A partial payload degrades a row, it never throws.

import { describe, it, expect } from "vitest";
import {
  accountStatusLabel,
  formatMemberSince,
  onboardingLabel,
  resolveRecord,
  winRateLabel,
} from "./profile-model";

describe("resolveRecord", () => {
  it("reports a read that never arrived as unavailable", () => {
    expect(resolveRecord(null)).toEqual({
      state: "unavailable",
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRateBp: null,
      crownsEarned: 0,
      crownsConceded: 0,
    });
  });

  it("reports a payload without a stats object as unavailable", () => {
    expect(resolveRecord({})).toMatchObject({ state: "unavailable", total: 0, winRateBp: null });
    expect(resolveRecord({ stats: null })).toMatchObject({ state: "unavailable", total: 0 });
  });

  it("reports an account with no settled match as empty", () => {
    expect(resolveRecord({ stats: { total: 0, wins: 0, losses: 0, draws: 0 } })).toEqual({
      state: "empty",
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRateBp: null,
      crownsEarned: 0,
      crownsConceded: 0,
    });
  });

  it("reports real rows as ready with the numbers the route sent", () => {
    const record = resolveRecord({
      stats: {
        total: 12,
        wins: 7,
        losses: 4,
        draws: 1,
        winRateBp: 5833,
        crownsEarned: 21,
        crownsConceded: 14,
      },
    });
    expect(record).toEqual({
      state: "ready",
      total: 12,
      wins: 7,
      losses: 4,
      draws: 1,
      winRateBp: 5833,
      crownsEarned: 21,
      crownsConceded: 14,
    });
  });

  it("degrades counts it cannot trust, and reads a numeric string", () => {
    const record = resolveRecord({
      stats: {
        total: 3,
        wins: -5,
        losses: "2",
        draws: Number.NaN,
        crownsEarned: null,
        crownsConceded: { total: 4 },
      },
    });
    expect(record).toMatchObject({
      state: "ready",
      total: 3,
      wins: 0,
      losses: 2,
      draws: 0,
      crownsEarned: 0,
      crownsConceded: 0,
    });
  });

  it("floors fractional counts", () => {
    expect(resolveRecord({ stats: { total: 4.9, wins: 2.7 } })).toMatchObject({
      state: "ready",
      total: 4,
      wins: 2,
    });
  });

  it("keeps a win rate only when the payload carries a real number", () => {
    expect(resolveRecord({ stats: { total: 2, winRateBp: 5000 } }).winRateBp).toBe(5000);
    expect(resolveRecord({ stats: { total: 2, winRateBp: null } }).winRateBp).toBeNull();
    expect(resolveRecord({ stats: { total: 2, winRateBp: "fast" } }).winRateBp).toBeNull();
    expect(resolveRecord({ stats: { total: 2, winRateBp: Number.POSITIVE_INFINITY } }).winRateBp).toBeNull();
    expect(resolveRecord({ stats: { total: 2, winRateBp: true } }).winRateBp).toBeNull();
  });
});

describe("formatMemberSince", () => {
  it("formats a real ISO timestamp in UTC without shifting the day", () => {
    expect(formatMemberSince("2025-01-01T00:00:00.000Z")).toBe("January 1, 2025");
    expect(formatMemberSince("2024-12-31T23:30:00.000Z")).toBe("December 31, 2024");
  });

  it("returns null for a missing value", () => {
    expect(formatMemberSince(null)).toBeNull();
    expect(formatMemberSince(undefined)).toBeNull();
    expect(formatMemberSince("")).toBeNull();
  });

  it("returns null for a value that is not a date", () => {
    expect(formatMemberSince("not-a-date")).toBeNull();
  });
});

describe("accountStatusLabel", () => {
  it("names the three states the account can report and stays honest when it cannot", () => {
    expect(accountStatusLabel("active")).toBe("Active account");
    expect(accountStatusLabel("suspended")).toBe("Suspended");
    expect(accountStatusLabel("banned")).toBe("Banned");
    expect(accountStatusLabel(null)).toBe("Account status unavailable");
    expect(accountStatusLabel(undefined)).toBe("Account status unavailable");
    expect(accountStatusLabel("shadowbanned")).toBe("Account status unavailable");
  });
});

describe("onboardingLabel", () => {
  it("reports a finished setup", () => {
    expect(onboardingLabel(true, "complete")).toBe("Profile setup complete");
    expect(onboardingLabel(true, "username")).toBe("Profile setup complete");
  });

  it("names the step the setup is waiting on", () => {
    expect(onboardingLabel(false, "username")).toBe("Needs a username");
    expect(onboardingLabel(false, "avatar")).toBe("Needs an avatar");
    expect(onboardingLabel(false, "wallet")).toBe("Needs a linked wallet");
  });

  it("stays general when the next step is unknown", () => {
    expect(onboardingLabel(false, "")).toBe("Profile setup incomplete");
    expect(onboardingLabel(false, "something-else")).toBe("Profile setup incomplete");
  });
});

describe("winRateLabel", () => {
  it("prints a rate with one decimal", () => {
    expect(winRateLabel(5432)).toBe("54.3%");
    expect(winRateLabel(0)).toBe("0.0%");
    expect(winRateLabel(10000)).toBe("100.0%");
  });

  it("prints n/a when no rate is known", () => {
    expect(winRateLabel(null)).toBe("n/a");
    expect(winRateLabel(Number.NaN)).toBe("n/a");
  });
});
