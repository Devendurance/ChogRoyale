// Plain prop contracts for the authenticated lobby (A1).
//
// This module holds types only and imports nothing, so the view can be
// rendered from the authenticated container, from a static preview, or from a
// test without pulling server-only code into the client bundle.

export type LobbyCommanderOrigin = "free" | "nft" | "preview";

export type LobbyNoticeTone = "info" | "ok" | "warn" | "error";

export interface LobbyNotice {
  tone: LobbyNoticeTone;
  text: string;
  /** Optional honest escape hatch, e.g. the existing onboarding flow. */
  action?: { label: string; href: string };
}

export interface LobbyCatalogCard {
  id: string;
  name: string;
  cost: number;
  kind: "troop" | "spell" | "building";
  /** Human label for the card type, e.g. "Air troop", "Building", "Spell". */
  typeLabel: string;
  /** Short real traits read from the card definition, never invented. */
  traits: string[];
  /** One line describing what the card does, read from its definition. */
  description: string;
  /** The real numbers behind the card, for the detail panel. */
  stats: LobbyStat[];
  /** Approved art, or null when the card has no approved art. */
  art: LobbyArt | null;
}

/** One labelled fact about a card or a commander class. */
export interface LobbyStat {
  label: string;
  value: string;
}

/** Approved art with its intrinsic size, so the image pipeline never crops. */
export interface LobbyArt {
  src: string;
  width: number;
  height: number;
}

export interface LobbyCatalogCommander {
  classId: string;
  className: string;
  /** Short role label derived from the class roster, e.g. "Tank". */
  roleShort: string;
  /** Full authored class role sentence. */
  role: string;
  /** Deploy cost from the class-keyed combat profile. */
  cost: number;
  /** Active ability name from the class roster, when the class has one. */
  ability: string | null;
  /** Class ids this commander counters. */
  counters: string[];
  /** Name of the free starter template for this class. */
  freeName: string;
  /** The real combat numbers for the class. Free and NFT commanders of the
   *  same class report exactly the same rows. */
  stats: LobbyStat[];
  /** Shared commander class art. */
  art: LobbyArt;
  /** Game sprite for the class. */
  sprite: LobbyArt;
  /** Card derivative used when the commander sits in the deck strip. */
  commanderCardArt: LobbyArt;
}

export interface LobbyCatalog {
  cards: Record<string, LobbyCatalogCard>;
  commanders: LobbyCatalogCommander[];
}

export interface LobbyPlayer {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarName: string | null;
  /** True only when the API reports a linked wallet that passed verification. */
  walletLinked: boolean;
  accountStatus: string;
  onboardingComplete: boolean;
  onboardingNextStep: string;
}

export interface LobbyDeckCard {
  id: string;
  name: string;
  cost: number;
  kind: "troop" | "spell" | "building" | "commander";
  typeLabel: string;
  traits: string[];
  art: LobbyArt | null;
}

export interface LobbyDeck {
  cards: LobbyDeckCard[];
  /** Mean deploy cost of the deck, computed from the real card costs. */
  averageCost: number | null;
  revision: number | null;
  updatedAt: string | null;
}

export interface LobbyCommander {
  classId: string;
  className: string;
  /** Name shown on the stage, e.g. "Ashen Recruit" or the NFT name. */
  displayName: string;
  roleShort: string;
  role: string;
  cost: number;
  ability: string | null;
  counters: string[];
  art: LobbyArt;
  /** Deck card id for this commander, when it can be resolved. */
  cardId: string | null;
  origin: LobbyCommanderOrigin;
  /** Short label for the origin line, e.g. "Free starter". */
  originLabel: string;
  /** Honest caption explaining what the art is and is not. */
  originNote: string;
  variant: string | null;
  prestige: string | null;
  /** Ownership proof state for NFT commanders, null for free ones. */
  eligible: boolean | null;
  /** False when the commander definition could not be resolved. */
  resolved: boolean;
}

export type LobbyPhase = "booting" | "login" | "profile" | "ready";

export interface LobbyViewProps {
  phase: LobbyPhase;
  player: LobbyPlayer | null;
  commander: LobbyCommander | null;
  deck: LobbyDeck | null;
  /** Copy for the deck strip when there is no deck to show. */
  deckEmpty?: { title: string; body: string };
  notices: LobbyNotice[];
  /** False when the battle route is closed in this build. */
  battleEnabled: boolean;
  /** True while a refresh is in flight. */
  busy: boolean;
  /** True when ambient motion must be suppressed (reduced motion, Save-Data). */
  calm: boolean;
  /** Text announced to assistive tech when it changes. */
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
}
