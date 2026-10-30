// Pure derivation for the progress screen (A3.2a).
//
// Everything here is a function of already-fetched API payloads. No network,
// no server imports. A failed read is reported as unavailable, never as zero:
// only a successful payload with zero rows becomes the empty state.
//
// The screen never recomputes progression. Stats, eligibility and ordering all
// come from GET /api/players/me/stats and GET /api/leaderboard/casual.

import type {
  BoardEntryView,
  CasualStanding,
  LeaderboardSummary,
  MatchHistory,
  MatchRow,
  ProgressReadState,
  StandingView,
  StatsSummary,
  TypeSplit,
} from "./progress-types";

/** Authored account-level checkpoints. They carry no invented rewards. */
export const ACCOUNT_XP_MILESTONES = [1, 10, 25, 50, 75, 100] as const;

export type AccountXpMilestoneState = "reached" | "upcoming" | "unavailable";

/** Display-only milestone state. The account-XP endpoint remains authoritative. */
export function accountXpMilestoneState(level: number | null, milestone: number): AccountXpMilestoneState {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || !Number.isInteger(milestone) || milestone < 1) {
    return "unavailable";
  }
  return level >= milestone ? "reached" : "upcoming";
}

/** The stats payload as it arrives: optional objects of optional values. */
export interface StatsPayloadLike {
  username?: unknown;
  displayName?: unknown;
  avatar?: { assetUrl?: unknown; name?: unknown } | null;
  stats?: {
    total?: unknown;
    wins?: unknown;
    losses?: unknown;
    draws?: unknown;
    winRateBp?: unknown;
    crownsEarned?: unknown;
    crownsConceded?: unknown;
    byType?: unknown;
    firstMatchAt?: unknown;
    latestMatchAt?: unknown;
  } | null;
  casual?: unknown;
}

/** The match history payload as it arrives. */
export interface MatchesPayloadLike {
  items?: unknown;
  nextCursor?: unknown;
}

/** The casual leaderboard payload as it arrives. */
export interface BoardPayloadLike {
  entries?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  minMatches?: unknown;
  me?: unknown;
}

