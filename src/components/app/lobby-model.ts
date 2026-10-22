// Pure derivation for the lobby view (A1).
//
// Everything here is a function of already-fetched API payloads plus the
// server-built catalog. No network, no server imports: the same functions
// run in the authenticated container and in a static preview, so the preview
// shows exactly what the real lobby renders.

import type {
  LobbyCatalog,
  LobbyCommander,
  LobbyDeck,
  LobbyDeckCard,
  LobbyNotice,
  LobbyPlayer,
} from "./lobby-types";

/** The commander claim stored on a saved loadout. */
export interface CommanderChoiceLike {
  kind: "free" | "nft";
  class?: string;
  tokenId?: string;
  chainId?: number;
  contract?: string;
}

/** One row of the authenticated commander eligibility list. */
export interface EligibilityEntry {
  tokenId: string;
  /** Class id when the NFT has a derived commander definition. */
  classId: string | null;
  name: string | null;
  eligible: boolean;
  status: string;
  reason: string | null;
  prestige: string | null;
  variant: string | null;
}

export interface Eligibility {
  nft: EligibilityEntry[];
  /** Free starter templates. Always eligible, no NFT required. */
  free: Array<{ id: string; name: string; classId: string }>;
}

export interface ProfilePayload {
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
  accountStatus: string;
  onboardingStatus: string;
  avatar: { id: string; name: string; assetUrl: string } | null;
  roles: string[];
  wallets: Array<{ id: string; address: string; verifiedAt: string | null }>;
  onboarding: {
    hasUsername: boolean;
    hasAvatar: boolean;
    hasWallet: boolean;
    profileReady: boolean;
    complete: boolean;
    nextStep: string;
  };
}

export interface LoadoutPayload {
  loadout: {
    schemaVersion: number;
    cards: string[];
    commander: CommanderChoiceLike;
    revision: number;
    updatedAt: string;
  } | null;
  invalidSaved?: { revision: number; reason: string };
}

export interface CommandersPayload {
  nftCommanders: Array<{
    tokenId: string;
    name: string | null;
    status: string;
    eligible: boolean;
    reason?: string;
    commander?: {
      class: string;
      variant: string;
      prestige: string;
      powerScore: number;
    } | null;
  }>;
  freeCommanders: Array<{ id: string; name: string; class: string; powerScore: number }>;
  rulesetVersion: string;
  walletsChecked: number;
}

/** Map the API commander list onto the flat shape the model works with. */
export function toEligibility(payload: CommandersPayload | null): Eligibility | null {
  if (!payload) return null;
  // Same rule as resolvePlayer: a partial payload degrades the panel, it does
  // not throw the lobby away.
  const nft = Array.isArray(payload.nftCommanders) ? payload.nftCommanders : [];
  const free = Array.isArray(payload.freeCommanders) ? payload.freeCommanders : [];
  return {
    nft: nft.map((n) => ({
      tokenId: n.tokenId,
      classId: n.commander?.class ?? null,
      name: n.name,
      eligible: n.eligible,
      status: n.status,
      reason: n.reason ?? null,
      prestige: n.commander?.prestige ?? null,
      variant: n.commander?.variant ?? null,
    })),
    free: free.map((f) => ({ id: f.id, name: f.name, classId: f.class })),
  };
}

export function resolvePlayer(profile: ProfilePayload): LobbyPlayer {
  // A malformed payload must degrade the panel, never blank the lobby.
  const wallets = Array.isArray(profile.wallets) ? profile.wallets : [];
  const onboarding = profile.onboarding;
  const linked = wallets.some((w) => w.verifiedAt !== null);
  return {
    username: profile.username ?? "",
    displayName: profile.displayName,
    avatarUrl: profile.avatar?.assetUrl ?? null,
    avatarName: profile.avatar?.name ?? null,
    walletLinked: linked,
    accountStatus: profile.accountStatus,
    onboardingComplete: onboarding?.complete === true,
    onboardingNextStep: onboarding?.nextStep ?? "",
  };
}

function unresolvedCommander(originLabel: string, originNote: string): LobbyCommander {
  return {
    classId: "",
    className: "Unresolved",
    displayName: "Unresolved commander",
    roleShort: "",
    role: "",
    cost: 0,
    ability: null,
    counters: [],
    art: { src: "", width: 0, height: 0 },
    cardId: null,
    origin: "nft",
    originLabel,
    originNote,
    variant: null,
    prestige: null,
    eligible: null,
    resolved: false,
  };
}

/**
 * The commander the lobby shows. A saved loadout wins. Without one, the
 * lobby falls back to a clearly labelled class preview, never to an invented
 * selection.
 */
