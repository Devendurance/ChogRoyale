// Pure derivation for the decks and collection screen (A2).
//
// Everything here is a function of the server-built catalog plus the drafts the
// player has made. No network, no server imports: the same functions run in the
// authenticated container and in tests, so the screen shows exactly what the
// ruleset says.

import type { CommanderChoice } from "@/lib/battle-protocol";
import type { LobbyCatalog, LobbyCatalogCard } from "./lobby-types";
import type {
  CardCostFilter,
  CardRoleFilter,
  CommanderChoiceLike,
  DecksCatalogCard,
  DeckSaveState,
} from "./decks-types";

/** Ordinary cards in a deck. The commander is the eighth card. */
export const DECK_CARD_COUNT = 7;

/** Ordinary cards plus the commander. */
export const DECK_TOTAL_CARDS = 8;

/** The deck the player is editing. The commander claim is the strict one. */
export interface DeckDraft {
  cards: string[];
  commander: CommanderChoice;
}

/** A problem with the deck the player is editing. */
export interface DeckProblem {
  code: "too-few" | "too-many" | "duplicate" | "unknown" | "commander";
  text: string;
}

/**
 * The deck rules the client can check without the engine: seven distinct
 * ordinary cards that the current ruleset still knows. The server re-validates
 * the same contract before it stores anything.
 */
export function validateDeckDraft(catalog: LobbyCatalog, cards: string[]): DeckProblem[] {
  const problems: DeckProblem[] = [];
  if (cards.length < DECK_CARD_COUNT) {
    problems.push({ code: "too-few", text: `Pick ${DECK_CARD_COUNT - cards.length} more ordinary card${DECK_CARD_COUNT - cards.length === 1 ? "" : "s"} to reach ${DECK_CARD_COUNT}.` });
  }
  if (cards.length > DECK_CARD_COUNT) {
    problems.push({ code: "too-many", text: `A deck holds exactly ${DECK_CARD_COUNT} ordinary cards.` });
  }
  const seen = new Set<string>();
  for (const id of cards) {
    if (seen.has(id)) {
      problems.push({ code: "duplicate", text: `${catalog.cards[id]?.name ?? id} is already in the deck. Cards cannot repeat.` });
    }
    seen.add(id);
    if (!catalog.cards[id]) {
      problems.push({ code: "unknown", text: `${id} is not part of the current ruleset.` });
    }
  }
  if (cards.some((id) => id.startsWith("cmdr:"))) {
    problems.push({ code: "commander", text: "The commander is chosen separately and is not one of the seven ordinary cards." });
  }
  return problems;
}

/**
 * Mean deploy cost of the whole deck, commander included. The commander is a
 * real card in the engine deck, so its cost counts the same way.
 */
export function averageEnergyCost(catalog: LobbyCatalog, cards: string[], commanderCost: number | null): number | null {
  // An empty deck has no average yet, even with a commander in it.
  if (cards.length === 0) return null;
  const costs: number[] = [];
  for (const id of cards) {
    const card = catalog.cards[id];
    if (card) costs.push(card.cost);
  }
  if (commanderCost !== null) costs.push(commanderCost);
  if (costs.length === 0) return null;
  return Math.round((costs.reduce((sum, c) => sum + c, 0) / costs.length) * 10) / 10;
}

/** Adds a card, keeping the deck at seven cards and refusing duplicates. */
export function addCard(cards: string[], id: string): string[] {
  if (cards.includes(id)) return cards;
  if (cards.length >= DECK_CARD_COUNT) return cards;
  return [...cards, id];
}

/** Removes a card. The deck can be short afterwards, which the status shows. */
export function removeCard(cards: string[], id: string): string[] {
  return cards.filter((c) => c !== id);
}

/** Swaps the card in one slot for another id. */
export function replaceCard(cards: string[], slot: number, id: string): string[] {
  if (slot < 0 || slot >= cards.length) return cards;
  if (cards.includes(id) && cards[slot] !== id) return cards;
  const next = [...cards];
  next[slot] = id;
  return next;
}

/** True when two decks hold the same cards and the same commander. */
export function sameDraft(
  a: { cards: string[]; commander: CommanderChoiceLike } | null,
  b: { cards: string[]; commander: CommanderChoiceLike } | null
): boolean {
  if (!a || !b) return false;
  if (a.cards.length !== b.cards.length) return false;
  if (a.cards.some((c, i) => c !== b.cards[i])) return false;
  return sameCommander(a.commander, b.commander);
}

