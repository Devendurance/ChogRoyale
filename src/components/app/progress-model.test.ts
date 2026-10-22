// Focused tests for the A3.2a progress model.
//
// These are the rules the screen shows: a failed read is unavailable, a
// successful read with no rows is empty, match rows carry caller-side detail
// only, and leaderboard eligibility comes from the server.

import { describe, it, expect } from "vitest";
import {
  appendHistoryPage,
  failureBoard,
  failureHistory,
  failureStats,
  formatRecordDate,
  matchesToQualify,
  panelStateForCode,
  resolveBoard,
  resolveHistory,
  resolveMatchRow,
  resolveStanding,
  resolveStats,
  type MatchLookup,
} from "./progress-model";
import type { StatsSummary } from "./progress-types";

const lookup: MatchLookup = {
  classNames: { reaver: "Reaver", scout: "Scout" },
  cardNames: { choglings: "Choglings", rift_sentry: "Rift Sentry", frostshell: "Frostshell" },
};

const realStats = {
  stats: {
    total: 14,
    wins: 8,
    losses: 5,
    draws: 1,
    winRateBp: 5714,
    crownsEarned: 26,
    crownsConceded: 18,
    byType: {
      private: { matches: 5, wins: 2, losses: 3, draws: 0 },
      matchmaking: { matches: 9, wins: 6, losses: 2, draws: 1 },
    },
    firstMatchAt: "2026-09-18T17:40:00.000Z",
    latestMatchAt: "2026-10-21T20:05:00.000Z",
  },
  casual: { eligible: true, minMatches: 3, position: 4, matchmakingMatches: 9 },
};

const rawMatch = {
  matchId: "m-1",
  matchType: "matchmaking",
  settledAt: "2026-10-21T20:05:00.000Z",
  result: "win",
  crowns: { mine: 3, opponent: 1 },
  myCommander: { kind: "free", class: "reaver", name: "Ashen Recruit" },
  myDeck: ["choglings", "rift_sentry", "cmdr:free-reaver"],
  opponent: { username: "sparring-alpha" },
  verification: "replay-verified",
  stateHash: "state-hash-value",
  rulesetVersion: "v16",
  ticks: 1200,
  endReason: "core",
  mySeat: 0,
  seed: "seed-value",
  commands: ["secret-command"],
  wallet: "0xsecret",
  privyDid: "did:privy:secret",
};

describe("resolveStats", () => {
  it("reports a read that never arrived as unavailable, never as zero", () => {
    expect(resolveStats(null)).toMatchObject({
      state: "unavailable",
      total: 0,
      winRateBp: null,
      crownsEarned: null,
      byType: null,
      casual: null,
    });
    expect(resolveStats({ stats: null })).toMatchObject({ state: "unavailable" });
  });

  it("reads the real record without recomputing it", () => {
    const stats = resolveStats(realStats);
    expect(stats).toEqual({
      state: "ready",
      total: 14,
      wins: 8,
      losses: 5,
      draws: 1,
      winRateBp: 5714,
      crownsEarned: 26,
      crownsConceded: 18,
      byType: {
        private: { matches: 5, wins: 2, losses: 3, draws: 0 },
        matchmaking: { matches: 9, wins: 6, losses: 2, draws: 1 },
      },
      firstMatchAt: "2026-09-18T17:40:00.000Z",
      latestMatchAt: "2026-10-21T20:05:00.000Z",
      casual: { eligible: true, minMatches: 3, position: 4, matchmakingMatches: 9 },
    });
  });

  it("reports a successful total of zero as empty, not unavailable", () => {
    const stats = resolveStats({
      stats: { total: 0, wins: 0, losses: 0, draws: 0, winRateBp: null },
      casual: { eligible: false, minMatches: 3, position: null, matchmakingMatches: 0 },
    });
    expect(stats.state).toBe("empty");
    expect(stats.winRateBp).toBeNull();
    expect(stats.byType).toEqual({
      private: { matches: 0, wins: 0, losses: 0, draws: 0 },
      matchmaking: { matches: 0, wins: 0, losses: 0, draws: 0 },
    });
    expect(stats.casual).toMatchObject({ eligible: false, matchmakingMatches: 0 });
  });

  it("treats a partial record with matches as unavailable instead of guessing", () => {
    expect(
      resolveStats({ stats: { total: 3, wins: 2, losses: null, draws: 1 } }).state
    ).toBe("unavailable");
    expect(resolveStats({ stats: { total: null, wins: 0 } }).state).toBe("unavailable");
  });

  it("keeps a real record when the split is missing, and reports the split as unknown", () => {
    const stats = resolveStats({ stats: { total: 4, wins: 2, losses: 1, draws: 1 } });
    expect(stats.state).toBe("ready");
    expect(stats.byType).toBeNull();
    expect(stats.crownsEarned).toBeNull();
  });

  it("degrades unreadable counts and dates without throwing", () => {
    const stats = resolveStats({
      stats: {
        total: "4",
        wins: "2",
        losses: -1,
        draws: 1.9,
        winRateBp: 90000,
        crownsEarned: [],
        crownsConceded: { total: 2 },
        firstMatchAt: "not-a-date",
        latestMatchAt: 42,
      },
      casual: { eligible: "yes", minMatches: "3", position: -2, matchmakingMatches: "1" },
    });
    expect(stats).toMatchObject({
      state: "ready",
      total: 4,
      wins: 2,
      losses: 0,
      draws: 1,
      winRateBp: 10000,
      crownsEarned: null,
      crownsConceded: null,
      firstMatchAt: null,
      latestMatchAt: null,
    });
    expect(stats.casual).toMatchObject({
      eligible: false,
      minMatches: 3,
      position: null,
      matchmakingMatches: 1,
    });
  });
});