export function resolveCommander(
  catalog: LobbyCatalog,
  choice: CommanderChoiceLike | null,
  eligibility: Eligibility | null
): LobbyCommander {
  const preview = catalog.commanders.find((c) => c.classId === "reaver") ?? catalog.commanders[0]!;

  if (!choice) {
    // No commander is saved. Fall back to a free starter template, which the
    // API always reports as eligible, and label the picture as class art.
    const freeEntry = eligibility?.free.find((f) => f.classId === "reaver") ?? eligibility?.free[0] ?? null;
    const cls = catalog.commanders.find((c) => c.classId === (freeEntry?.classId ?? preview.classId)) ?? preview;
    return {
      classId: cls.classId,
      className: cls.className,
      displayName: freeEntry?.name ?? cls.freeName,
      roleShort: cls.roleShort,
      role: cls.role,
      cost: cls.cost,
      ability: cls.ability,
      counters: cls.counters,
      art: cls.art,
      cardId: null,
      origin: "preview",
      originLabel: "Free starter, not selected",
      originNote: `No commander is saved yet. This is ${cls.className} class art, shared by every ${cls.className} commander. It is not a specific NFT.`,
      variant: null,
      prestige: null,
      eligible: null,
      resolved: true,
    };
  }

  if (choice.kind === "free") {
    const cls = catalog.commanders.find((c) => c.classId === choice.class);
    if (!cls) {
      return unresolvedCommander(
        "Free starter",
        `The saved commander class "${choice.class ?? "unknown"}" is not part of the current ruleset, so no class art is shown.`
      );
    }
    return {
      classId: cls.classId,
      className: cls.className,
      displayName: cls.freeName,
      roleShort: cls.roleShort,
      role: cls.role,
      cost: cls.cost,
      ability: cls.ability,
      counters: cls.counters,
      art: cls.art,
      cardId: `cmdr:free-${cls.classId}`,
      origin: "free",
      originLabel: "Free starter",
      originNote: `This is ${cls.className} class art, shared by every ${cls.className} commander. It is not a specific NFT.`,
      variant: null,
      prestige: "Free",
      eligible: null,
      resolved: true,
    };
  }

  const tokenId = choice.tokenId ?? "";
  const entry = eligibility?.nft.find((e) => e.tokenId === tokenId) ?? null;
  if (!entry || !entry.classId) {
    return unresolvedCommander(
      "NFT commander",
      entry?.reason ??
        "This NFT has no derived commander definition yet, so no class art is shown for it."
    );
  }
  const cls = catalog.commanders.find((c) => c.classId === entry.classId);
  if (!cls) {
    return unresolvedCommander(
      "NFT commander",
      `The derived commander class "${entry.classId}" is not part of the current ruleset, so no class art is shown.`
    );
  }
  return {
    classId: cls.classId,
    className: cls.className,
    displayName: entry.name ?? `${cls.className} commander`,
    roleShort: cls.roleShort,
    role: cls.role,
    cost: cls.cost,
    ability: cls.ability,
    counters: cls.counters,
    art: cls.art,
    cardId: `cmdr:${tokenId}`,
    origin: "nft",
    originLabel: entry.eligible ? "NFT commander" : "NFT commander, ownership unproven",
    originNote: `This is ${cls.className} class art, shared by every ${cls.className} commander. The NFT portrait is not shown here.${
      entry.eligible
        ? ""
        : " A linked wallet does not prove ownership of this token yet."
    }`,
    variant: entry.variant,
    prestige: entry.prestige,
    eligible: entry.eligible,
    resolved: true,
  };
}

export interface DeckResult {
  deck: LobbyDeck | null;
  notice: LobbyNotice | null;
}

/**
 * The saved deck as real cards. Cards the current ruleset no longer knows
 * are dropped and reported, never silently rendered as blanks.
 */
export function resolveDeck(
  catalog: LobbyCatalog,
  cards: string[] | null,
  commander: LobbyCommander | null
): DeckResult {
  if (!cards) return { deck: null, notice: null };

  const list: LobbyDeckCard[] = [];
  const unknown: string[] = [];
  for (const id of cards) {
    const card = catalog.cards[id];
    if (!card) {
      unknown.push(id);
      continue;
    }
    list.push({
      id: card.id,
      name: card.name,
      cost: card.cost,
      kind: card.kind,
      typeLabel: card.typeLabel,
      traits: card.traits,
      art: card.art,
    });
  }

  if (commander?.resolved && commander.cardId) {
    const cls = catalog.commanders.find((c) => c.classId === commander.classId);
    if (cls) {
      list.push({
        id: commander.cardId,
        name: commander.displayName,
        cost: cls.cost,
        kind: "commander",
        typeLabel: "Commander",
        traits: commander.ability ? [commander.ability] : [],
        art: cls.commanderCardArt,
      });
    }
  }

  const averageCost = list.length
    ? Math.round((list.reduce((sum, c) => sum + c.cost, 0) / list.length) * 10) / 10
    : null;

  const notice: LobbyNotice | null = unknown.length
    ? {
        tone: "warn",
        text: `${unknown.length} saved card${unknown.length === 1 ? " is" : "s are"} not part of the current ruleset and cannot be shown: ${unknown.join(", ")}.`,
      }
    : null;

  return {
    deck: { cards: list, averageCost, revision: null, updatedAt: null },
    notice,
  };
}
