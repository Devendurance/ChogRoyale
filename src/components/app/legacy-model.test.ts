// Focused tests for the A3.2b legacy model.
//
// These are the rules the vault shows: holdings are cached observations, a
// commander appearance carries its own match-start ownership proof, an Arena
// Patron appearance is separate, a failed read is unavailable, and only a
// successful zero-row payload is empty. Event rows never expose authority keys,
// match ids, hashes or payloads.

import { describe, it, expect } from "vitest";
import {
  appendLegacyPage,
  defaultTokenId,
  eligibilityLabel,
  failureRecord,
  failureVault,
  formatLegacyDate,
  resolveAchievements,
  resolveLegacyRecord,
  resolveVault,
  visibleTrail,
  type LegacyLookup,
} from "./legacy-model";

const lookup: LegacyLookup = {
  classes: {
    reaver: {
      className: "Reaver",
      art: { src: "/assets/site/mascots/reaver-commander-class.png", width: 547, height: 634 },
    },
    bulwark: {
      className: "Bulwark",
      art: { src: "/assets/site/commanders/bulwark.png", width: 531, height: 690 },
    },
  },
};

const holdings = {
  holdings: [
    {
      tokenId: "90002",
      name: "CHOG #90002",
      image: null,
      observedAt: "2026-10-20T10:00:00.000Z",
      freshness: "cached",
    },
    {
      tokenId: "90001",
      name: "CHOG #90001",
      image: "ipfs://fixture/90001",
      observedAt: "2026-10-21T10:00:00.000Z",
      freshness: "cached",
    },
  ],
  walletsChecked: 2,
  freshness: "cached",
};

const commanders = {
  nftCommanders: [
    {
      tokenId: "90001",
      name: "CHOG #90001",
      imageUrl: "https://ipfs.filebase.io/ipfs/fixture/90001",
      status: "derived",
      eligible: true,
      eligibilityFreshness: "cached",
      commander: { class: "reaver" },
    },
    {
      tokenId: "90002",
      name: null,
      imageUrl: null,
      status: "pending",
      eligible: false,
      commander: null,
    },
  ],
};

const rawEvent = (overrides: Record<string, unknown>) => ({
  id: "event-1",
  authorityKey: "secret-authority-key",
  category: "commander_appearance",
  matchId: "secret-match-id",
  matchStatus: "finalized",
  payload: {
    seat: 0,
    matchType: "matchmaking",
    result: "win",
    crowns: { mine: 3, opponent: 1 },
    endReason: "core",
    commanderClass: "reaver",
    variant: "origin",
    derivationHash: "secret-derivation-hash",
    basis: "direct-owner",
    evidenceSha256: "secret-evidence-hash",
  },
  rulesetRefs: { combat: "v16", protocol: "b3.1", commander: "v1" },
  source: "b3-settlement",
  status: "recorded",
  occurredAt: "2026-10-21T20:05:00.000Z",
  ...overrides,
});

const history = [
  rawEvent({}),
  rawEvent({
    id: "event-2",
    category: "patron_appearance",
    payload: {
      matchType: "private",
      theme: "ember",
      configHash: "secret-config-hash",
      scheduleHash: "secret-schedule-hash",
      evidenceSha256: "secret-evidence-hash",
    },
  }),
  rawEvent({
    id: "event-3",
    category: "achievement",
    payload: { code: "first_blood", earnedInMatch: "secret-match-id" },
  }),
  rawEvent({
    id: "event-4",
    category: "commander_outcome",
    payload: { result: "victory", crowns: [3, 1] },
  }),
  rawEvent({
    id: "event-5",
    status: "corrected",
    payload: {
      result: "loss",
      crowns: { mine: 1, opponent: 3 },
      matchType: "matchmaking",
      commanderClass: "reaver",
      basis: "direct-owner",
    },
  }),
  rawEvent({
    id: "event-6",
    category: "patron_appearance",
    payload: { matchType: "matchmaking", theme: "frost" },
  }),
];

const legacyPayload = {
  tokenId: "90001",
  name: "CHOG #90001",
  stats: {
    commanderAppearances: 2,
    patronAppearances: 2,
    victories: 1,
    defeats: 1,
    achievements: ["first_blood"],
  },
  total: 6,
  history,
};