describe("formatRecordDate", () => {
  it("prints a date in UTC so the record cannot shift by timezone", () => {
    expect(formatRecordDate("2026-10-14T23:30:00.000Z")).toBe("14 Oct 2026");
    expect(formatRecordDate("2026-10-14T00:00:00.000Z")).toBe("14 Oct 2026");
  });

  it("returns null for missing and unreadable values", () => {
    expect(formatRecordDate(null)).toBeNull();
    expect(formatRecordDate("")).toBeNull();
    expect(formatRecordDate("not-a-date")).toBeNull();
  });
});

describe("resolveMatchRow", () => {
  it("maps the caller-side result, crowns, type, date, commander and deck", () => {
    const row = resolveMatchRow(rawMatch, 0, lookup);
    expect(row).toMatchObject({
      id: "m-1",
      result: "win",
      resultLabel: "Won",
      opponent: "sparring-alpha",
      crownsMine: 3,
      crownsOpponent: 1,
      matchType: "matchmaking",
      matchTypeLabel: "Matchmaking",
      settledAt: "2026-10-21T20:05:00.000Z",
      dateLabel: "21 Oct 2026",
      commanderName: "Ashen Recruit",
      commanderClassLabel: "Reaver",
      commanderKind: "free",
      deckSize: 3,
      deckPreview: ["Choglings", "Rift Sentry"],
      verified: true,
    });
  });

  it("does not carry seeds, commands, hashes, wallets or opponent loadouts", () => {
    const row = resolveMatchRow(
      { ...rawMatch, opponent: { username: "sparring-alpha", deck: ["secret"], commander: { name: "hidden" } } },
      0,
      lookup
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/state-hash-value|seed-value|secret-command|0xsecret|did:privy|private/);
    expect(Object.keys(row).sort()).toEqual(
      [
        "commanderClassLabel",
        "commanderKind",
        "commanderName",
        "crownsMine",
        "crownsOpponent",
        "dateLabel",
        "deckPreview",
        "deckSize",
        "id",
        "matchType",
        "matchTypeLabel",
        "opponent",
        "result",
        "resultLabel",
        "settledAt",
        "verified",
      ].sort()
    );
    expect(row.opponent).toBe("sparring-alpha");
  });

  it("labels a real loss and draw, and degrades an unknown result", () => {
    expect(resolveMatchRow({ ...rawMatch, result: "loss" }, 0, lookup).resultLabel).toBe("Lost");
    expect(resolveMatchRow({ ...rawMatch, result: "draw" }, 0, lookup).resultLabel).toBe("Drew");
    expect(resolveMatchRow({ ...rawMatch, result: "forfeit" }, 0, lookup)).toMatchObject({
      result: "unknown",
      resultLabel: "Result unavailable",
    });
  });

  it("survives a malformed row and a missing opponent", () => {
    const row = resolveMatchRow({ matchId: 7, result: 1, crowns: "3-1", settledAt: "x" }, 2, lookup);
    expect(row).toMatchObject({
      id: "match-2",
      result: "unknown",
      opponent: "Unknown opponent",
      crownsMine: null,
      crownsOpponent: null,
      matchType: "unknown",
      matchTypeLabel: "Type unavailable",
      settledAt: null,
      dateLabel: null,
      commanderName: null,
      deckSize: null,
      deckPreview: [],
      verified: false,
    });
    expect(resolveMatchRow(null, 4, lookup).id).toBe("match-4");
  });

  it("uses a real class name from the catalog and never invents a card name", () => {
    const row = resolveMatchRow(
      {
        ...rawMatch,
        myCommander: { kind: "free", class: "warden" },
        myDeck: ["choglings", "unknown-card", "cmdr:free-warden"],
      },
      0,
      lookup
    );
    expect(row.commanderName).toBe("Warden");
    expect(row.deckPreview).toEqual(["Choglings"]);
    expect(row.deckSize).toBe(3);
  });
});

