// Plain prop contracts for the progress screen (A3.2a).
//
// Types only. The authenticated container owns the session and the network,
// so the view can also be rendered from a bounded presentation fixture or a
// test without pulling server-only code into the client bundle.

import type { LobbyNotice, LobbyPlayer } from "./lobby-types";

export type ProgressPhase = "booting" | "login" | "profile" | "ready";

/**
 * The state of one panel. "empty" is only ever a successful read that carried
 * no rows. A failed read is "unavailable", never zero.
 */
export type ProgressReadState = "ready" | "empty" | "unavailable" | "locked" | "auth";

export interface TypeSplit {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface CasualStanding {
  /** Server-provided eligibility, never recomputed from the counts. */
  eligible: boolean;
  minMatches: number | null;
  position: number | null;
  matchmakingMatches: number | null;
}

/** The verified record, already degraded from the stats payload. */
export interface StatsSummary {
  state: ProgressReadState;
  total: number;
  wins: number;
  losses: number;
  draws: number;
  /** Basis points, or null when no rate is known. */
  winRateBp: number | null;
  crownsEarned: number | null;
  crownsConceded: number | null;
  /** Null when the payload did not carry a readable split. */
  byType: { private: TypeSplit; matchmaking: TypeSplit } | null;
  firstMatchAt: string | null;
  latestMatchAt: string | null;
  casual: CasualStanding | null;
}

export type MatchResult = "win" | "loss" | "draw" | "unknown";

/** One saved match, caller-side detail only. */
export interface MatchRow {
  /** Used as the list key. Never rendered. */
  id: string;
  result: MatchResult;
  resultLabel: "Won" | "Lost" | "Drew" | "Result unavailable";
  opponent: string;
  crownsMine: number | null;
  crownsOpponent: number | null;
  matchType: "private" | "matchmaking" | "unknown";
  matchTypeLabel: string;
  /** ISO settled timestamp, or null when the value is unreadable. */
  settledAt: string | null;
  /** Date-only label in UTC, or null when the value is unreadable. */
  dateLabel: string | null;
  commanderName: string | null;
  commanderClassLabel: string | null;
  commanderKind: "free" | "nft" | null;
  deckSize: number | null;
  /** Resolved ordinary card names, at most four. Never the opponent's deck. */
  deckPreview: string[];
  verified: boolean;
}

export interface MatchHistory {
  state: ProgressReadState;
  rows: MatchRow[];
  nextCursor: string | null;
}

export interface BoardEntryView {
  position: number | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarName: string | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRateBp: number | null;
  crownsEarned: number | null;
  isYou: boolean;
}

export interface LeaderboardSummary {
  state: ProgressReadState;
  entries: BoardEntryView[];
  total: number;
  limit: number;
  offset: number;
  minMatches: number | null;
  me: { eligible: boolean; position: number | null } | null;
}

/** The merged casual standing, preferring the leaderboard's own answer. */
export interface StandingView {
  eligible: boolean;
  position: number | null;
  minMatches: number | null;
  matchmakingMatches: number | null;
  source: "board" | "stats";
}

export interface ProgressViewProps {
  phase: ProgressPhase;
  player: LobbyPlayer | null;
  stats: StatsSummary;
  history: MatchHistory;
  board: LeaderboardSummary;
  notices: LobbyNotice[];
  /** A full refresh is in flight. */
  busy: boolean;
  /** The next history page is in flight. */
  historyBusy: boolean;
  /** Another leaderboard page is in flight. */
  boardBusy: boolean;
  historyPageError: string | null;
  boardPageError: string | null;
  calm: boolean;
  /** Text announced to assistive tech when it changes. */
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  onLoadMoreMatches: () => void;
  onBoardPage: (offset: number) => void;
}
