// Plain prop contracts for the Genesis legacy vault (A3.2b).
//
// Types only. Legacy is token-centric: the record belongs to the Genesis NFT,
// not to the wallet that currently holds it. The view can therefore be rendered
// from the authenticated container or from a bounded presentation fixture
// without implying a live ownership check.

import type { LobbyArt, LobbyNotice, LobbyPlayer } from "./lobby-types";

export type LegacyPhase = "booting" | "login" | "profile" | "ready";

export type VaultState = "ready" | "empty" | "no-wallet" | "unavailable" | "locked" | "auth";

export type LegacyRecordState = "ready" | "empty" | "unavailable" | "not-found" | "locked" | "auth";

export type LegacyEligibility = "eligible" | "pending" | "not-eligible" | "no-class";

/** One Genesis token in the player's verified-wallet holdings. */
export interface VaultToken {
  tokenId: string;
  name: string;
  /** Genuine original token image display URL, when the route resolved one. */
  imageUrl: string | null;
  classId: string | null;
  className: string | null;
  /** Approved commander class art. Shared by every commander of the class. */
  classArt: LobbyArt | null;
  eligibility: LegacyEligibility;
  eligibilityFreshness: "cached" | "live" | null;
  holdingFreshness: "cached" | "live";
  observedAt: string | null;
  observedLabel: string | null;
}

export interface VaultSummary {
  state: VaultState;
  tokens: VaultToken[];
  walletsChecked: number | null;
  latestObservedAt: string | null;
  latestObservedLabel: string | null;
  /** False when the commander enrichment read failed; classes are then omitted. */
  classDataAvailable: boolean;
}

export interface LegacyStatsView {
  commanderAppearances: number;
  patronAppearances: number;
  victories: number;
  defeats: number;
  achievementCodes: string[];
}

/** One visible legacy event, stripped of internal identifiers and payloads. */
export interface LegacyEventView {
  /** List key only. Never rendered. */
  id: string;
  kind: "commander" | "patron" | "achievement" | "outcome";
  kindLabel: string;
  status: "recorded" | "corrected";
  verified: boolean;
  result: "victory" | "defeat" | "draw" | "unknown" | null;
  resultLabel: string | null;
  crownsMine: number | null;
  crownsOpponent: number | null;
  matchTypeLabel: string | null;
  themeLabel: string | null;
  className: string | null;
  achievementName: string | null;
  occurredAt: string | null;
  dateLabel: string | null;
  /** True only when the event says ownership was verified as direct-owner. */
  ownershipVerified: boolean;
}

export interface LegacyRecordView {
  state: LegacyRecordState;
  tokenId: string | null;
  name: string | null;
  stats: LegacyStatsView | null;
  total: number;
  history: LegacyEventView[];
  /** Raw offset for the next page, or null when the record is complete. */
  nextOffset: number | null;
}

export interface AchievementView {
  code: string;
  name: string;
  description: string;
  state: "earned" | "locked";
  awardedAt: string | null;
  awardedLabel: string | null;
  /** Current verified count when the read contract supports progress. */
  progressCurrent: number | null;
  progressTarget: number | null;
  progressLabel: string | null;
  /** False when the rule exists but the current read cannot report progress. */
  progressAvailable: boolean;
}

export interface AchievementSummary {
  state: "ready" | "partial" | "unavailable" | "locked" | "auth";
  items: AchievementView[];
  earnedCount: number;
  note: string | null;
}

export interface LegacyViewProps {
  phase: LegacyPhase;
  player: LobbyPlayer | null;
  vault: VaultSummary;
  selectedToken: VaultToken | null;
  record: LegacyRecordView;
  recordLoading: boolean;
  achievements: AchievementSummary;
  notices: LobbyNotice[];
  busy: boolean;
  historyBusy: boolean;
  historyPageError: string | null;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  onSelectToken: (tokenId: string) => void;
  onLoadMore: () => void;
}