describe("resolveHistory", () => {
  it("reports a failed read as unavailable and a missing list as unavailable", () => {
    expect(resolveHistory(null, lookup).state).toBe("unavailable");
    expect(resolveHistory({ items: null }, lookup).state).toBe("unavailable");
  });

  it("reports a successful empty page as empty, with no cursor", () => {
    expect(resolveHistory({ items: [], nextCursor: null }, lookup)).toEqual({
      state: "empty",
      rows: [],
      nextCursor: null,
    });
  });

  it("keeps the cursor for the next page and drops a malformed one", () => {
    const page = resolveHistory({ items: [rawMatch], nextCursor: "next-page" }, lookup);
    expect(page.state).toBe("ready");
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBe("next-page");
    expect(resolveHistory({ items: [rawMatch], nextCursor: "" }, lookup).nextCursor).toBeNull();
    expect(resolveHistory({ items: [rawMatch], nextCursor: 4 }, lookup).nextCursor).toBeNull();
  });
});

describe("appendHistoryPage", () => {
  it("appends without duplicate rows and advances the cursor", () => {
    const first = resolveHistory({ items: [rawMatch], nextCursor: "page-2" }, lookup);
    const second = resolveHistory(
      {
        items: [
          { ...rawMatch, matchId: "m-2", result: "loss" },
          rawMatch,
        ],
        nextCursor: null,
      },
      lookup
    );
    const merged = appendHistoryPage(first, second);
    expect(merged.state).toBe("ready");
    expect(merged.rows.map((row) => row.id)).toEqual(["m-1", "m-2"]);
    expect(merged.nextCursor).toBeNull();
  });

  it("keeps the saved rows when a follow-up page is empty", () => {
    const first = resolveHistory({ items: [rawMatch], nextCursor: "page-2" }, lookup);
    const merged = appendHistoryPage(first, resolveHistory({ items: [], nextCursor: null }, lookup));
    expect(merged.rows).toHaveLength(1);
    expect(merged.nextCursor).toBeNull();
    expect(merged.state).toBe("ready");
  });
});

