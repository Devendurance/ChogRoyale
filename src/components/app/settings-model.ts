// Pure helpers for the settings screen (A4.1).
//
// The screen reuses the existing account endpoints. Nothing here persists or
// validates on behalf of the server: the display name rules mirror the
// published onboarding schema for inline feedback only, and the server stays
// the authority on every save.

import type { LobbyNotice } from "./lobby-types";
import type {
  AvatarCatalog,
  AvatarChoice,
  SettingsReadState,
  SettingsSaveState,
  WalletLine,
  WalletSummary,
} from "./settings-types";

export const DISPLAY_NAME_MAX = 32;

export interface ApiError {
  code: string;
  message: string;
  /** Present on a 404 that means the verified identity has no player row. */
  bootstrap?: boolean;
}

export type NameCheck = { ok: true; value: string } | { ok: false; message: string };

/** Mirrors the server's trim, 1..32 rule so the field can warn before a save. */
export function checkDisplayName(raw: string): NameCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, message: "Enter a display name." };
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, message: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

/** The server trims before comparing too, so equal trimmed names are not a change. */
export function isNameChanged(draft: string, current: string | null): boolean {
  return draft.trim() !== (current ?? "");
}

/**
 * Guards a payload from GET /api/players/avatars. A successful empty list is
 * empty, a malformed payload is unavailable, and duplicate ids are dropped so
 * the picker cannot render the same avatar twice.
 */
export function parseAvatarCatalog(payload: unknown): AvatarCatalog {
  const raw = (payload as { avatars?: unknown } | null)?.avatars;
  if (!Array.isArray(raw)) return { state: "unavailable", choices: [] };

  const seen = new Set<string>();
  const choices: AvatarChoice[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { id?: unknown; name?: unknown; assetUrl?: unknown };
    if (typeof candidate.id !== "string" || candidate.id.length === 0) continue;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) continue;
    if (typeof candidate.assetUrl !== "string" || candidate.assetUrl.length === 0) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    choices.push({ id: candidate.id, name: candidate.name, assetUrl: candidate.assetUrl });
  }

  if (raw.length > 0 && choices.length === 0) return { state: "unavailable", choices: [] };
  return { state: choices.length === 0 ? "empty" : "ready", choices };
}

export function avatarChoiceById(choices: AvatarChoice[], id: string | null): AvatarChoice | null {
  if (!id) return null;
  return choices.find((choice) => choice.id === id) ?? null;
}

export function walletTypeLabel(type: unknown): string {
  if (type === "embedded") return "Embedded wallet";
  if (type === "external") return "External wallet";
  return "Wallet";
}

/** 143 is Monad in this project. Any other chain keeps its numeric id. */
export function walletChainLabel(chainId: unknown): string | null {
  if (typeof chainId !== "number" || !Number.isFinite(chainId)) return null;
  if (chainId === 143) return "Monad";
  return `Chain ${chainId}`;
}

const EMPTY_WALLETS: WalletSummary = {
  state: "empty",
  total: 0,
  verified: 0,
  primary: 0,
  embedded: 0,
  external: 0,
  lines: [],
};

/**
 * Guards GET /api/players/me/wallets. Addresses and row ids are dropped here
 * on purpose: the settings screen only needs counts, types and verification.
 */
