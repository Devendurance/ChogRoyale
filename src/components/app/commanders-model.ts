// Pure helpers for the commanders gallery (A4.2).
//
// The five free classes come from the server-built ruleset catalog. Genesis
// entries come only from the authenticated eligibility route. A cached
// eligibility flag is a browsing observation, not ownership proof, so nothing
// here turns a claim into "owned".

import type { LobbyCatalog, LobbyNotice } from "./lobby-types";
import type { CommanderChoiceLike, Eligibility } from "./lobby-model";
import { feedbackNoticeFor, sessionNotice } from "./feedback-model";
import type {
  GalleryClass,
  GalleryGenesis,
  GallerySelection,
  GenesisCatalog,
} from "./commanders-types";

export interface ApiError {
  code: string;
  message: string;
  /** Present on a 404 that means the verified identity has no player row. */
  bootstrap?: boolean;
}

export function classArtNote(className: string): string {
  return `Shared ${className} class art, used by every ${className} commander. It is not a specific NFT.`;
}

/** The five free classes, straight from the live commander ruleset catalog. */
export function buildGalleryClasses(catalog: LobbyCatalog): GalleryClass[] {
  return catalog.commanders.map((commander) => {
    const artNote = classArtNote(commander.className);
    return {
      key: `free:${commander.classId}`,
      classId: commander.classId,
      className: commander.className,
      freeName: commander.freeName,
      roleShort: commander.roleShort,
      role: commander.role,
      cost: commander.cost,
      ability: commander.ability,
      counters: commander.counters,
      stats: commander.stats,
      art: commander.art,
      cardArt: commander.commanderCardArt,
      artNote,
    };
  });
}

export function genesisNote(
  state: GenesisCatalog["state"],
  freshness: GenesisCatalog["freshness"]
): string {
  switch (state) {
    case "ready":
      return freshness === "live"
        ? "Ownership was checked live for these entries. The battle server verifies it again at ready and at match start."
        : "Cached eligibility is not current ownership proof. The battle server re-checks ownership at ready and again at match start.";
    case "no-wallet":
      return "No verified wallet is linked, so no Genesis commander can be checked. The five free classes are always available.";
    case "empty":
      return "No Chog Genesis commander was found in your verified wallets. The five free classes are always available.";
    case "locked":
      return "Genesis eligibility is locked until your profile setup is complete. The five free classes are unaffected.";
    default:
      return "Commander eligibility could not be read, so no Genesis entries are shown. The five free classes are unaffected.";
  }
}

/**
 * Guard the authenticated commander payload. The free classes are not sourced
 * here: they are ruleset data and stay visible even when this read fails.
 */
