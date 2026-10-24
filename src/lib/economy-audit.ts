// P6e.1 economy integrity audit. Pure, client-safe, no DB imports.
// All checks run over plain row inputs so unit tests stay deterministic
// and the operator CLI stays a thin SELECT-only reader.
//
// Eligibility mirrors the subsystem policies:
// - Gold/XP: matchmaking + ranked, replay-verified only. Private earns zero.
// - Ranked trophies: ranked + replay-verified only.
// - Sponsorship: TEST caps (1 recipient/day, 3 sender/week, 1 pair-card/week)
//   plus the 30-day accepted-friendship anchor, which is never backfilled.
// - Private absence of rewards is ineligible, never a failure.
//
// Risk thresholds below are provisional and NOT APPROVED FOR ENFORCEMENT.
// They flag candidates for human review only. A repeated opponent alone is
// never cheating: friends rematch, small queues repeat, sessions cluster.

import {
  CARD_XP_LEVEL_REQUIREMENTS,
  CARD_XP_MAX_LEVEL,
  cardLevelForXp,
} from "@/lib/card-xp";
import { GOLD_POLICY_VERSION } from "@/lib/gold";
import {
  RANKED_LOSS_DELTA,
  RANKED_SEASON,
  RANKED_WIN_DELTA,
} from "@/lib/ranked";

// Must match SPONSORSHIP_POLICY_VERSION in src/db/sponsorships.ts.
// Kept local so this module stays import-clean with no DB dependencies.
const SPONSORSHIP_POLICY_VERSION = 1;

export type AuditStatus = "PASS" | "WARNING" | "FAIL" | "NOT_CHECKABLE";

export interface AuditFinding {
  check: string;
  status: AuditStatus;
  summary: string;
  count: number;
  samples: string[];
}

export type MatchResult = "win" | "loss" | "draw";

export interface AuditParticipant {
  matchId: string;
  playerId: string;
  result: MatchResult;
  matchType: string;
  finishedAtMs: number;
}

export interface AuditMatch {
  id: string;
  matchType: string;
  verification: string;
  finishedAtMs: number;
  seats: Array<{ playerId: string; result: MatchResult }>;
}

export interface GoldEarnRow {
  matchId: string;
  playerId: string;
  amount: number;
  result: MatchResult;
}

export interface GoldSpendRow {
  idempotencyKey: string;
  playerId: string;
  cardId: string;
  fromLevel: number;
  toLevel: number;
  cost: number;
}

export interface SponsorshipRow {
  id: string;
  idempotencyKey: string;
  sponsorId: string;
  recipientId: string;
  cardId: string;
  fromLevel: number;
  toLevel: number;
  cost: number;
  createdAtMs: number;
}

export interface XpProgressRow {
  playerId: string;
  cardId: string;
  xp: number;
  level: number;
  purchasedLevel: number;
}

export interface RankedAwardRow {
  matchId: string;
  playerId: string;
  season: number;
  result: MatchResult;
  delta: number;
  balanceAfter: number | null;
}

export interface RankedBalanceRow {
  playerId: string;
  season: number;
  trophies: number;
  rankedMatches: number;
  rankedWins: number;
  rankedLosses: number;
  rankedDraws: number;
}

// Provisional risk thresholds. NOT APPROVED FOR ENFORCEMENT. Review-only.
export const AUDIT_THRESHOLDS = {
  repeatPairLifetimeMin: 5,
  repeatPair24hMin: 4,
  winConcentrationMinWins: 4,
  winConcentrationMinRate: 0.8,
  winConcentrationMinTotal: 5,
  highFrequencyMinMatches: 6,
  highFrequencyWindowMs: 60 * 60 * 1000,
  reciprocalMinWinsEach: 2,
  goldFarmPair24hMin: 8,
  giftPairWeekMin: 3,
  giftPairWeekWindowMs: 7 * 24 * 60 * 60 * 1000,
  giftRecipientWeekMin: 4,
} as const;

export const AUDIT_ENFORCEMENT_NOTE =
  "Thresholds are provisional and NOT APPROVED FOR ENFORCEMENT. " +
  "Flags are candidates for human review only. No bans, confiscation, " +
  "reversal or invalidation may follow from this report.";