/** Names resolved from the live catalog, so history uses real game copy. */
export interface MatchLookup {
  classNames: Record<string, string>;
  cardNames: Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A finite number, or null. Booleans, arrays and objects are not numbers. */
function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A whole, non-negative count, or null when the value cannot be read. */
function intOrNull(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Math.max(0, Math.floor(parsed));
}

/** A positive position, or null. Rank starts at 1. */
function positionOrNull(value: unknown): number | null {
  const parsed = intOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** Basis points, or null when the payload does not carry a real rate. */
function rateOrNull(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Math.min(10000, Math.max(0, Math.floor(parsed)));
}

/** A valid ISO timestamp, normalized, or null. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A date-only label in UTC, or null when the value is missing or unreadable. */
export function formatRecordDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return DATE_FORMAT.format(new Date(time));
}

const EMPTY_SPLIT: TypeSplit = { matches: 0, wins: 0, losses: 0, draws: 0 };

function splitOf(value: unknown): TypeSplit | null {
  const row = asRecord(value);
  if (!row) return null;
  const matches = intOrNull(row.matches);
  const wins = intOrNull(row.wins);
  const losses = intOrNull(row.losses);
  const draws = intOrNull(row.draws);
  if (matches === null || wins === null || losses === null || draws === null) return null;
  return { matches, wins, losses, draws };
}

function resolveCasual(value: unknown): CasualStanding | null {
  const casual = asRecord(value);
  if (!casual) return null;
  return {
    eligible: casual.eligible === true,
    minMatches: intOrNull(casual.minMatches),
    position: positionOrNull(casual.position),
    matchmakingMatches: intOrNull(casual.matchmakingMatches),
  };
}

export function failureStats(state: ProgressReadState): StatsSummary {
  return {
    state,
    total: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRateBp: null,
    crownsEarned: null,
    crownsConceded: null,
    byType: null,
    firstMatchAt: null,
    latestMatchAt: null,
    casual: null,
  };
}

/**
 * The verified record. A payload with no stats object is unavailable. A real
 * payload with total 0 is empty. A payload whose required counts cannot be read
 * is unavailable, because a partial record must not be shown as a full one.
 */
export function resolveStats(payload: StatsPayloadLike | null): StatsSummary {
  const stats = asRecord(payload?.stats);
  if (!stats) return failureStats("unavailable");

  const total = intOrNull(stats.total);
  if (total === null) return failureStats("unavailable");
  const casual = resolveCasual(payload?.casual);

  if (total === 0) {
    return {
      state: "empty",
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRateBp: null,
      crownsEarned: 0,
      crownsConceded: 0,
      byType: {
        private: { ...EMPTY_SPLIT },
        matchmaking: { ...EMPTY_SPLIT },
      },
      firstMatchAt: null,
      latestMatchAt: null,
      casual,
    };
  }

  const wins = intOrNull(stats.wins);
  const losses = intOrNull(stats.losses);
  const draws = intOrNull(stats.draws);
  if (wins === null || losses === null || draws === null) return failureStats("unavailable");

  const byTypeRow = asRecord(stats.byType);
  const privateSplit = splitOf(byTypeRow?.private);
  const matchmakingSplit = splitOf(byTypeRow?.matchmaking);

  return {
    state: "ready",
    total,
    wins,
    losses,
    draws,
    winRateBp: rateOrNull(stats.winRateBp),
    crownsEarned: intOrNull(stats.crownsEarned),
    crownsConceded: intOrNull(stats.crownsConceded),
    byType: privateSplit && matchmakingSplit ? { private: privateSplit, matchmaking: matchmakingSplit } : null,
    firstMatchAt: isoOrNull(stats.firstMatchAt),
    latestMatchAt: isoOrNull(stats.latestMatchAt),
    casual,
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function classLabel(classId: string | null, lookup: MatchLookup): string | null {
  if (!classId) return null;
  return lookup.classNames[classId] ?? titleCase(classId);
}

/**
 * One saved match. Only caller-side fields are read. Seeds, commands, evidence,
 * state hashes, wallets and the opponent's deck are not part of this shape.
 */
export function resolveMatchRow(raw: unknown, index: number, lookup: MatchLookup): MatchRow {
  const row = asRecord(raw) ?? {};
  const matchId = typeof row.matchId === "string" && row.matchId.length > 0 ? row.matchId : `match-${index}`;
  const result = row.result === "win" || row.result === "loss" || row.result === "draw" ? row.result : "unknown";
  const resultLabel =
    result === "win" ? "Won" : result === "loss" ? "Lost" : result === "draw" ? "Drew" : "Result unavailable";

  const opponentRow = asRecord(row.opponent);
  const opponentName = typeof opponentRow?.username === "string" ? opponentRow.username.trim() : "";
  const opponent = opponentName || "Unknown opponent";

  const crownsRow = asRecord(row.crowns);
  const crownsMine = intOrNull(crownsRow?.mine);
  const crownsOpponent = intOrNull(crownsRow?.opponent);

  const matchType =
    row.matchType === "private" || row.matchType === "matchmaking" ? row.matchType : "unknown";
  const matchTypeLabel =
    matchType === "private" ? "Private room" : matchType === "matchmaking" ? "Matchmaking" : "Type unavailable";

  const settledAt = isoOrNull(row.settledAt);
  const dateLabel = formatRecordDate(settledAt);

  const commanderRow = asRecord(row.myCommander);
  const commanderClassId = typeof commanderRow?.class === "string" ? commanderRow.class : null;
  const commanderClassLabel = classLabel(commanderClassId, lookup);
  const rawCommanderName = typeof commanderRow?.name === "string" ? commanderRow.name.trim() : "";
  const commanderName = rawCommanderName || commanderClassLabel;
  const commanderKind =
    commanderRow?.kind === "free" || commanderRow?.kind === "nft" ? commanderRow.kind : null;

  const deck = Array.isArray(row.myDeck)
    ? row.myDeck.filter((entry): entry is string => typeof entry === "string")
    : null;
  const deckSize = deck ? deck.length : null;
  const deckPreview = deck
    ? deck
        .filter((id) => !id.startsWith("cmdr:"))
        .map((id) => lookup.cardNames[id])
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .slice(0, 4)
    : [];

  return {
    id: matchId,
    result,
    resultLabel,
    opponent,
    crownsMine,
    crownsOpponent,
    matchType,
    matchTypeLabel,
    settledAt,
    dateLabel,
    commanderName,
    commanderClassLabel,
    commanderKind,
    deckSize,
    deckPreview,
    verified: row.verification === "replay-verified",
  };
}

export function failureHistory(state: ProgressReadState): MatchHistory {
  return { state, rows: [], nextCursor: null };
}

/**
 * Append one history page. Rows already on screen are kept once, and the new
 * page's cursor replaces the old one. An empty follow-up page ends the list
 * without wiping the saved rows above it.
 */
export function appendHistoryPage(previous: MatchHistory, page: MatchHistory): MatchHistory {
  const seen = new Set(previous.rows.map((row) => row.id));
  const rows = [...previous.rows, ...page.rows.filter((row) => !seen.has(row.id))];
  return {
    state: rows.length > 0 ? "ready" : "empty",
    rows,
    nextCursor: page.nextCursor,
  };
}

/**
 * A page of saved matches. A missing items array is unavailable. An empty items
 * array is a genuine empty history. A missing or malformed cursor simply ends
 * the page rather than inventing one.
 */
export function resolveHistory(payload: MatchesPayloadLike | null, lookup: MatchLookup): MatchHistory {
  if (!payload) return failureHistory("unavailable");
  if (!Array.isArray(payload.items)) return failureHistory("unavailable");

  const rows = payload.items.map((item, index) => resolveMatchRow(item, index, lookup));
  const nextCursor =
    typeof payload.nextCursor === "string" && payload.nextCursor.trim() !== "" ? payload.nextCursor : null;

  return {
    state: rows.length > 0 ? "ready" : "empty",
    rows,
    nextCursor,
  };
}

function resolveBoardEntry(raw: unknown): BoardEntryView {
  const row = asRecord(raw) ?? {};
  const avatar = asRecord(row.avatar);
  return {
    position: positionOrNull(row.position),
    username: typeof row.username === "string" && row.username.trim() !== "" ? row.username : "Unknown player",
    displayName: typeof row.displayName === "string" && row.displayName.trim() !== "" ? row.displayName : null,
    avatarUrl: typeof avatar?.assetUrl === "string" ? avatar.assetUrl : null,
    avatarName: typeof avatar?.name === "string" ? avatar.name : null,
    matches: intOrNull(row.matches) ?? 0,
    wins: intOrNull(row.wins) ?? 0,
    losses: intOrNull(row.losses) ?? 0,
    draws: intOrNull(row.draws) ?? 0,
    winRateBp: rateOrNull(row.winRateBp),
    crownsEarned: intOrNull(row.crownsEarned),
    isYou: row.isYou === true,
  };
}

function resolveBoardMe(value: unknown): { eligible: boolean; position: number | null } | null {
  const me = asRecord(value);
  if (!me) return null;
  return { eligible: me.eligible === true, position: positionOrNull(me.position) };
}

export function failureBoard(state: ProgressReadState): LeaderboardSummary {
  return {
    state,
    entries: [],
    total: 0,
    limit: 10,
    offset: 0,
    minMatches: null,
    me: null,
  };
}

/**
 * The casual board. A missing entries array is unavailable. An empty entries
 * array is empty only because the successful payload said so. Ordering and
 * eligibility are the server's, and isYou comes from the server too.
 */
export function resolveBoard(payload: BoardPayloadLike | null): LeaderboardSummary {
  if (!payload) return failureBoard("unavailable");
  if (!Array.isArray(payload.entries)) return failureBoard("unavailable");

  const entries = payload.entries.map(resolveBoardEntry);
  const total = Math.max(intOrNull(payload.total) ?? entries.length, entries.length);
  const limit = Math.max(1, intOrNull(payload.limit) ?? (entries.length > 0 ? entries.length : 10));
  const offset = intOrNull(payload.offset) ?? 0;

  // A first page that says players qualify but carries no rows is not an
  // empty board. Report it as unavailable instead of claiming nobody is there.
  const state =
    entries.length > 0 ? "ready" : total > 0 && offset === 0 ? "unavailable" : "empty";

  return {
    state,
    entries,
    total,
    limit,
    offset,
    minMatches: intOrNull(payload.minMatches),
    me: resolveBoardMe(payload.me),
  };
}

/**
 * The player's casual standing. The leaderboard route is authoritative because
 * it applies the same ranking CTE. The stats payload is the fallback.
 */
export function resolveStanding(stats: StatsSummary, board: LeaderboardSummary): StandingView | null {
  if (board.me) {
    return {
      eligible: board.me.eligible,
      position: board.me.position,
      minMatches: board.minMatches ?? stats.casual?.minMatches ?? null,
      matchmakingMatches: stats.casual?.matchmakingMatches ?? null,
      source: "board",
    };
  }
  if (stats.casual) {
    return {
      eligible: stats.casual.eligible,
      position: stats.casual.position,
      minMatches: stats.casual.minMatches,
      matchmakingMatches: stats.casual.matchmakingMatches,
      source: "stats",
    };
  }
  return null;
}

/**
 * Display-only gap to the server's minimum. Eligibility itself is never
 * recomputed here; this only turns the two server numbers into a short line.
 */
export function matchesToQualify(standing: StandingView | null): number | null {
  if (!standing || standing.eligible) return null;
  if (standing.minMatches === null || standing.matchmakingMatches === null) return null;
  return Math.max(0, standing.minMatches - standing.matchmakingMatches);
}

/** Map a failed route code to the panel state that describes it. */
export function panelStateForCode(code: string): ProgressReadState {
  if (code === "UNAUTHORIZED") return "auth";
  if (code === "FORBIDDEN") return "locked";
  return "unavailable";
}
