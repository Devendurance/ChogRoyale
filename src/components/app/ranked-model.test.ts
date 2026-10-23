import { describe, expect, it } from "vitest";
import { awardForMatch, failureRanked, resolveRankedBoard, resolveRankedSummary } from "./ranked-model";

describe("ranked presentation model", () => {
  it("keeps a new player in the honest empty state", () => {
    const view = resolveRankedSummary({
      season: 1,
      trophies: 0,
      eligible: false,
      position: null,
      rankedMatches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      recent: [],
    });
    expect(view.state).toBe("empty");
    expect(view.trophies).toBe(0);
    expect(view.recent).toEqual([]);
  });

  it("uses server positions and preserves tied board order", () => {
    const view = resolveRankedBoard({
      kind: "ranked-season-1",
      season: 1,
      ordering: "trophies, then ranked wins, then username",
      entries: [
        { position: 2, username: "alpha", displayName: null, avatar: null, season: 1, trophies: 25, matches: 1, wins: 1, losses: 0, draws: 0, isYou: true },
        { position: 2, username: "bravo", displayName: null, avatar: null, season: 1, trophies: 25, matches: 1, wins: 0, losses: 1, draws: 0, isYou: false },
      ],
      total: 2,
      limit: 10,
      offset: 0,
      me: { position: 2, eligible: true, trophies: 25, rankedMatches: 1 },
    });
    expect(view.entries.map((entry) => entry.username)).toEqual(["alpha", "bravo"]);
    expect(view.entries.map((entry) => entry.position)).toEqual([2, 2]);
    expect(view.me).toMatchObject({ position: 2, trophies: 25 });
  });

  it("only exposes an award for the exact confirmed match", () => {
    const recent = resolveRankedSummary({
      season: 1,
      trophies: 25,
      eligible: true,
      position: 1,
      rankedMatches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      recent: [{ matchId: "m1", result: "win", delta: 25, balanceAfter: 25, finishedAt: null }],
    }).recent;
    expect(awardForMatch(recent, "m1")?.delta).toBe(25);
    expect(awardForMatch(recent, "m2")).toBeNull();
    expect(awardForMatch(recent, null)).toBeNull();
  });

  it("does not turn an unavailable read into a zero balance", () => {
    expect(failureRanked("unavailable")).toMatchObject({ state: "unavailable", trophies: null, position: null, recent: [] });
  });
});
