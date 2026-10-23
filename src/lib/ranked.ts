// P1b.2 ranked trophies, Season 1 policy. Client-safe: no engine, crypto,
// DB or server imports (type-only profile import is erased at runtime).
// These are provisional TEST constants, not approved
// production economy rules. No Elo/MMR, placement, decay or season reset.
export const RANKED_SEASON = 1;
export const RANKED_START_TROPHIES = 0;
export const RANKED_WIN_DELTA = 25;
export const RANKED_LOSS_DELTA = -20;
export const RANKED_DRAW_DELTA = 0;
export const RANKED_MIN_TROPHIES = 0;

import type { PublicAvatar } from "@/lib/profiles";

export const RANKED_MAX_LIMIT = 50;
export const RANKED_DEFAULT_LIMIT = 25;

/** Trophy change for a settled ranked result. Draws never move trophies. */
export function rankedDeltaFor(result: "win" | "loss" | "draw"): number {
  if (result === "win") return RANKED_WIN_DELTA;
  if (result === "loss") return RANKED_LOSS_DELTA;
  return RANKED_DRAW_DELTA;
}

export interface RankedBoardEntry {
  position: number;
  username: string;
  displayName: string | null;
  avatar: PublicAvatar | null;
  season: number;
  trophies: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RankedBoardResponse {
  kind: "ranked-season-1";
  season: number;
  ordering: string;
  entries: Array<RankedBoardEntry & { isYou: boolean }>;
  total: number;
  limit: number;
  offset: number;
  me: { position: number | null; eligible: boolean; trophies: number; rankedMatches: number };
}

export interface RankedAwardView {
  matchId: string;
  result: "win" | "loss" | "draw";
  delta: number;
  balanceAfter: number;
  finishedAt: string | null;
}

export interface MyRankedResponse {
  season: number;
  trophies: number;
  eligible: boolean;
  position: number | null;
  rankedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  recent: RankedAwardView[];
}
