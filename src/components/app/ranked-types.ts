import type { RankedAwardView, RankedBoardResponse, MyRankedResponse } from "@/lib/ranked";

export type RankedReadState = "loading" | "ready" | "empty" | "unavailable" | "locked" | "auth";

export interface RankedSummaryView {
  state: RankedReadState;
  season: number | null;
  trophies: number | null;
  eligible: boolean | null;
  position: number | null;
  rankedMatches: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  recent: RankedAwardView[];
}

export interface RankedBoardEntryView {
  position: number | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarName: string | null;
  season: number;
  trophies: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  isYou: boolean;
}

export interface RankedBoardView {
  state: RankedReadState;
  season: number | null;
  entries: RankedBoardEntryView[];
  total: number;
  limit: number;
  offset: number;
  me: { position: number | null; eligible: boolean; trophies: number; rankedMatches: number } | null;
}

export interface RankedProgressPayload {
  username: string;
  displayName: string | null;
  ranked: MyRankedResponse;
}

export type RankedBoardPayload = RankedBoardResponse;