export const AUDIT_FALSE_POSITIVES = [
  "Friends rematch by room code and look like repeated opponents.",
  "Small matchmaking populations repeat pairings naturally.",
  "Play sessions cluster matches in short windows for ordinary players.",
  "Reciprocal wins happen between evenly matched friends.",
  "Gift concentration happens between genuine friends; caps already bound it.",
] as const;

export function isGoldXpEligible(matchType: string, verification: string): boolean {
  return (
    (matchType === "matchmaking" || matchType === "ranked") &&
    verification === "replay-verified"
  );
}

export function isRankedEligible(matchType: string, verification: string): boolean {
  return matchType === "ranked" && verification === "replay-verified";
}

function finding(
  check: string,
  status: AuditStatus,
  summary: string,
  samples: string[] = []
): AuditFinding {
  return { check, status, summary, count: samples.length, samples: samples.slice(0, 8) };
}

function key2(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Eligible settled seats with no matching earn row. Private seats excluded. Null when the earn ledger is unreadable. */
export function pendingGoldEarn(
  participants: AuditParticipant[],
  earnRows: GoldEarnRow[] | null
): Array<{ matchId: string; playerId: string }> | null {
  if (earnRows === null) return null;
  const have = new Set(earnRows.map((r) => `${r.matchId}|${r.playerId}`));
  return participants
    .filter(
      (p) =>
        (p.matchType === "matchmaking" || p.matchType === "ranked") &&
        !have.has(`${p.matchId}|${p.playerId}`)
    )
    .map((p) => ({ matchId: p.matchId, playerId: p.playerId }));
}

/** Ranked seats with no trophy award row. Non-ranked seats excluded. */
export function pendingRankedAwards(
  participants: AuditParticipant[],
  awards: RankedAwardRow[],
  season: number = RANKED_SEASON
): Array<{ matchId: string; playerId: string }> {
  const have = new Set(
    awards.filter((a) => a.season === season).map((a) => `${a.matchId}|${a.playerId}`)
  );
  return participants
    .filter((p) => p.matchType === "ranked" && !have.has(`${p.matchId}|${p.playerId}`))
    .map((p) => ({ matchId: p.matchId, playerId: p.playerId }));
}

/** Eligible matches with no card-XP run marker at all. */
export function pendingCardXpRuns(
  matches: AuditMatch[],
  runMatchIds: Set<string>
): string[] {
  return matches
    .filter((m) => isGoldXpEligible(m.matchType, m.verification) && !runMatchIds.has(m.id))
    .map((m) => m.id);
}

/** Eligible matches with no legacy run marker at all. */
export function pendingLegacyRuns(
  matches: AuditMatch[],
  runMatchIds: Set<string>
): string[] {
  return matches
    .filter((m) => m.verification === "replay-verified" && !runMatchIds.has(m.id))
    .map((m) => m.id);
}

export function goldBalances(
  earnRows: GoldEarnRow[],
  spendRows: GoldSpendRow[]
): Map<string, { earned: number; spent: number; balance: number }> {
  const out = new Map<string, { earned: number; spent: number; balance: number }>();
  const acc = (id: string) => {
    let e = out.get(id);
    if (!e) {
      e = { earned: 0, spent: 0, balance: 0 };
      out.set(id, e);
    }
    return e;
  };
  for (const r of earnRows) acc(r.playerId).earned += r.amount;
  for (const r of spendRows) acc(r.playerId).spent += r.cost;
  for (const e of out.values()) e.balance = e.earned - e.spent;
  return out;
}

/** Receipts with no matching spend row under the same idempotency key. */
export function sponsorshipSpendMismatches(
  receipts: SponsorshipRow[],
  spends: GoldSpendRow[]
): SponsorshipRow[] {
  const spendByKey = new Map(spends.map((s) => [s.idempotencyKey, s]));
  return receipts.filter((r) => {
    const s = spendByKey.get(r.idempotencyKey);
    if (!s) return true;
    return s.playerId !== r.sponsorId || s.cost !== r.cost || s.cardId !== r.cardId;
  });
}

/** Spend rows that carry a sponsorship idempotency key but have no receipt. */
export function orphanSponsorshipSpends(
  receipts: SponsorshipRow[],
  spends: GoldSpendRow[],
  knownSponsorshipKeys: Set<string>
): GoldSpendRow[] {
  const receiptKeys = new Set(receipts.map((r) => r.idempotencyKey));
  return spends.filter((s) => knownSponsorshipKeys.has(s.idempotencyKey) && !receiptKeys.has(s.idempotencyKey));
}

/** Duplicate idempotency keys across receipts (schema forbids; observed = FAIL). */
export function duplicateSponsorshipKeys(receipts: SponsorshipRow[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of receipts) {
    if (seen.has(r.idempotencyKey)) dup.add(r.idempotencyKey);
    seen.add(r.idempotencyKey);
  }
  return [...dup];
}

/** XP/level invariant violations. Purchased must be XP-backed, never above cap. */
export function xpInconsistencies(rows: XpProgressRow[]): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    const derived = cardLevelForXp(r.xp);
    if (r.level !== derived) {
      bad.push(`${r.playerId}:${r.cardId} level=${r.level} xp-level=${derived}`);
      continue;
    }
    if (r.purchasedLevel < 1 || r.purchasedLevel > CARD_XP_MAX_LEVEL) {
      bad.push(`${r.playerId}:${r.cardId} purchased=${r.purchasedLevel} out-of-range`);
      continue;
    }
    if (r.purchasedLevel > 1) {
      const need = CARD_XP_LEVEL_REQUIREMENTS[r.purchasedLevel - 1]!;
      if (r.xp < need) bad.push(`${r.playerId}:${r.cardId} purchased=${r.purchasedLevel} xp=${r.xp} need=${need}`);
    }
  }
  return bad;
}