export function parseGenesisCatalog(payload: unknown, catalog: LobbyCatalog): GenesisCatalog {
  const raw = payload as {
    nftCommanders?: unknown;
    walletsChecked?: unknown;
    freshness?: unknown;
  } | null;

  if (!raw || !Array.isArray(raw.nftCommanders)) {
    return {
      state: "unavailable",
      entries: [],
      walletsChecked: 0,
      freshness: null,
      note: genesisNote("unavailable", null),
    };
  }

  const walletsChecked =
    typeof raw.walletsChecked === "number" && Number.isFinite(raw.walletsChecked)
      ? Math.max(0, Math.floor(raw.walletsChecked))
      : 0;
  const freshness = raw.freshness === "live" ? "live" : "cached";
  const seen = new Set<string>();
  const entries: GalleryGenesis[] = [];

  for (const row of raw.nftCommanders) {
    if (!row || typeof row !== "object") continue;
    const entry = row as {
      tokenId?: unknown;
      name?: unknown;
      status?: unknown;
      eligible?: unknown;
      reason?: unknown;
      imageUrl?: unknown;
      commander?: { class?: unknown } | null;
    };
    if (typeof entry.tokenId !== "string" || entry.tokenId.length === 0) continue;
    if (seen.has(entry.tokenId)) continue;
    seen.add(entry.tokenId);

    const classId = typeof entry.commander?.class === "string" ? entry.commander.class : null;
    const classEntry = classId ? catalog.commanders.find((c) => c.classId === classId) ?? null : null;
    const imageUrl =
      typeof entry.imageUrl === "string" && /^https:\/\//.test(entry.imageUrl)
        ? entry.imageUrl
        : null;
    const className = classEntry?.className ?? "Class unavailable";
    const name =
      typeof entry.name === "string" && entry.name.trim().length > 0
        ? entry.name.trim()
        : `Chog Genesis #${entry.tokenId}`;
    const reason = typeof entry.reason === "string" && entry.reason.length > 0 ? entry.reason : null;
    const status = typeof entry.status === "string" ? entry.status : "unknown";
    const eligible = entry.eligible === true && status === "derived" && classEntry !== null;

    entries.push({
      key: `nft:${entry.tokenId}`,
      tokenId: entry.tokenId,
      name,
      className,
      classId: classEntry?.classId ?? null,
      eligible,
      status,
      reason,
      imageUrl,
      art: classEntry?.art ?? null,
      cardArt: classEntry?.commanderCardArt ?? null,
      cost: classEntry?.cost ?? null,
      stats: classEntry?.stats ?? [],
      artNote: imageUrl
        ? "Original token art."
        : classEntry
          ? `Shared ${className} class art, not this token's artwork.`
          : "No authorized token art is available for this token.",
    });
  }

  if (raw.nftCommanders.length > 0 && entries.length === 0) {
    return {
      state: "unavailable",
      entries: [],
      walletsChecked,
      freshness,
      note: genesisNote("unavailable", freshness),
    };
  }

  const state = walletsChecked === 0 ? "no-wallet" : entries.length === 0 ? "empty" : "ready";
  return {
    state,
    entries,
    walletsChecked,
    freshness,
    note: genesisNote(state, freshness),
  };
}

/** A failed read is unavailable, or locked when the account is refused. */
export function genesisFromError(code: string): GenesisCatalog {
  const state = code === "FORBIDDEN" ? "locked" : "unavailable";
  return { state, entries: [], walletsChecked: 0, freshness: null, note: genesisNote(state, null) };
}

export function galleryProfileNotice(error: ApiError): LobbyNotice {
  return feedbackNoticeFor(error, "open the commanders gallery");
}

/** Only auth and setup locks get a notice; other failures stay in the section. */
export function eligibilityNotice(error: ApiError): LobbyNotice | null {
  if (error.code === "UNAUTHORIZED") {
    return sessionNotice("check Genesis commanders");
  }
  if (error.code === "FORBIDDEN") {
    return { tone: "error", text: `Genesis eligibility is locked for this account. ${error.message}` };
  }
  return null;
}

export function defaultSelectionKey(classes: GalleryClass[]): string | null {
  return (classes.find((c) => c.classId === "reaver") ?? classes[0])?.key ?? null;
}

export function resolveGallerySelection(
  key: string | null,
  classes: GalleryClass[],
  genesis: GenesisCatalog
): GallerySelection | null {
  if (!key) return null;
  const classItem = classes.find((c) => c.key === key) ?? null;
  if (classItem) return { kind: "free", key, classItem, genesis: null };
  const entry = genesis.entries.find((g) => g.key === key) ?? null;
  if (entry) return { kind: "nft", key, classItem: null, genesis: entry };
  return null;
}

/** The claim shape `resolveCommander` already understands. */
export function selectionChoice(selected: GallerySelection | null): CommanderChoiceLike | null {
  if (!selected) return null;
  if (selected.kind === "free" && selected.classItem) {
    return { kind: "free", class: selected.classItem.classId };
  }
  if (selected.kind === "nft" && selected.genesis) {
    return { kind: "nft", tokenId: selected.genesis.tokenId };
  }
  return null;
}

/** The eligibility shape the lobby model already understands. */
export function galleryEligibility(classes: GalleryClass[], genesis: GenesisCatalog): Eligibility {
  return {
    nft: genesis.entries.map((entry) => ({
      tokenId: entry.tokenId,
      classId: entry.classId,
      name: entry.name,
      eligible: entry.eligible,
      status: entry.status,
      reason: entry.reason,
      prestige: null,
      variant: null,
    })),
    free: classes.map((c) => ({ id: c.classId, name: c.freeName, classId: c.classId })),
  };
}
