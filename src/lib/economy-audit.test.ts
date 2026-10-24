// P6e.1 focused tests: deterministic fixtures, no DB, no network.
import { describe, expect, it } from "vitest";
import {
  AUDIT_ENFORCEMENT_NOTE,
  buildReport,
  detectGiftRisks,
  detectSuspectPatterns,
  duplicateSponsorshipKeys,
  formatReport,
  isGoldXpEligible,
  isRankedEligible,
  orphanSponsorshipSpends,
  pendingCardXpRuns,
  pendingGoldEarn,
  pendingRankedAwards,
  rankedInconsistencies,
  reportHasFail,
  reportToJson,
  sponsorshipSpendMismatches,
  stagedButUnappliedRanked,
  xpInconsistencies,
  type AuditMatch,
  type AuditParticipant,
  type EconomyAuditReport,
  type GoldEarnRow,
  type RankedAwardRow,
  type SponsorshipRow,
} from "@/lib/economy-audit";
import * as fs from "node:fs";
import * as path from "node:path";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const M1 = "11111111-0000-4000-8000-000000000011";
const M2 = "22222222-0000-4000-8000-000000000022";

function parts(matchId: string, type: string, at: number, aRes: "win" | "loss" | "draw", bRes: "win" | "loss" | "draw"): AuditParticipant[] {
  return [
    { matchId, playerId: A, result: aRes, matchType: type, finishedAtMs: at },
    { matchId, playerId: B, result: bRes, matchType: type, finishedAtMs: at },
  ];
}

function healthyInput() {
  const matches: AuditMatch[] = [
    { id: M1, matchType: "matchmaking", verification: "replay-verified", finishedAtMs: 1000, seats: [{ playerId: A, result: "win" }, { playerId: B, result: "loss" }] },
  ];
  const participants = parts(M1, "matchmaking", 1000, "win", "loss");
  const earn: GoldEarnRow[] = [
    { matchId: M1, playerId: A, amount: 60, result: "win" },
    { matchId: M1, playerId: B, amount: 30, result: "loss" },
  ];
  const awards: RankedAwardRow[] = [];
  return { matches, participants, earn, awards };
}

