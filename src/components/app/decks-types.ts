// Plain prop contracts for the decks and collection screen (A2).
//
// Types only, no imports beyond the shared lobby types, so the screen can be
// rendered from the authenticated container, from a static preview or from a
// test without pulling server-only code into the client bundle.

import type { LobbyArt, LobbyCatalogCard, LobbyPlayer, LobbyStat, LobbyNoticeAction } from "./lobby-types";

/** The commander claim stored on a saved loadout. */
export interface CommanderChoiceLike {
  kind: "free" | "nft";
  class?: string;
  tokenId?: string;
  chainId?: number;
  contract?: string;
}

/** The two panels the screen switches between. */
export type DecksTab = "deck" | "collection";

/** Card role filter. The ruleset has exactly these three ordinary kinds. */
export type CardRoleFilter = "all" | "troop" | "spell" | "building";

/** Energy cost filter. The ruleset has no card above 5 energy. */
export type CardCostFilter = "all" | "1" | "2" | "3" | "4" | "5";

/**
 * Where the deck the player is editing came from and whether the account has
 * confirmed it. Every state the screen can be in is listed here, so the view
 * never has to guess.
 */
export type DeckSaveState =
  /** The account copy is still being read. */
  | "loading"
  /** The account copy matches the deck on screen. */
  | "saved"
  /** The deck on screen differs from the account copy. */
  | "unsaved"
  /** The account has no deck and the screen still shows the starting deck. */
  | "no-saved-deck"
  /** The account deck service could not be reached. */
  | "unavailable"
  /** The last save was refused because the account moved on. */
  | "conflict"
  /** The last save failed for another reason. */
  | "save-failed";

/** A commander the player may field, free or NFT. */
export interface DecksCommanderOption {
  /** Stable key: "free:<class>" or "nft:<tokenId>". */
  key: string;
  kind: "free" | "nft";
  classId: string;
  className: string;
  /** Display name: the free template name, or the NFT name. */
  displayName: string;
  /** Token id for an NFT commander. */
  tokenId: string | null;
  /** Eligibility basis and availability returned by the commander service. */
  basis?: "owned" | "borrowed";
  ownership?: "owned" | "borrowed" | "lent";
  loan?: { id: string; endsAt: string };
  /** Deploy cost of the class. Free and NFT commanders of one class share it. */
  cost: number | null;
  /** The commander card art for the class. Shared by every commander of it. */
  art: LobbyArt | null;
  /** The class combat numbers. Free and NFT commanders of one class share them. */
  stats: LobbyStat[];
  /** Why this option cannot be used, when it cannot. */
  blockedReason: string | null;
  /** Honest caption about what the picture is. */
  artNote: string;
}

export interface DecksCatalogCard extends LobbyCatalogCard {
  art: LobbyArt | null;
}

export interface DecksCardDetail {
  card: DecksCatalogCard;
  /** True when the card is one of the seven ordinary cards in the deck. */
  inDeck: boolean;
  stats: LobbyStat[];
}

/** Server-authoritative progression for one ordinary card. */
export interface DeckCardProgression {
  cardId: string;
  purchasedLevel: number;
  xpLevel: number;
  xp: number;
  xpTarget: number | null;
  goldCost: number | null;
  eligible: boolean;
  maxed: boolean;
}

export type ProgressionPhase = "loading" | "ready" | "unavailable" | "session" | "locked";

export type UpgradeStatus = "idle" | "working" | "success" | "error";

/** The card the detail panel is showing. */
export interface DecksSelection {
  /** Card id in the collection, or the commander marker. */
  cardId: string | null;
  /** True when the detail panel shows the commander instead of a card. */
  commander: boolean;
}

export interface DecksNotices {
  tone: "info" | "ok" | "warn" | "error";
  text: string;
  action?: LobbyNoticeAction;
}

/** A problem with the deck the player is editing. */
export interface DeckProblemView {
  code: "too-few" | "too-many" | "duplicate" | "unknown" | "commander";
  text: string;
}

/** The account copy the server holds, as shown in a revision conflict. */
export interface DeckConflict {
  revision: number;
  cards: string[];
  commander: CommanderChoiceLike;
}

/**
 * Everything the view needs. Plain data only: the container owns the session,
 * the network and the draft, so the view can also be rendered from a preview
 * or a test.
 */
export interface DecksViewProps {
  phase: "booting" | "login" | "profile" | "ready";
  player: LobbyPlayer | null;
  tab: DecksTab;
  onTabChange: (tab: DecksTab) => void;

  /** Every ordinary card in the current ruleset. */
  cards: DecksCatalogCard[];
  /** The collection after the role and cost filters. */
  visibleCards: DecksCatalogCard[];
  roleFilter: CardRoleFilter;
  costFilter: CardCostFilter;
  costs: number[];
  onRoleFilter: (role: CardRoleFilter) => void;
  onCostFilter: (cost: CardCostFilter) => void;

  /** The seven ordinary card slots. A null slot is empty. */
  deckCards: (DecksCatalogCard | null)[];
  /** True while the deck is waiting for a slot to drop the chosen card into. */
  swapping: boolean;
  deckProblems: DeckProblemView[];
  averageCost: number | null;
  /** How the average is labelled: a plain deck average or a partial one. */
  averageLabel: string;
  onDeckSlot: (slot: number) => void;
  onCancelSwap: () => void;

  commanderOption: DecksCommanderOption | null;
  commanderOptions: DecksCommanderOption[];
  onSelectCommander: (option: DecksCommanderOption) => void;

  selectedCardId: string | null;
  commanderOpen: boolean;
  onSelectCard: (id: string | null) => void;
  onOpenCommander: () => void;
  onCloseDetail: () => void;
  onCardAction: (cardId: string) => void;

  /** Card progression is separate from the editable deck draft. */
  progression: Record<string, DeckCardProgression>;
  progressionPhase: ProgressionPhase;
  progressionMessage: string | null;
  goldBalance: number | null;
  goldHistoryAvailable: boolean;
  upgradeCardId: string | null;
  upgradeStatus: UpgradeStatus;
  upgradeMessage: string | null;
  onUpgrade: (cardId: string) => void;

  saveState: DeckSaveState;
  /** Short state token for the ribbon badge. */
  saveLabel: string;
  /** The one visible sentence that explains the save state. */
  saveStatus: string;
  revision: number | null;
  saving: boolean;
  canSave: boolean;
  saveError: string | null;
  conflict: DeckConflict | null;
  onSave: () => void;
  onLoadAccountDeck: () => void;
  onOverwriteAccountDeck: () => void;

  notices: DecksNotices[];
  busy: boolean;
  calm: boolean;
  status: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
}