/** Provable ranked violations: bad deltas, null staging, negative balances. */
export function rankedInconsistencies(
  awards: RankedAwardRow[],
  balances: RankedBalanceRow[],
  season: number = RANKED_SEASON
): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const a of awards) {
    if (a.season !== season) continue;
    const k = `${a.matchId}|${a.playerId}`;
    if (seen.has(k)) bad.push(`duplicate-award ${k}`);
    seen.add(k);
    if (a.result === "win" && a.delta !== RANKED_WIN_DELTA) bad.push(`win-delta ${k}=${a.delta}`);
    if (a.result === "draw" && a.delta !== 0) bad.push(`draw-delta ${k}=${a.delta}`);
    if (a.result === "loss" && (a.delta > 0 || a.delta < RANKED_LOSS_DELTA))
      bad.push(`loss-delta ${k}=${a.delta}`);
    if (a.balanceAfter !== null && a.balanceAfter < 0) bad.push(`negative-after ${k}`);
  }
  for (const b of balances) {
    if (b.season !== season) continue;
    if (b.trophies < 0) bad.push(`negative-balance ${b.playerId}`);
    const total = b.rankedWins + b.rankedLosses + b.rankedDraws;
    if (b.rankedMatches !== total)
      bad.push(`counter-mismatch ${b.playerId} matches=${b.rankedMatches} wld=${total}`);
  }
  return bad;
}

export function stagedButUnappliedRanked(awards: RankedAwardRow[]): string[] {
  return awards.filter((a) => a.balanceAfter === null).map((a) => `${a.matchId}|${a.playerId}`);
}