describe("resolveVault", () => {
  it("lists held tokens with class, art and cached entitlement labels", () => {
    const vault = resolveVault(holdings, commanders, lookup);
    expect(vault.state).toBe("ready");
    expect(vault.walletsChecked).toBe(2);
    expect(vault.latestObservedLabel).toBe("21 Oct 2026");
    expect(vault.classDataAvailable).toBe(true);
    expect(vault.tokens.map((token) => token.tokenId)).toEqual(["90001", "90002"]);

    expect(vault.tokens[0]).toMatchObject({
      tokenId: "90001",
      name: "CHOG #90001",
      classId: "reaver",
      className: "Reaver",
      eligibility: "eligible",
      eligibilityFreshness: "cached",
      holdingFreshness: "cached",
      observedLabel: "21 Oct 2026",
      imageUrl: "https://ipfs.filebase.io/ipfs/fixture/90001",
    });
    expect(vault.tokens[0]!.classArt).toMatchObject({ src: "/assets/site/mascots/reaver-commander-class.png" });
    expect(vault.tokens[1]).toMatchObject({
      name: "CHOG #90002",
      classId: null,
      className: null,
      eligibility: "pending",
      imageUrl: null,
    });
  });

  it("keeps holdings when commander enrichment is unavailable, without inventing classes", () => {
    const vault = resolveVault(holdings, null, lookup);
    expect(vault.state).toBe("ready");
    expect(vault.classDataAvailable).toBe(false);
    expect(vault.tokens.every((token) => token.eligibility === "no-class")).toBe(true);
    expect(vault.tokens.every((token) => token.className === null)).toBe(true);
  });

  it("reports a successful empty holdings read as empty", () => {
    const vault = resolveVault({ holdings: [], walletsChecked: 2 }, commanders, lookup);
    expect(vault.state).toBe("empty");
    expect(vault.tokens).toEqual([]);
  });

  it("reports zero checked wallets as the no-wallet state", () => {
    const vault = resolveVault({ holdings: [], walletsChecked: 0 }, commanders, lookup);
    expect(vault.state).toBe("no-wallet");
  });

  it("reports failed and malformed reads as unavailable, not empty", () => {
    expect(resolveVault(null, commanders, lookup).state).toBe("unavailable");
    expect(resolveVault({ holdings: null, walletsChecked: 2 }, commanders, lookup).state).toBe("unavailable");
    expect(resolveVault({}, commanders, lookup).state).toBe("unavailable");
  });

  it("rejects unsafe artwork URLs and never treats a missing wallet count as zero wallets", () => {
    const vault = resolveVault(
      {
        holdings: [
          {
            tokenId: "90001",
            name: "CHOG #90001",
            observedAt: null,
            freshness: "cached",
          },
        ],
      },
      {
        nftCommanders: [
          {
            tokenId: "90001",
            name: "CHOG #90001",
            imageUrl: "javascript:alert(1)",
            status: "derived",
            eligible: true,
            commander: { class: "reaver" },
          },
        ],
      },
      lookup
    );
    expect(vault.state).toBe("ready");
    expect(vault.tokens[0]!.imageUrl).toBeNull();
    expect(vault.walletsChecked).toBeNull();
  });

  it("defaults selection to the first held token", () => {
    expect(defaultTokenId(resolveVault(holdings, commanders, lookup))).toBe("90001");
    expect(defaultTokenId(failureVault("unavailable"))).toBeNull();
  });

  it("keeps the long entitlement label separate from the short list chip", () => {
    const vault = resolveVault(holdings, commanders, lookup);
    expect(eligibilityLabel(vault.tokens[0]!)).toBe("Commander eligible, cached");
  });
});