/** True when two commander claims are the same claim. */
export function sameCommander(a: CommanderChoiceLike, b: CommanderChoiceLike): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "free") return a.class === b.class;
  return a.tokenId === b.tokenId && a.chainId === b.chainId && (a.contract ?? "") === (b.contract ?? "");
}

/**
 * The account state of the deck on screen. `serverCards` is the copy the
 * account holds, or null when it holds none.
 */
export function deckSaveState(input: {
  loading: boolean;
  unavailable: boolean;
  serverCards: string[] | null;
  serverCommander: CommanderChoiceLike | null;
  draft: DeckDraft;
  hasSavedDeck: boolean;
  saveFailed: boolean;
  conflict: boolean;
}): DeckSaveState {
  if (input.loading) return "loading";
  if (input.unavailable) return "unavailable";
  if (input.conflict) return "conflict";
  if (input.saveFailed) return "save-failed";
  if (input.serverCards && input.serverCommander) {
    return sameDraft({ cards: input.serverCards, commander: input.serverCommander }, input.draft) ? "saved" : "unsaved";
  }
  if (!input.hasSavedDeck && input.draft.cards.length === 0) return "no-saved-deck";
  return "unsaved";
}

/** Every ordinary card in the current ruleset, in a stable order. */
export function allOrdinaryCards(catalog: LobbyCatalog): DecksCatalogCard[] {
  return Object.values(catalog.cards)
    .map((card) => ({ ...card }) as DecksCatalogCard)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

/** The collection after the role and cost filters. */
export function filterCards(cards: DecksCatalogCard[], role: CardRoleFilter, cost: CardCostFilter): DecksCatalogCard[] {
  return cards.filter((card) => {
    if (role !== "all" && card.kind !== role) return false;
    if (cost !== "all" && String(card.cost) !== cost) return false;
    return true;
  });
}

/** The distinct energy costs present in the ruleset, cheapest first. */
export function availableCosts(cards: DecksCatalogCard[]): number[] {
  return [...new Set(cards.map((c) => c.cost))].sort((a, b) => a - b);
}

/**
 * What tapping a collection card does to the deck, and why. The screen uses
 * this so the button label and the reason always agree.
 */
export type CardAction =
  | { kind: "add" }
  | { kind: "remove" }
  | { kind: "replace" }
  | { kind: "none"; reason: string };

export function cardAction(cards: string[], cardId: string): CardAction {
  if (cards.includes(cardId)) return { kind: "remove" };
  if (cards.length < DECK_CARD_COUNT) return { kind: "add" };
  return { kind: "replace" };
}

/** The commander deploy cost, read from the catalog for the chosen class. */
export function commanderCostFor(catalog: LobbyCatalog, commander: CommanderChoiceLike): number | null {
  if (commander.kind !== "free") return null;
  const cls = catalog.commanders.find((c) => c.classId === commander.class);
  return cls ? cls.cost : null;
}
/** The class of the chosen commander, free or NFT. */
export function commanderClassFor(commander: CommanderChoiceLike, nftClassOf: (tokenId: string) => string | null): string | null {
  if (commander.kind === "free") return commander.class ?? null;
  return commander.tokenId ? nftClassOf(commander.tokenId) : null;
}

/** A short, honest label for the deck status line. */
export function saveStateLabel(state: DeckSaveState, revision: number | null): string {
  switch (state) {
    case "loading":
      return "Loading your saved deck";
    case "saved":
      return revision !== null ? `Saved to your account (revision ${revision})` : "Saved to your account";
    case "unsaved":
      return "Unsaved changes on this device";
    case "no-saved-deck":
      return "No deck saved to your account yet";
    case "unavailable":
      return "The deck service is not available, so this deck is only on this device";
    case "conflict":
      return "Your account deck changed elsewhere";
    case "save-failed":
      return "The deck could not be saved";
  }
}

/** The card object for a deck slot, or null when the slot is empty. */
export function cardInDeck(catalog: LobbyCatalog, cards: string[], slot: number): LobbyCatalogCard | null {
  const id = cards[slot];
  if (!id) return null;
  return catalog.cards[id] ?? null;
}