describe("resolveBoard", () => {
  it("reports a failed read as unavailable and a missing list as unavailable", () => {
    expect(resolveBoard(null).state).toBe("unavailable");
    expect(resolveBoard({ entries: null }).state).toBe("unavailable");
  });

  it("reads real rows, server eligibility and the server's isYou flag", () => {
    const board = resolveBoard({
      entries: [
        {
          position: 1,
          username: "board-one",
          displayName: "Board One",
          avatar: { assetUrl: "/avatars/chog-ember.svg", name: "Ember" },
          matches: 12,
          wins: 9,
          losses: 2,
          draws: 1,
          winRateBp: 7500,
          crownsEarned: 22,
          isYou: false,
        },
        {
          position: 2,
          username: "board-two",
          displayName: null,
          avatar: null,
          matches: 8,
          wins: 5,
          losses: 3,
          draws: 0,
          winRateBp: 6250,
          crownsEarned: 14,
          isYou: true,
        },
      ],
      total: 2,
      limit: 10,
      offset: 0,
      minMatches: 3,
      me: { eligible: true, position: 2 },
    });
    expect(board.state).toBe("ready");
    expect(board.total).toBe(2);
    expect(board.minMatches).toBe(3);
    expect(board.me).toEqual({ eligible: true, position: 2 });
    expect(board.entries[0]).toMatchObject({
      position: 1,
      username: "board-one",
      displayName: "Board One",
      avatarUrl: "/avatars/chog-ember.svg",
      matches: 12,
      wins: 9,
      losses: 2,
      draws: 1,
      winRateBp: 7500,
      crownsEarned: 22,
      isYou: false,
    });
    expect(board.entries[1]).toMatchObject({ displayName: null, isYou: true });
  });

  it("reports a successful empty board as empty, not unavailable", () => {
    const board = resolveBoard({
      entries: [],
      total: 0,
      limit: 10,
      offset: 0,
      minMatches: 3,
      me: { eligible: false, position: null },
    });
    expect(board.state).toBe("empty");
    expect(board.entries).toEqual([]);
    expect(board.total).toBe(0);
  });

  it("does not claim an empty board when the payload says players qualified", () => {
    expect(resolveBoard({ entries: [], total: 12, offset: 0 }).state).toBe("unavailable");
    expect(resolveBoard({ entries: [], total: 12, offset: 10 }).state).toBe("empty");
  });

  it("never flips isYou on a truthy non-boolean and degrades malformed rows", () => {
    const board = resolveBoard({
      entries: [{ username: "board-one", isYou: "true", position: -1, matches: "3" }],
      total: -2,
    });
    expect(board.entries[0]).toMatchObject({
      position: null,
      username: "board-one",
      matches: 3,
      wins: 0,
      isYou: false,
    });
    expect(board.total).toBe(1);
  });
});

describe("resolveStanding and matchesToQualify", () => {
  const stats = resolveStats(realStats);

  it("prefers the leaderboard's own eligibility", () => {
    const board = resolveBoard({ entries: [], total: 0, minMatches: 5, me: { eligible: true, position: 7 } });
    expect(resolveStanding(stats, board)).toEqual({
      eligible: true,
      position: 7,
      minMatches: 5,
      matchmakingMatches: 9,
      source: "board",
    });
  });

  it("falls back to the stats payload when the board did not answer", () => {
    const board = failureBoard("unavailable");
    expect(resolveStanding(stats, board)).toEqual({
      eligible: true,
      position: 4,
      minMatches: 3,
      matchmakingMatches: 9,
      source: "stats",
    });
  });

  it("returns null when neither source carries a standing", () => {
    expect(resolveStanding(failureStats("unavailable"), failureBoard("unavailable"))).toBeNull();
  });

  it("turns the server minimum and count into a display gap only", () => {
    const standing = {
      eligible: false,
      position: null,
      minMatches: 3,
      matchmakingMatches: 1,
      source: "stats" as const,
    };
    expect(matchesToQualify(standing)).toBe(2);
    expect(matchesToQualify({ ...standing, matchmakingMatches: 3 })).toBe(0);
    expect(matchesToQualify({ ...standing, eligible: true })).toBeNull();
    expect(matchesToQualify({ ...standing, minMatches: null })).toBeNull();
    expect(matchesToQualify(null)).toBeNull();
  });
});

describe("state helpers", () => {
  it("maps a failed route code to the honest panel state", () => {
    expect(panelStateForCode("UNAUTHORIZED")).toBe("auth");
    expect(panelStateForCode("FORBIDDEN")).toBe("locked");
    expect(panelStateForCode("INTERNAL_ERROR")).toBe("unavailable");
    expect(panelStateForCode("NETWORK")).toBe("unavailable");
  });

  it("keeps every failure state for the panels", () => {
    for (const state of ["unavailable", "locked", "auth"] as const) {
      const stats: StatsSummary = failureStats(state);
      expect(stats.state).toBe(state);
      expect(failureHistory(state).state).toBe(state);
      expect(failureBoard(state).state).toBe(state);
    }
  });
});
