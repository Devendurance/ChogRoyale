// Plain prop contracts for the commanders gallery (A4.2).
//
// Types only, so the presentational view can render from the authenticated
// container, a fixture or a test without pulling in Privy, fetch or the
// server-only combat ruleset.

import type { LobbyArt, LobbyCommander, LobbyNotice, LobbyPlayer, LobbyStat } from "./lobby-types";

export type CommandersPhase = "booting" | "login" | "profile" | "ready";

/**
 * Why the Genesis list has no entries. "empty" means a successful read found
 * no holdings in verified wallets, "no-wallet" means no wallet was checked,
 * and a failed read is "unavailable" or "locked". A failed read is never
 * turned into "no commanders".
 */
export type GenesisReadState = "ready" | "empty" | "no-wallet" | "unavailable" | "locked";

/** One free commander class, read from the live commander ruleset. */
export interface GalleryClass {
  key: string;
  classId: string;
  className: string;
  freeName: string;
  roleShort: string;
  role: string;
  cost: number;
  ability: string | null;
  counters: string[];
  stats: LobbyStat[];
  art: LobbyArt;
  cardArt: LobbyArt;
  artNote: string;
}

/**
 * One Chog Genesis token reported by the eligibility route. Eligibility is a
 * cached observation, never current ownership proof.
 */
export interface GalleryGenesis {
  key: string;
  tokenId: string;
  name: string;
  className: string;
  classId: string | null;
  eligible: boolean;
  status: string;
  reason: string | null;
  imageUrl: string | null;
  art: LobbyArt | null;
  cardArt: LobbyArt | null;
  cost: number | null;
  stats: LobbyStat[];
  artNote: string;
}

export interface GenesisCatalog {
  state: GenesisReadState;
  entries: GalleryGenesis[];
  walletsChecked: number;
  freshness: "cached" | "live" | null;
  note: string;
}

export interface GallerySelection {
  kind: "free" | "nft";
  key: string;
  classItem: GalleryClass | null;
  genesis: GalleryGenesis | null;
}

export interface CommandersViewProps {
  phase: CommandersPhase;
  player: LobbyPlayer | null;
  classes: GalleryClass[];
  genesis: GenesisCatalog;
  selected: GallerySelection | null;
  featured: LobbyCommander | null;
  notices: LobbyNotice[];
  busy: boolean;
  calm: boolean;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  onSelect: (key: string) => void;
}
