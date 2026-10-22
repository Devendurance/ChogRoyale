// Plain prop contracts for the player profile screen (A3.1).
//
// Types only, no imports beyond the shared lobby types, so the screen can be
// rendered from the authenticated container, from a static preview or from a
// test without pulling server-only code into the client bundle.

import type { LobbyCommander, LobbyDeck, LobbyNotice, LobbyPlayer, LobbyStat } from "./lobby-types";

export type ProfilePhase = "booting" | "login" | "profile" | "ready";

/**
 * What the account deck read produced. Every state the panel can be in is
 * listed here, so the view never has to guess why a deck is missing.
 */
export type ProfileDeckState =
  /** The account holds a deck the current ruleset still accepts. */
  | "ready"
  /** The account holds no deck at all. */
  | "none"
  /** The deck service could not be reached. */
  | "unavailable"
  /** The saved deck no longer matches the ruleset. */
  | "invalid"
  /** The saved deck unlocks once profile setup is complete. */
  | "locked";

/** The verified match record, already degraded from the stats payload. */
export interface RecordSummary {
  state: "ready" | "empty" | "unavailable";
  total: number;
  wins: number;
  losses: number;
  draws: number;
  /** Basis points, or null when no rate is known. */
  winRateBp: number | null;
  crownsEarned: number;
  crownsConceded: number;
}

/**
 * Everything the view needs. Plain data only: the container owns the session
 * and the network, so the view can also be rendered from a preview or a test.
 */
export interface ProfileViewProps {
  phase: ProfilePhase;
  player: LobbyPlayer | null;
  /** Formatted join date, or null when the account did not report one. */
  memberSince: string | null;
  /** How many linked wallets passed verification. Never an address. */
  verifiedWallets: number;
  commander: LobbyCommander | null;
  /** Real class combat rows, minus the deploy cost the stage already shows. */
  commanderStats: LobbyStat[];
  deck: LobbyDeck | null;
  deckState: ProfileDeckState;
  /** Short honest sentence for the deck panel when there is no deck to show. */
  deckNote: string | null;
  record: RecordSummary;
  /** Why the record is unavailable, when the read failed. Null when it did not. */
  recordNote: string | null;
  notices: LobbyNotice[];
  busy: boolean;
  calm: boolean;
  /** Text announced to assistive tech when it changes. */
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
}
