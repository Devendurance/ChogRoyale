// V2.2a Account XP policy boundaries: all 100 levels plus max behavior.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_XP_MAX_LEVEL,
  ACCOUNT_XP_PVP_WIN,
  ACCOUNT_XP_PVP_DRAW,
  ACCOUNT_XP_PVP_LOSS,
  ACCOUNT_XP_BOT_WIN,
  ACCOUNT_XP_BOT_DRAW,
  ACCOUNT_XP_BOT_LOSS,
  accountXpForResult,
  accountXpThresholdForLevel,
  levelForTotalXp,
  accountXpProgressForTotal,
  accountXpPvpGate,
  accountXpBotGate,
  accountXpReleaseEnabled,
} from "@/lib/account-xp";

describe("account xp curve", () => {
  it("anchors level 1 at zero and level 2 at 100", () => {
    expect(accountXpThresholdForLevel(1)).toBe(0);
    expect(accountXpThresholdForLevel(2)).toBe(100);
  });

  it("matches the authored examples", () => {
    expect(accountXpThresholdForLevel(3)).toBe(225);
    expect(accountXpThresholdForLevel(10)).toBe(1800);
    expect(accountXpThresholdForLevel(100)).toBe(131175);
  });

  it("covers all 100 levels monotonically with the closed form", () => {
    let prev = -1;
    for (let level = 1; level <= 100; level += 1) {
      const n = level - 1;
      const expected = 100 * n + (25 * n * (n - 1)) / 2;
      const threshold = accountXpThresholdForLevel(level);
      expect(threshold).toBe(expected);
      expect(threshold).toBeGreaterThan(prev);
      prev = threshold;
      expect(levelForTotalXp(threshold)).toBe(level);
      if (threshold > 0) expect(levelForTotalXp(threshold - 1)).toBe(level - 1);
    }
  });

  it("caps at 100 with null next level", () => {
    expect(levelForTotalXp(0)).toBe(1);
    expect(levelForTotalXp(-50)).toBe(1);
    expect(levelForTotalXp(131175)).toBe(100);
    expect(levelForTotalXp(999999)).toBe(100);
    const maxed = accountXpProgressForTotal(200000);
    expect(maxed.level).toBe(100);
    expect(maxed.maxLevel).toBe(true);
    expect(maxed.nextLevelThreshold).toBeNull();
    expect(maxed.xpToNext).toBeNull();
    expect(maxed.xpIntoLevel).toBe(200000 - 131175);
    const l1 = accountXpProgressForTotal(0);
    expect(l1.level).toBe(1);
    expect(l1.xpIntoLevel).toBe(0);
    expect(l1.xpToNext).toBe(100);
  });

  it("pays separate PvP and bot rates", () => {
    expect(accountXpForResult("matchmaking", "win")).toBe(ACCOUNT_XP_PVP_WIN);
    expect(accountXpForResult("matchmaking", "draw")).toBe(ACCOUNT_XP_PVP_DRAW);
    expect(accountXpForResult("matchmaking", "loss")).toBe(ACCOUNT_XP_PVP_LOSS);
    expect(accountXpForResult("unranked-fallback", "win")).toBe(ACCOUNT_XP_BOT_WIN);
    expect(accountXpForResult("unranked-fallback", "draw")).toBe(ACCOUNT_XP_BOT_DRAW);
    expect(accountXpForResult("unranked-fallback", "loss")).toBe(ACCOUNT_XP_BOT_LOSS);
    expect(ACCOUNT_XP_PVP_WIN).toBe(100);
    expect(ACCOUNT_XP_PVP_DRAW).toBe(75);
    expect(ACCOUNT_XP_PVP_LOSS).toBe(50);
    expect(ACCOUNT_XP_MAX_LEVEL).toBe(100);
  });

  it("keeps the release flag off by default", () => {
    expect(accountXpReleaseEnabled({})).toBe(false);
    expect(accountXpReleaseEnabled({ PLAYER_ACCOUNT_XP_ENABLED: "0" })).toBe(false);
    expect(accountXpReleaseEnabled({ PLAYER_ACCOUNT_XP_ENABLED: "1" })).toBe(true);
  });

  it("gates PvP sources", () => {
    const base = { verification: "replay-verified", ticks: 1800, acceptedDeploys: 5 };
    expect(accountXpPvpGate({ ...base, matchType: "matchmaking" })).toBe("eligible");
    expect(accountXpPvpGate({ ...base, matchType: "private" })).toBe("private-earns-zero");
    expect(accountXpPvpGate({ ...base, matchType: "practice" })).toBe("practice-earns-zero");
    expect(accountXpPvpGate({ ...base, matchType: "ranked" })).toBe("ranked-closed");
    expect(accountXpPvpGate({ ...base, matchType: "matchmaking", verification: "pending" })).toBe("unverified");
    expect(accountXpPvpGate({ matchType: "matchmaking", verification: "replay-verified", ticks: 100, acceptedDeploys: 5 })).toBe("short-match");
    expect(accountXpPvpGate({ matchType: "matchmaking", verification: "replay-verified", ticks: 1800, acceptedDeploys: 1 })).toBe("too-few-deploys");
  });

  it("gates bot awards on Gold confirmation", () => {
    expect(accountXpBotGate({ source: "unranked-fallback", ticks: 1800, acceptedDeploys: 3, goldConfirmed: true })).toBe("eligible");
    expect(accountXpBotGate({ source: "unranked-fallback", ticks: 1800, acceptedDeploys: 3, goldConfirmed: false })).toBe("awaiting-gold");
    expect(accountXpBotGate({ source: "practice", ticks: 1800, acceptedDeploys: 3, goldConfirmed: true })).toBe("practice-earns-zero");
  });
});