describe("resolveLegacyRecord", () => {
  it("maps verified commander, patron, achievement and outcome events", () => {
    const record = resolveLegacyRecord(legacyPayload, 0, lookup);
    expect(record.state).toBe("ready");
    expect(record.tokenId).toBe("90001");
    expect(record.name).toBe("CHOG #90001");
    expect(record.stats).toEqual({
      commanderAppearances: 2,
      patronAppearances: 2,
      victories: 1,
      defeats: 1,
      achievementCodes: ["first_blood"],
    });
    expect(record.total).toBe(6);
    expect(record.history).toHaveLength(6);
    expect(record.nextOffset).toBeNull();

    const commander = record.history[0]!;
    expect(commander).toMatchObject({
      kind: "commander",
      kindLabel: "Commander appearance",
      status: "recorded",
      verified: true,
      result: "victory",
      resultLabel: "Victory",
      crownsMine: 3,
      crownsOpponent: 1,
      matchTypeLabel: "Matchmaking",
      className: "Reaver",
      dateLabel: "21 Oct 2026",
      ownershipVerified: true,
    });

    const patron = record.history[1]!;
    expect(patron).toMatchObject({
      kind: "patron",
      kindLabel: "Arena Patron appearance",
      themeLabel: "Ember",
      matchTypeLabel: "Private room",
      result: null,
      crownsMine: null,
    });

    const achievement = record.history[2]!;
    expect(achievement).toMatchObject({
      kind: "achievement",
      achievementName: "First Blood",
      result: null,
    });

    const outcome = record.history[3]!;
    expect(outcome).toMatchObject({ kind: "outcome", result: "victory", crownsMine: null });

    const corrected = record.history[4]!;
    expect(corrected).toMatchObject({ status: "corrected", verified: false, result: "defeat" });
    expect(visibleTrail(record.history).map((row) => row.kind)).toEqual([
      "commander",
      "patron",
      "achievement",
      "commander",
      "patron",
    ]);
  });

  it("never carries internal identifiers, hashes or the raw payload in a row", () => {
    const row = resolveLegacyRecord(legacyPayload, 0, lookup).history[0]!;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(
      /secret-authority-key|secret-match-id|secret-derivation-hash|secret-evidence-hash|secret-config-hash|secret-schedule-hash|b3-settlement/
    );
    expect(Object.keys(row).sort()).toEqual(
      [
        "achievementName",
        "className",
        "crownsMine",
        "crownsOpponent",
        "dateLabel",
        "id",
        "kind",
        "kindLabel",
        "matchTypeLabel",
        "occurredAt",
        "ownershipVerified",
        "result",
        "resultLabel",
        "status",
        "themeLabel",
        "verified",
      ].sort()
    );
  });

  it("reports a successful total of zero as empty", () => {
    const record = resolveLegacyRecord(
      {
        tokenId: "90001",
        name: "CHOG #90001",
        stats: {
          commanderAppearances: 0,
          patronAppearances: 0,
          victories: 0,
          defeats: 0,
          achievements: [],
        },
        total: 0,
        history: [],
      },
      0,
      lookup
    );
    expect(record.state).toBe("empty");
    expect(record.stats).toEqual({
      commanderAppearances: 0,
      patronAppearances: 0,
      victories: 0,
      defeats: 0,
      achievementCodes: [],
    });
    expect(record.history).toEqual([]);
    expect(record.nextOffset).toBeNull();
  });

  it("distinguishes an unavailable read, a broken total and a contradictory zero", () => {
    expect(resolveLegacyRecord(null, 0, lookup).state).toBe("unavailable");
    expect(resolveLegacyRecord({ stats: null, total: 0, history: [] }, 0, lookup).state).toBe("unavailable");
    expect(resolveLegacyRecord({ ...legacyPayload, history: null }, 0, lookup).state).toBe("unavailable");
    expect(
      resolveLegacyRecord(
        {
          ...legacyPayload,
          total: 0,
          history: [],
        },
        0,
        lookup
      ).state
    ).toBe("unavailable");
  });

  it("keeps a usable page when individual events are malformed", () => {
    const record = resolveLegacyRecord(
      { ...legacyPayload, history: [null, { id: "bad" }, rawEvent({})] },
      0,
      lookup
    );
    expect(record.state).toBe("ready");
    expect(record.total).toBe(6);
    expect(record.history).toHaveLength(1);
  });

  it("computes the next offset from the raw page, not the visible trail", () => {
    const record = resolveLegacyRecord({ ...legacyPayload, total: 12 }, 0, lookup);
    expect(record.nextOffset).toBe(6);
    const second = resolveLegacyRecord({ ...legacyPayload, total: 12 }, 6, lookup);
    expect(second.nextOffset).toBeNull();
  });

  it("appends a page once and updates the cursor", () => {
    const first = resolveLegacyRecord({ ...legacyPayload, total: 12 }, 0, lookup);
    const second = resolveLegacyRecord(
      {
        ...legacyPayload,
        total: 12,
        history: [
          rawEvent({ id: "event-6", category: "patron_appearance", payload: { theme: "rift" } }),
          rawEvent({ id: "event-7", category: "patron_appearance", payload: { theme: "rally" } }),
        ],
      },
      6,
      lookup
    );
    const merged = appendLegacyPage(first, second);
    expect(merged.history).toHaveLength(7);
    expect(merged.nextOffset).toBe(8);
    expect(merged.state).toBe("ready");
    expect(new Set(merged.history.map((row) => row.id)).size).toBe(7);
  });

  it("keeps the existing rows when a follow-up page is empty", () => {
    const first = resolveLegacyRecord({ ...legacyPayload, total: 12 }, 0, lookup);
    const merged = appendLegacyPage(first, failureRecord("unavailable"));
    expect(merged).toBe(first);
  });
});

