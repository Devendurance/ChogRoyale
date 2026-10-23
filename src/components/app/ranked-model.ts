import type { RankedBoardResponse, MyRankedResponse, RankedAwardView } from "@/lib/ranked";
import type { RankedBoardView, RankedReadState, RankedSummaryView } from "./ranked-types";

function intOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function positionOrNull(value: unknown): number | null {
  const parsed = intOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function asAward(value: unknown): RankedAwardView | null {
  if (!value || typeof value !== "object") return null;
  const award = value as Partial<RankedAwardView>;
  if (typeof award.matchId !== "string" || (award.result !== "win" && award.result !== "loss" && award.result !== "draw")) return null;
  if (typeof award.delta !== "number" || !Number.isFinite(award.delta)) return null;
  if (typeof award.balanceAfter !== "number" || !Number.isFinite(award.balanceAfter)) return null;
  return {
    matchId: award.matchId,
    result: award.result,
    delta: Math.trunc(award.delta),
    balanceAfter: Math.max(0, Math.trunc(award.balanceAfter)),
    finishedAt: typeof award.finishedAt === "string" ? award.finishedAt : null,
  };
}

export function resolveRankedSummary(payload: MyRankedResponse): RankedSummaryView {
  const recent = Array.isArray(payload.recent) ? payload.recent.map(asAward).filter((award): award is RankedAwardView => Boolean(award)) : [];
  const season = intOrNull(payload.season);
  const trophies = intOrNull(payload.trophies);
  const rankedMatches = intOrNull(payload.rankedMatches);
  const wins = intOrNull(payload.wins);
  const losses = intOrNull(payload.losses);
  const draws = intOrNull(payload.draws);
  if (season === null || trophies === null || rankedMatches === null || wins === null || losses === null || draws === null) {
    return failureRanked("unavailable");
  }
  const state: RankedReadState = rankedMatches === 0 ? "empty" : "ready";
  return {
    state,
    season,
    trophies,
    eligible: typeof payload.eligible === "boolean" ? payload.eligible : null,
    position: positionOrNull(payload.position),
    rankedMatches,
    wins,
    losses,
    draws,
    recent,
  };
}

export function failureRanked(state: Exclude<RankedReadState, "loading" | "ready" | "empty">): RankedSummaryView {
  return {
    state,
    season: null,
    trophies: null,
    eligible: null,
    position: null,
    rankedMatches: null,
    wins: null,
    losses: null,
    draws: null,
    recent: [],
  };
}

export function resolveRankedBoard(payload: RankedBoardResponse): RankedBoardView {
  const entries = Array.isArray(payload.entries)
    ? payload.entries.map((entry) => ({
        position: positionOrNull(entry.position),
        username: entry.username,
        displayName: entry.displayName,
        avatarUrl: entry.avatar?.assetUrl ?? null,
        avatarName: entry.avatar?.name ?? null,
        season: entry.season,
        trophies: entry.trophies,
        matches: entry.matches,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        isYou: entry.isYou,
      }))
    : [];
  return {
    state: entries.length === 0 ? "empty" : "ready",
    season: payload.season,
    entries,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    me: payload.me,
  };
}

export function failureRankedBoard(state: Exclude<RankedReadState, "loading" | "ready" | "empty">): RankedBoardView {
  return { state, season: null, entries: [], total: 0, limit: 0, offset: 0, me: null };
}

/** Only an award returned by the server for this exact match is displayable. */
export function awardForMatch(recent: RankedAwardView[], matchId: string | null): RankedAwardView | null {
  if (!matchId) return null;
  return recent.find((award) => award.matchId === matchId) ?? null;
}
