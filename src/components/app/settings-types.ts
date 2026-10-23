// Shared types for the settings screen (A4.1). Plain data only, so the view
// can also be rendered from a static preview without Privy or fetch.

import type { LobbyNotice, LobbyPlayer } from "./lobby-types";

export type SettingsPhase = "booting" | "login" | "profile" | "ready";

/**
 * Why a section has no data. "empty" is only a successful payload with no
 * rows. A failed read is "unavailable" and a 403 is "locked", so a service
 * outage never reads as an empty account.
 */
export type SettingsReadState = "ready" | "empty" | "unavailable" | "locked";

export interface AvatarChoice {
  id: string;
  name: string;
  assetUrl: string;
}

export interface AvatarCatalog {
  state: SettingsReadState;
  choices: AvatarChoice[];
}

export interface WalletLine {
  key: string;
  typeLabel: string;
  chainLabel: string | null;
  verified: boolean;
  primary: boolean;
}

export interface WalletSummary {
  state: SettingsReadState;
  total: number;
  verified: number;
  primary: number;
  embedded: number;
  external: number;
  lines: WalletLine[];
}

export type SettingsSaveState = "idle" | "saving" | "saved" | "error";

export interface SettingsSaveStatus {
  state: SettingsSaveState;
  message: string | null;
}

export interface SettingsViewProps {
  phase: SettingsPhase;
  player: LobbyPlayer | null;
  memberSince: string | null;
  avatarCatalog: AvatarCatalog;
  avatarsNote: string | null;
  wallets: WalletSummary;
  walletsNote: string | null;
  draftName: string;
  draftAvatarId: string | null;
  nameError: string | null;
  save: SettingsSaveStatus;
  dirty: boolean;
  canSave: boolean;
  notices: LobbyNotice[];
  busy: boolean;
  calm: boolean;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  onNameChange: (value: string) => void;
  onAvatarSelect: (id: string) => void;
  onSave: () => void;
}