describe("resolveAchievements", () => {
  const record = resolveLegacyRecord(legacyPayload, 0, lookup);
  const earnedPayload = {
    achievements: [
      {
        code: "first_blood",
        name: "First Blood",
        awardedAt: "2026-10-21T20:05:00.000Z",
      },
      {
        code: "first_victory",
        name: "First Victory",
        awardedAt: "2026-10-21T20:05:00.000Z",
      },
    ],
  };

  it("shows earned awards and verified progress for locked rules", () => {
    const summary = resolveAchievements(record, earnedPayload);
    expect(summary.state).toBe("ready");
    expect(summary.earnedCount).toBe(2);
    expect(summary.items.slice(0, 2).every((item) => item.state === "earned")).toBe(true);
    expect(summary.items[0]).toMatchObject({
      code: "first_blood",
      name: "First Blood",
      awardedLabel: "21 Oct 2026",
      progressAvailable: false,
    });
    const veteran = summary.items.find((item) => item.code === "veteran")!;
    expect(veteran.state).toBe("locked");
    expect(veteran.progressLabel).toBe("2 of 5 commander appearances");
    expect(veteran.progressCurrent).toBe(2);
    expect(veteran.progressTarget).toBe(5);
    const paragon = summary.items.find((item) => item.code === "paragon")!;
    expect(paragon.progressLabel).toBe("2 of 10 Arena Patron appearances");
  });

  it("falls back to the verified legacy codes when award details are unavailable", () => {
    const summary = resolveAchievements(record, null);
    expect(summary.state).toBe("partial");
    expect(summary.earnedCount).toBe(1);
    expect(summary.items.find((item) => item.code === "first_blood")).toMatchObject({
      state: "earned",
      awardedLabel: null,
    });
    expect(summary.note).toMatch(/Award dates are unavailable/);
  });

  it("does not draw progress when the server has not awarded a rule the counts appear to meet", () => {
    const contradictory = resolveLegacyRecord(
      {
        ...legacyPayload,
        stats: {
          commanderAppearances: 6,
          patronAppearances: 12,
          victories: 2,
          defeats: 0,
          achievements: [],
        },
      },
      0,
      lookup
    );
    const summary = resolveAchievements(contradictory, { achievements: [] });
    for (const code of ["first_blood", "first_victory", "veteran", "paragon"]) {
      const item = summary.items.find((entry) => entry.code === code)!;
      expect(item.state).toBe("locked");
      expect(item.progressAvailable).toBe(false);
      expect(item.progressCurrent).toBeNull();
    }
  });

  it("shows every authored rule as locked with zero progress for a genuine empty record", () => {
    const empty = resolveLegacyRecord(
      {
        tokenId: "90001",
        name: "CHOG #90001",
        stats: {
          commanderAppearances: 0,
          patronAppearances: 0,
          victories: 0,
          defeats: 0,
          achievements: [],
        },
        total: 0,
        history: [],
      },
      0,
      lookup
    );
    const summary = resolveAchievements(empty, { achievements: [] });
    expect(summary.state).toBe("ready");
    expect(summary.earnedCount).toBe(0);
    expect(summary.items).toHaveLength(4);
    expect(summary.items.every((item) => item.state === "locked")).toBe(true);
    expect(summary.items.every((item) => item.progressAvailable)).toBe(true);
  });

  it("keeps an award from the API even when it is outside the authored catalog", () => {
    const summary = resolveAchievements(record, {
      achievements: [{ code: "future_award", name: "Future Award", awardedAt: null }],
    });
    expect(summary.state).toBe("ready");
    expect(summary.earnedCount).toBe(2);
    const future = summary.items.find((item) => item.code === "future_award")!;
    expect(future).toMatchObject({
      state: "earned",
      name: "Future Award",
      description: "Details are unavailable for this award.",
      awardedLabel: null,
    });
  });

  it("reports the record's lock and failure states without inventing awards", () => {
    expect(resolveAchievements(failureRecord("unavailable"), null).state).toBe("unavailable");
    expect(resolveAchievements(failureRecord("not-found"), null).state).toBe("unavailable");
    expect(resolveAchievements(failureRecord("locked"), null).state).toBe("locked");
    expect(resolveAchievements(failureRecord("auth"), null).state).toBe("auth");
  });
});

describe("date and failure helpers", () => {
  it("formats dates in UTC and rejects unreadable values", () => {
    expect(formatLegacyDate("2026-10-21T20:05:00.000Z")).toBe("21 Oct 2026");
    expect(formatLegacyDate(null)).toBeNull();
    expect(formatLegacyDate("not-a-date")).toBeNull();
  });

  it("keeps failure states explicit", () => {
    expect(failureVault("unavailable").state).toBe("unavailable");
    expect(failureRecord("not-found").state).toBe("not-found");
    expect(failureRecord("auth").history).toEqual([]);
  });
});