export interface SuspectPattern {
  kind:
    | "repeated-opponent"
    | "win-concentration"
    | "high-frequency"
    | "reciprocal-wins"
    | "gold-farm-concentration";
  players: string[];
  matches: number;
  detail: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Deterministic review-only risk signals over genuine settled participants. */
export function detectSuspectPatterns(parts: AuditParticipant[]): SuspectPattern[] {
  const out: SuspectPattern[] = [];
  const byPair = new Map<string, AuditParticipant[]>();
  const byPlayer = new Map<string, AuditParticipant[]>();
  for (const p of parts) {
    const mate = parts.find((q) => q.matchId === p.matchId && q.playerId !== p.playerId);
    if (!mate) continue;
    const k = key2(p.playerId, mate.playerId);
    const arr = byPair.get(k) ?? [];
    arr.push({ ...p, finishedAtMs: p.finishedAtMs });
    byPair.set(k, arr);
    const pl = byPlayer.get(p.playerId) ?? [];
    pl.push(p);
    byPlayer.set(p.playerId, pl);
  }
  const t = AUDIT_THRESHOLDS;
  for (const [pair, rows] of byPair) {
    const [a, b] = pair.split("|") as [string, string];
    const matchIds = [...new Set(rows.map((r) => r.matchId))];
    if (matchIds.length >= t.repeatPairLifetimeMin) {
      out.push({
        kind: "repeated-opponent",
        players: [a, b],
        matches: matchIds.length,
        detail: `pair met ${matchIds.length} times (provisional review threshold ${t.repeatPairLifetimeMin}; rematches alone prove nothing)`,
      });
    }
    const latest = Math.max(...rows.map((r) => r.finishedAtMs));
    const in24h = new Set(
      rows.filter((r) => latest - r.finishedAtMs <= DAY).map((r) => r.matchId)
    );
    if (in24h.size >= t.repeatPair24hMin) {
      out.push({
        kind: "repeated-opponent",
        players: [a, b],
        matches: in24h.size,
        detail: `${in24h.size} meetings in 24h (provisional threshold ${t.repeatPair24hMin})`,
      });
    }
    for (const p of [a, b]) {
      const mine = rows.filter((r) => r.playerId === p);
      const wins = mine.filter((r) => r.result === "win").length;
      const total = new Set(mine.map((r) => r.matchId)).size;
      if (total >= t.winConcentrationMinTotal && wins >= t.winConcentrationMinWins && wins / total >= t.winConcentrationMinRate) {
        out.push({
          kind: "win-concentration",
          players: [p, p === a ? b : a],
          matches: total,
          detail: `${wins}/${total} wins against the same opponent (provisional ${t.winConcentrationMinWins}+ at ${(t.winConcentrationMinRate * 100).toFixed(0)}%+)`,
        });
      }
    }
    const winsA = rows.filter((r) => r.playerId === a && r.result === "win").length;
    const winsB = rows.filter((r) => r.playerId === b && r.result === "win").length;
    if (winsA >= t.reciprocalMinWinsEach && winsB >= t.reciprocalMinWinsEach) {
      out.push({
        kind: "reciprocal-wins",
        players: [a, b],
        matches: matchIds.length,
        detail: `each side won ${Math.min(winsA, winsB)}+ against the other; even matchups and traded games look identical`,
      });
    }
    if (in24h.size >= t.goldFarmPair24hMin) {
      const eligible = rows.filter((r) => r.matchType === "matchmaking" || r.matchType === "ranked").length;
      if (eligible >= t.goldFarmPair24hMin) {
        out.push({
          kind: "gold-farm-concentration",
          players: [a, b],
          matches: in24h.size,
          detail: `${eligible} reward-eligible meetings in 24h (provisional threshold ${t.goldFarmPair24hMin})`,
        });
      }
    }
  }
  for (const [player, rows] of byPlayer) {
    const times = [...new Set(rows.map((r) => `${r.matchId}:${r.finishedAtMs}`))]
      .map((s) => Number(s.split(":")[1]))
      .sort((x, y) => x - y);
    for (let i = 0; i < times.length; i += 1) {
      const window = times.filter((ms) => ms - times[i]! <= t.highFrequencyWindowMs);
      if (window.length >= t.highFrequencyMinMatches) {
        out.push({
          kind: "high-frequency",
          players: [player],
          matches: window.length,
          detail: `${window.length} matches within 60 minutes (provisional threshold ${t.highFrequencyMinMatches}; sessions cluster naturally)`,
        });
        break;
      }
    }
  }
  return out;
}

export interface GiftRisk {
  kind: "repeated-gifting" | "recipient-concentration" | "reciprocal-cluster";
  players: string[];
  receipts: number;
  detail: string;
}

/** Review-only gift concentration signals over existing receipts. */
export function detectGiftRisks(receipts: SponsorshipRow[]): GiftRisk[] {
  const out: GiftRisk[] = [];
  const t = AUDIT_THRESHOLDS;
  const byPair = new Map<string, SponsorshipRow[]>();
  const byRecipient = new Map<string, SponsorshipRow[]>();
  const directed = new Set<string>();
  for (const r of receipts) {
    const k = `${r.sponsorId}|${r.recipientId}`;
    const arr = byPair.get(k) ?? [];
    arr.push(r);
    byPair.set(k, arr);
    const rec = byRecipient.get(r.recipientId) ?? [];
    rec.push(r);
    byRecipient.set(r.recipientId, rec);
    directed.add(k);
  }
  for (const [pair, rows] of byPair) {
    const [s, rec] = pair.split("|") as [string, string];
    const latest = Math.max(...rows.map((r) => r.createdAtMs));
    const week = rows.filter((r) => latest - r.createdAtMs <= t.giftPairWeekWindowMs);
    if (week.length >= t.giftPairWeekMin) {
      out.push({
        kind: "repeated-gifting",
        players: [s, rec],
        receipts: week.length,
        detail: `${week.length} sponsorships from one sender to one recipient in 7d (provisional threshold ${t.giftPairWeekMin})`,
      });
    }
    if (directed.has(`${rec}|${s}`)) {
      out.push({
        kind: "reciprocal-cluster",
        players: [s, rec],
        receipts: rows.length,
        detail: "sponsorships flow both directions between this pair; friends gift back and forth",
      });
    }
  }
  for (const [rec, rows] of byRecipient) {
    const latest = Math.max(...rows.map((r) => r.createdAtMs));
    const week = rows.filter((r) => latest - r.createdAtMs <= t.giftPairWeekWindowMs);
    if (week.length >= t.giftRecipientWeekMin) {
      out.push({
        kind: "recipient-concentration",
        players: [rec],
        receipts: week.length,
        detail: `${week.length} sponsorships to one recipient in 7d (provisional threshold ${t.giftRecipientWeekMin})`,
      });
    }
  }
  return out;
}

export interface EconomyAuditReport {
  generatedAt: string;
  environment: { branch: string; policy: { gold: number; rankedSeason: number; sponsorship: number } };
  coverage: AuditFinding[];
  integrity: AuditFinding[];
  pending: AuditFinding[];
  suspects: SuspectPattern[];
  giftRisks: GiftRisk[];
  limitations: string[];
  nextActions: string[];
}

const SHORT = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);