describe("P6e.1 economy audit", () => {
  it("passes healthy ledger data", () => {
    const { matches, participants, earn } = healthyInput();
    expect(pendingGoldEarn(participants, earn)).toEqual([]);
    const report = buildReport({
      branch: "test-branch", matchesReadable: true,
      matches,
      participants,
      earnRows: earn,
      spendRows: [],
      sponsorships: [],
      knownSponsorshipSpendKeys: new Set(),
      xpProgress: [{ playerId: A, cardId: "chogling", xp: 5, level: 2, purchasedLevel: 1 }],
      rankedAwards: [],
      rankedBalances: [],
      cardXpRunIds: new Set([M1]),
      legacyRunIds: new Set([M1]),
      knownPlayerIds: new Set([A, B]),
    });
    expect(reportHasFail(report)).toBe(false);
    expect(report.pending.every((f) => f.status === "PASS")).toBe(true);
  });

  it("flags missing awards but never flags ineligible private matches", () => {
    const priv: AuditParticipant[] = parts(M2, "private", 2000, "win", "loss");
    expect(pendingGoldEarn(priv, [])).toEqual([]);
    expect(pendingRankedAwards(priv, [])).toEqual([]);
    const ranked: AuditParticipant[] = parts(M2, "ranked", 2000, "win", "loss");
    expect(pendingRankedAwards(ranked, [])).toHaveLength(2);
    expect(pendingGoldEarn(ranked, [])).toHaveLength(2);
    expect(isGoldXpEligible("private", "replay-verified")).toBe(false);
    expect(isRankedEligible("matchmaking", "replay-verified")).toBe(false);
    expect(isRankedEligible("ranked", "replay-verified")).toBe(true);
  });

  it("respects the no-backfill rule for legacy friendships", () => {
    // pendingCardXpRuns only reports eligible verified matches; it never
    // invents rewardability for private history or null-accepted friendships.
    const ms: AuditMatch[] = [
      { id: M1, matchType: "private", verification: "replay-verified", finishedAtMs: 1, seats: [] },
      { id: M2, matchType: "matchmaking", verification: "replay-verified", finishedAtMs: 2, seats: [] },
    ];
    expect(pendingCardXpRuns(ms, new Set())).toEqual([M2]);
  });

  it("detects negative derived Gold balances", () => {
    const report = buildReport({
      branch: "t", matchesReadable: true, matches: [], participants: [], earnRows: [{ matchId: M1, playerId: A, amount: 30, result: "loss" }],
      spendRows: [{ idempotencyKey: "k1", playerId: A, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100 }],
      sponsorships: [], knownSponsorshipSpendKeys: new Set(), xpProgress: [], rankedAwards: [],
      rankedBalances: [], cardXpRunIds: new Set(), legacyRunIds: new Set(), knownPlayerIds: null,
    });
    const f = report.integrity.find((x) => x.check === "gold-derived-balances")!;
    expect(f.status).toBe("FAIL");
  });

  it("flags orphan sponsorships and spend mismatches, catches duplicates", () => {
    const receipts: SponsorshipRow[] = [
      { id: "r1", idempotencyKey: "k1", sponsorId: A, recipientId: B, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100, createdAtMs: 1 },
      { id: "r2", idempotencyKey: "k1", sponsorId: A, recipientId: B, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100, createdAtMs: 2 },
    ];
    expect(duplicateSponsorshipKeys(receipts)).toEqual(["k1"]);
    expect(sponsorshipSpendMismatches([receipts[0]!], [])).toHaveLength(1);
    expect(
      orphanSponsorshipSpends([], [{ idempotencyKey: "k9", playerId: A, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100 }], new Set(["k9"]))
    ).toHaveLength(1);
    expect(
      sponsorshipSpendMismatches([receipts[0]!], [{ idempotencyKey: "k1", playerId: A, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100 }])
    ).toEqual([]);
  });

  it("detects XP and ranked inconsistencies", () => {
    expect(xpInconsistencies([{ playerId: A, cardId: "c", xp: 0, level: 2, purchasedLevel: 1 }])).toHaveLength(1);
    expect(xpInconsistencies([{ playerId: A, cardId: "c", xp: 5, level: 2, purchasedLevel: 2 }])).toHaveLength(0);
    expect(xpInconsistencies([{ playerId: A, cardId: "c", xp: 0, level: 1, purchasedLevel: 2 }])).toHaveLength(1);
    const bad: RankedAwardRow[] = [
      { matchId: M1, playerId: A, season: 1, result: "win", delta: 10, balanceAfter: 10 },
      { matchId: M1, playerId: B, season: 1, result: "loss", delta: -20, balanceAfter: null },
    ];
    expect(rankedInconsistencies(bad, [])).toHaveLength(1);
    expect(stagedButUnappliedRanked(bad)).toHaveLength(1);
    expect(rankedInconsistencies(bad, [{ playerId: A, season: 1, trophies: -5, rankedMatches: 1, rankedWins: 0, rankedLosses: 0, rankedDraws: 0 }])).toHaveLength(3);
  });

  it("flags repeated-opponent candidates but never calls normal rematches cheating", () => {
    const few: AuditParticipant[] = [];
    for (let i = 0; i < 2; i += 1) few.push(...parts(`m-${i}`, "matchmaking", i * 1000, "win", "loss"));
    const quiet = detectSuspectPatterns(few);
    expect(quiet.filter((s) => s.kind === "repeated-opponent")).toEqual([]);
    const many: AuditParticipant[] = [];
    for (let i = 0; i < 6; i += 1) {
      many.push(...parts(`n-${i}`, "matchmaking", 1_000_000 + i * 10 * 60 * 1000, i % 2 === 0 ? "win" : "loss", i % 2 === 0 ? "loss" : "win"));
    }
    const loud = detectSuspectPatterns(many);
    expect(loud.some((s) => s.kind === "repeated-opponent")).toBe(true);
    expect(loud.some((s) => s.kind === "reciprocal-wins")).toBe(true);
    for (const s of loud) expect(s.detail).toMatch(/provisional|look identical|prove nothing/);
    expect(AUDIT_ENFORCEMENT_NOTE).toMatch(/NOT APPROVED FOR ENFORCEMENT/);
  });

  it("flags gift concentration and reciprocal clusters as review-only", () => {
    const receipts: SponsorshipRow[] = [];
    for (let i = 0; i < 3; i += 1) {
      receipts.push({ id: `g${i}`, idempotencyKey: `gk${i}`, sponsorId: A, recipientId: B, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100, createdAtMs: i * 1000 });
    }
    receipts.push({ id: "back", idempotencyKey: "gk9", sponsorId: B, recipientId: A, cardId: "c", fromLevel: 1, toLevel: 2, cost: 100, createdAtMs: 500 });
    const risks = detectGiftRisks(receipts);
    expect(risks.some((r) => r.kind === "repeated-gifting")).toBe(true);
    expect(risks.some((r) => r.kind === "reciprocal-cluster")).toBe(true);
    expect(detectGiftRisks([])).toEqual([]);
  });

  it("marks missing tables unavailable instead of manufacturing a PASS", () => {
    expect(pendingGoldEarn([], null)).toBeNull();
    const report = buildReport({
      branch: "t", matchesReadable: false, matches: [], participants: [], earnRows: null, spendRows: null, sponsorships: [],
      knownSponsorshipSpendKeys: new Set(), xpProgress: [], rankedAwards: [], rankedBalances: [],
      cardXpRunIds: null, legacyRunIds: null, knownPlayerIds: null,
    });
    const checks = [...report.coverage, ...report.integrity, ...report.pending].map((f) => f.status);
    expect(checks).toContain("NOT_CHECKABLE");
    expect(checks).not.toContain("FAIL");
  });

  it("keeps the audit read-only, valid JSON and secret-free", () => {
    const libSrc = fs.readFileSync(path.join(__dirname, "economy-audit.ts"), "utf8");
    expect(libSrc).not.toMatch(/from "@\/db\//);
    expect(libSrc).not.toMatch(/\.execute\(/);
    expect(libSrc).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/i);
    const scriptSrc = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "economy-audit.ts"), "utf8");
    expect(scriptSrc).not.toMatch(/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i);
    expect(scriptSrc).toMatch(/requireTestDatabaseUrl/);
    const report = buildReport({
      branch: "test-branch-ep", matchesReadable: true, matches: [], participants: [], earnRows: [], spendRows: [], sponsorships: [],
      knownSponsorshipSpendKeys: new Set(), xpProgress: [], rankedAwards: [], rankedBalances: [],
      cardXpRunIds: new Set(), legacyRunIds: new Set(), knownPlayerIds: new Set(),
    });
    const json = reportToJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as EconomyAuditReport;
    expect(parsed.environment.branch).toBe("test-branch-ep");
    const blob = `${json}\n${formatReport(report)}`.toLowerCase();
    for (const secret of ["database_url", "privy", "wallet", "seed", "mnemonic", "secret", "bearer", "token_id"]) {
      expect(blob).not.toContain(secret);
    }
    // C is an unused player id fixture guard; reference it so fixtures stay honest.
    expect(C.length).toBeGreaterThan(0);
  });
});