export function summarizeWallets(payload: unknown): WalletSummary {
  const raw = (payload as { wallets?: unknown } | null)?.wallets;
  if (!Array.isArray(raw)) return { ...EMPTY_WALLETS, state: "unavailable" };
  if (raw.length === 0) return { ...EMPTY_WALLETS };

  const lines: WalletLine[] = [];
  let verified = 0;
  let primary = 0;
  let embedded = 0;
  let external = 0;

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const wallet = entry as {
      walletType?: unknown;
      chainId?: unknown;
      isPrimary?: unknown;
      verifiedAt?: unknown;
    };
    // A wallet row always carries a type or a chain. An empty object is a
    // malformed row, so it is skipped instead of rendering as "Wallet".
    if (typeof wallet.walletType !== "string" && typeof wallet.chainId !== "number") return;
    const isVerified = wallet.verifiedAt !== null && wallet.verifiedAt !== undefined;
    const isPrimary = wallet.isPrimary === true;
    if (wallet.walletType === "embedded") embedded += 1;
    if (wallet.walletType === "external") external += 1;
    if (isVerified) verified += 1;
    if (isPrimary) primary += 1;
    lines.push({
      key: `wallet-${index}`,
      typeLabel: walletTypeLabel(wallet.walletType),
      chainLabel: walletChainLabel(wallet.chainId),
      verified: isVerified,
      primary: isPrimary,
    });
  });

  if (lines.length === 0) return { ...EMPTY_WALLETS, state: "unavailable" };
  return {
    state: "ready",
    total: lines.length,
    verified,
    primary,
    embedded,
    external,
    lines,
  };
}

/** A 403 from a read is a setup lock, every other failure is unavailable. */
export function readStateForError(code: string): SettingsReadState {
  return code === "FORBIDDEN" ? "locked" : "unavailable";
}

export function avatarsNote(state: SettingsReadState): string | null {
  switch (state) {
    case "ready":
      return null;
    case "empty":
      return "No avatars are available right now, so the picker is empty.";
    case "locked":
      return "Avatars are locked until your profile setup is complete.";
    default:
      return "The avatar service could not be read. Your current avatar is unchanged.";
  }
}

export function walletsNote(state: SettingsReadState): string | null {
  switch (state) {
    case "ready":
      return null;
    case "empty":
      return "No wallet is linked to this account yet.";
    case "locked":
      return "Wallets are locked until your profile setup is complete.";
    default:
      return "The wallet service could not be read, so no wallet summary is shown.";
  }
}

export function settingsNoticeFor(error: ApiError): LobbyNotice {
  if (error.code === "NOT_FOUND") {
    return {
      tone: "warn",
      text: "This sign-in has no player profile yet, so settings cannot open it.",
      action: { label: "Finish profile setup", href: "/dev/onboarding" },
    };
  }
  if (error.code === "BOOTSTRAP_FAILED") {
    return {
      tone: "error",
      text: `Your player profile could not be created. ${error.message}`,
      action: { label: "Open the setup tools", href: "/dev/onboarding" },
    };
  }
  if (error.code === "UNAUTHORIZED") {
    return { tone: "error", text: "Your session is no longer valid. Sign in again to open settings." };
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: `This account cannot open settings. ${error.message}` };
  }
  return { tone: "error", text: `Settings could not be read. ${error.message}` };
}

/** Save copy per failure. Nothing claims a save the server did not confirm. */
export function saveErrorMessage(code: string, message: string): string {
  switch (code) {
    case "BAD_REQUEST":
    case "UNPROCESSABLE":
      return message || "The server rejected that change.";
    case "UNAUTHORIZED":
      return "Your session has expired, so nothing was saved. Sign in again and retry.";
    case "FORBIDDEN":
      return message
        ? `This account cannot save changes right now. ${message}`
        : "This account cannot save changes right now.";
    case "SERVICE_UNAVAILABLE":
    case "INTERNAL_ERROR":
    case "NETWORK":
      return "The profile service is unavailable, so nothing was saved. Your edits are still on this screen.";
    default:
      return "Your changes were not saved. Your edits are still on this screen.";
  }
}

/** The save strip states one fact, chosen by state, never two at once. */
export function saveStatusText(
  state: SettingsSaveState,
  message: string | null,
  dirty: boolean
): string {
  switch (state) {
    case "saving":
      return "Saving to your account.";
    case "saved":
      return "Saved to your account.";
    case "error":
      return message ?? "Your changes were not saved.";
    default:
      return dirty
        ? "Unsaved changes stay on this screen until you save."
        : "No changes to save.";
  }
}