export function buildReport(input: {
  branch: string;
  matchesReadable: boolean;
  evidenceMatchIds: Set<string> | null;
  matches: AuditMatch[];
  participants: AuditParticipant[];
  earnRows: GoldEarnRow[] | null;
  spendRows: GoldSpendRow[] | null;
  sponsorships: SponsorshipRow[];
  knownSponsorshipSpendKeys: Set<string>;
  xpProgress: XpProgressRow[];
  rankedAwards: RankedAwardRow[];
  rankedBalances: RankedBalanceRow[];
  cardXpRunIds: Set<string> | null;
  legacyRunIds: Set<string> | null;
  knownPlayerIds: Set<string> | null;
}): EconomyAuditReport {
  const coverage: AuditFinding[] = [];
  const integrity: AuditFinding[] = [];
  const pending: AuditFinding[] = [];
  const {
    branch, matches, participants, earnRows, spendRows, sponsorships,
    knownSponsorshipSpendKeys, xpProgress, rankedAwards, rankedBalances,
    cardXpRunIds, legacyRunIds, knownPlayerIds,
  } = input;

  const byType = new Map<string, number>();
  for (const m of matches) byType.set(m.matchType, (byType.get(m.matchType) ?? 0) + 1);
  if (!input.matchesReadable) {
    coverage.push(finding("settlement-records", "NOT_CHECKABLE", "matches table unavailable; no settlement statement possible"));
  } else if (matches.length === 0) {
    coverage.push(
      finding("settlement-records", "NOT_CHECKABLE", "matches table readable but holds no settled rows in scope; no settlement statement possible")
    );
  } else {
    coverage.push(
      finding(
        "settlement-records",
        "PASS",
        `settled matches scanned: ${matches.length} (${[...byType].map(([k, v]) => `${k}=${v}`).join(", ")})`,
      )
    );
  }
  if (input.evidenceMatchIds === null) {
    coverage.push(finding("settlement-evidence", "NOT_CHECKABLE", "match_evidence unavailable; cannot separate provenanced matches from fixture residue"));
  } else if (matches.length === 0) {
    coverage.push(finding("settlement-evidence", "NOT_CHECKABLE", "no settled matches in scope; nothing to provenance-check"));
  } else {
    const without = matches.filter((m) => !input.evidenceMatchIds!.has(m.id)).map((m) => m.id);
    coverage.push(
      finding(
        "settlement-evidence",
        without.length > 0 ? "WARNING" : "PASS",
        without.length > 0
          ? `${without.length} settled matches have no match_evidence row: fixture residue or unprovenanced, never reconcile candidates`
          : "every settled match carries its replay evidence row",
        without
      )
    );
  }

  if (cardXpRunIds === null) {
    coverage.push(finding("card-xp-runs", "NOT_CHECKABLE", "card_xp_runs unavailable; cannot assess XP coverage"));
  } else {
    const p = pendingCardXpRuns(matches, cardXpRunIds);
    pending.push(
      finding(
        "card-xp-pending",
        p.length > 0 ? "WARNING" : "PASS",
        p.length > 0
          ? `${p.length} eligible settled matches have no card-XP run marker; reconcileCardXp can finish them`
          : "every eligible settled match has a card-XP run marker",
        p
      )
    );
  }
  if (legacyRunIds === null) {
    coverage.push(finding("legacy-runs", "NOT_CHECKABLE", "match_legacy_runs unavailable; cannot assess legacy coverage"));
  } else {
    const p = pendingLegacyRuns(matches, legacyRunIds);
    pending.push(
      finding(
        "legacy-pending",
        p.length > 0 ? "WARNING" : "PASS",
        p.length > 0
          ? `${p.length} verified settled matches have no legacy run marker; LegacyProcessor/reconcile can finish them`
          : "every verified settled match has a legacy run marker",
        p
      )
    );
  }

  const pg = pendingGoldEarn(participants, earnRows);
  pending.push(
    pg === null
      ? finding("gold-earn-pending", "NOT_CHECKABLE", "gold_earn_ledger unavailable; cannot assess earn coverage")
      : finding(
          "gold-earn-pending",
          pg.length > 0 ? "WARNING" : "PASS",
          pg.length > 0
            ? `${pg.length} eligible seats lack gold earn rows; reconcileGoldEarn can finish them`
            : "every eligible seat has its gold earn row (private seats correctly excluded)",
          pg.map((r) => r.matchId)
        )
  );
  const pr = pendingRankedAwards(participants, rankedAwards);
  pending.push(
    finding(
      "ranked-pending",
      pr.length > 0 ? "WARNING" : "PASS",
      pr.length > 0
        ? `${pr.length} ranked seats lack trophy awards; reconcileRankedTrophies can finish them`
        : "every ranked seat has its trophy award (non-ranked correctly excluded)",
      pr.map((r) => r.matchId)
    )
  );

  const balances = earnRows !== null && spendRows !== null ? goldBalances(earnRows, spendRows) : null;
  const negative = balances !== null ? [...balances].filter(([, b]) => b.balance < 0) : [];
  integrity.push(
    finding(
      "gold-derived-balances",
      balances === null
        ? "NOT_CHECKABLE"
        : balances.size === 0
          ? "NOT_CHECKABLE"
          : negative.length > 0
            ? "FAIL"
            : "PASS",
      balances === null
        ? "gold ledgers unavailable; cannot verify earned-minus-spent"
        : balances.size === 0
          ? "gold ledgers unavailable or empty; cannot verify earned-minus-spent"
          : negative.length > 0
            ? `${negative.length} players show negative derived Gold (earned minus spent); ledger bug, never a display debt`
            : `${balances.size} players checked, no negative derived balance`,
      negative.map(([id]) => id)
    )
  );

  const mism = spendRows === null ? null : sponsorshipSpendMismatches(sponsorships, spendRows);
  integrity.push(
    finding(
      "sponsorship-spend-match",
      sponsorships.length === 0 || mism === null
        ? "NOT_CHECKABLE"
        : mism.length > 0
          ? "FAIL"
          : "PASS",
      mism === null
        ? "gold_spend_ledger unavailable; cannot cross-check sponsorship debits"
        : sponsorships.length === 0
          ? "gift_sponsorships unavailable or empty; sponsorship checks skipped"
          : mism.length > 0
            ? `${mism.length} receipts lack a matching sponsor spend row (same key, cost, card)`
            : `${sponsorships.length} receipts each match their sponsor spend row`,
      (mism ?? []).map((r) => r.idempotencyKey)
    )
  );
  const orphans = spendRows === null ? null : orphanSponsorshipSpends(sponsorships, spendRows, knownSponsorshipSpendKeys);
  integrity.push(
    finding(
      "sponsorship-orphans",
      orphans === null || sponsorships.length === 0
        ? "NOT_CHECKABLE"
        : orphans.length > 0
          ? "FAIL"
          : "PASS",
      orphans === null
        ? "gold_spend_ledger unavailable; orphan scan skipped"
        : sponsorships.length === 0
          ? "no sponsorship receipts to cross-check; orphan scan skipped"
          : orphans.length > 0
            ? `${orphans.length} sponsor debits carry a sponsorship key with no receipt; shared-fate write broke`
            : "no orphaned sponsorship debits",
      (orphans ?? []).map((s) => s.idempotencyKey)
    )
  );
  const dups = duplicateSponsorshipKeys(sponsorships);
  integrity.push(
    finding(
      "sponsorship-duplicates",
      sponsorships.length === 0 ? "NOT_CHECKABLE" : dups.length > 0 ? "FAIL" : "PASS",
      sponsorships.length === 0
        ? "gift_sponsorships unavailable or empty; duplicate scan skipped"
        : dups.length > 0
          ? `${dups.length} idempotency keys repeat across receipts; exactly-once violated`
          : "no duplicate sponsorship idempotency keys",
      dups
    )
  );
  const selfGifts = sponsorships.filter((r) => r.sponsorId === r.recipientId);
  if (selfGifts.length > 0) {
    integrity.push(finding("sponsorship-no-self", "FAIL", `${selfGifts.length} receipts name the same sponsor and recipient`, selfGifts.map((r) => r.id)));
  }
  if (knownPlayerIds !== null && sponsorships.length > 0) {
    const orphanRefs = sponsorships.filter(
      (r) => !knownPlayerIds.has(r.sponsorId) || !knownPlayerIds.has(r.recipientId)
    );
    integrity.push(
      finding(
        "sponsorship-refs",
        orphanRefs.length > 0 ? "WARNING" : "PASS",
        orphanRefs.length > 0
          ? `${orphanRefs.length} receipts reference unknown players in the scanned set`
          : "every receipt references known players in the scanned set",
        orphanRefs.map((r) => r.id)
      )
    );
  }

  const xpBad = xpInconsistencies(xpProgress);
  integrity.push(
    finding(
      "xp-level-consistency",
      xpProgress.length === 0 ? "NOT_CHECKABLE" : xpBad.length > 0 ? "FAIL" : "PASS",
      xpProgress.length === 0
        ? "card_xp_progress unavailable or empty; cannot verify XP levels"
        : xpBad.length > 0
          ? `${xpBad.length} progress rows break the XP/level or purchased-level invariant`
          : `${xpProgress.length} progress rows satisfy the XP/level invariant`,
      xpBad.map((s) => s.split(" ")[0]!)
    )
  );

  const rkBad = rankedInconsistencies(rankedAwards, rankedBalances);
  integrity.push(
    finding(
      "ranked-consistency",
      rankedAwards.length === 0 && rankedBalances.length === 0
        ? "NOT_CHECKABLE"
        : rkBad.length > 0
          ? "FAIL"
          : "PASS",
      rankedAwards.length === 0 && rankedBalances.length === 0
        ? "ranked tables unavailable or empty; cannot verify trophies"
        : rkBad.length > 0
          ? `${rkBad.length} ranked award/balance violations are provable from stored rows`
          : `${rankedAwards.length} awards and ${rankedBalances.length} balances satisfy provable trophy rules`,
      rkBad.slice(0, 8)
    )
  );
  const staged = stagedButUnappliedRanked(rankedAwards);
  pending.push(
    finding(
      "ranked-staged-unapplied",
      staged.length > 0 ? "WARNING" : "PASS",
      staged.length > 0
        ? `${staged.length} award rows are staged with balance_after NULL (interrupted run); reconcileRankedTrophies finishes them exactly once`
        : "no staged-but-unapplied ranked awards",
      staged
    )
  );

  const suspects = detectSuspectPatterns(participants);
  const giftRisks = detectGiftRisks(sponsorships);

  const limitations = [
    ...AUDIT_FALSE_POSITIVES,
    "Rejected gift attempts are not recorded, so cap-boundary pressure is NOT CHECKABLE from receipts alone.",
    "Award-amount correctness beyond provable rules needs replay evidence, which this audit never reads.",
    "Private matches earn nothing by design; their absence of rewards is ineligible, never a failure.",
    "Friendships accepted before accepted_at tracking stay ineligible and are never backfilled.",
  ];

  const nextActions: string[] = [];
  const evidenceGaps =
    input.evidenceMatchIds === null ? null : matches.filter((m) => !input.evidenceMatchIds!.has(m.id)).length;
  if (evidenceGaps !== null && evidenceGaps > 0)
    nextActions.push(
      `Reconcile only matches carrying match_evidence rows; the ${evidenceGaps} evidence-less matches are fixture residue or unprovenanced and must never be awarded.`
    );
  if (pg !== null && pg.length > 0) nextActions.push("Run reconcileGoldEarn(limit) on TEST after confirming the battle outbox is drained; it is idempotent.");
  if (pr.length > 0 || staged.length > 0) nextActions.push("Run reconcileRankedTrophies(limit) on TEST; already-awarded rows are no-ops.");
  if (cardXpRunIds !== null && pendingCardXpRuns(matches, cardXpRunIds).length > 0)
    nextActions.push("Run reconcileCardXp(limit, award) on TEST with evidence-backed usage; unreadable evidence stays untouched.");
  if (legacyRunIds !== null && pendingLegacyRuns(matches, legacyRunIds).length > 0)
    nextActions.push("Run the LegacyProcessor reconcile path on TEST; refused matches stay refused for the process lifetime.");
  if (
    (mism !== null && mism.length > 0) ||
    (orphans !== null && orphans.length > 0) ||
    negative.length > 0 ||
    xpBad.length > 0 ||
    rkBad.length > 0 ||
    dups.length > 0
  )
    nextActions.push("FAIL items need a human-led P6e.2 recovery plan first; do not rebuild ledgers or rerun awarders blindly.");
  if (suspects.length > 0 || giftRisks.length > 0)
    nextActions.push("Review suspect patterns with match context (room codes, queue depth, chat) before any P6e.2 enforcement design.");
  if (nextActions.length === 0) nextActions.push("No pending reconciliation. Keep this audit on a schedule; no P6e.2 action required.");

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      branch,
      policy: { gold: GOLD_POLICY_VERSION, rankedSeason: RANKED_SEASON, sponsorship: SPONSORSHIP_POLICY_VERSION },
    },
    coverage,
    integrity,
    pending,
    suspects,
    giftRisks,
    limitations,
    nextActions,
  };
}

export function reportHasFail(report: EconomyAuditReport): boolean {
  return [...report.coverage, ...report.integrity, ...report.pending].some((f) => f.status === "FAIL");
}

/** Human-readable operator rendering. Player ids are shortened; no secrets. */
export function formatReport(report: EconomyAuditReport): string {
  const lines: string[] = [];
  lines.push("CHOG ROYALE P6e.1 ECONOMY INTEGRITY AUDIT (read-only)");
  lines.push(`generated: ${report.generatedAt}`);
  lines.push(`branch: ${report.environment.branch}`);
  lines.push(
    `policy: gold v${report.environment.policy.gold}, ranked season ${report.environment.policy.rankedSeason}, sponsorship v${report.environment.policy.sponsorship}`
  );
  lines.push(`verdict: ${reportHasFail(report) ? "FAIL present" : "no FAIL"}`);
  const section = (title: string, rows: AuditFinding[]) => {
    lines.push(`\n== ${title} ==`);
    for (const f of rows) {
      const tail = f.samples.length > 0 ? ` [${f.samples.map(SHORT).join(", ")}]` : "";
      lines.push(`[${f.status}] ${f.check}: ${f.summary}${tail}`);
    }
  };
  section("coverage", report.coverage);
  section("pending reconciliation", report.pending);
  section("integrity", report.integrity);
  lines.push("\n== suspect match patterns (review only, NOT enforcement) ==");
  if (report.suspects.length === 0) lines.push("(none)");
  for (const s of report.suspects.slice(0, 25)) {
    lines.push(`- ${s.kind} ${s.players.map(SHORT).join(" vs ")} n=${s.matches}: ${s.detail}`);
  }
  lines.push("\n== gift risk signals (review only, NOT enforcement) ==");
  if (report.giftRisks.length === 0) lines.push("(none)");
  for (const g of report.giftRisks.slice(0, 25)) {
    lines.push(`- ${g.kind} ${g.players.map(SHORT).join(" -> ")} receipts=${g.receipts}: ${g.detail}`);
  }
  lines.push(`\n${AUDIT_ENFORCEMENT_NOTE}`);
  lines.push("\n== limitations ==");
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push("\n== recommended next actions ==");
  for (const a of report.nextActions) lines.push(`- ${a}`);
  return lines.join("\n");
}

/** Machine-readable rendering. Throws on circular input; ids stay operator-local. */
export function reportToJson(report: EconomyAuditReport): string {
  return JSON.stringify(report, null, 2);
}
