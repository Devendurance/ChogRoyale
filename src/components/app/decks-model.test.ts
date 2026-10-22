// Focused tests for the A2 deck model. These are the rules the deck screen
// shows: the seven plus one contract, the average energy cost, the collection
// filters and the honest account states.

import { describe, it, expect } from "vitest";
import {
  addCard,
  allOrdinaryCards,
  averageEnergyCost,
  availableCosts,
  cardAction,
  commanderCostFor,
  deckAverage,
  deckSaveState,
  filterCards,
  removeCard,
  replaceCard,
  sameDraft,
  saveStateLabel,
  saveStateStatus,
  validateDeckDraft,
  type DeckDraft,
} from "./decks-model";
import type { LobbyCatalog, LobbyCatalogCard, LobbyCatalogCommander } from "./lobby-types";

function card(id: string, name: string, cost: number, kind: LobbyCatalogCard["kind"] = "troop"): LobbyCatalogCard {
  return { id, name, cost, kind, typeLabel: "Troop", traits: [], description: "", stats: [], art: null };
}

const commander = (classId: string, cost: number): LobbyCatalogCommander => ({
  classId,
  className: classId,
  roleShort: "Tank",
  role: "Tank",
  cost,
  ability: null,
  counters: [],
  freeName: `${classId} starter`,
  stats: [],
  art: { src: "", width: 1, height: 1 },
  sprite: { src: "", width: 1, height: 1 },
  commanderCardArt: { src: "", width: 1, height: 1 },
});

const catalog: LobbyCatalog = {
  cards: Object.fromEntries(
    [
      card("choglings", "Choglings", 2),
      card("chaos_archer", "Chaos Archer", 3),
      card("boulderback", "Boulderback", 5),
      card("frostshell", "Frostshell", 4),
      card("rift_runner", "Rift Runner", 3),
      card("sparkcaster", "Sparkcaster", 4),
      card("chaos_bolt", "Chaos Bolt", 3, "spell"),
      card("rift_sentry", "Rift Sentry", 4, "building"),
    ].map((c) => [c.id, c])
  ),
  commanders: [commander("scout", 4), commander("warden", 5)],
};

const seven = ["choglings", "chaos_archer", "boulderback", "frostshell", "rift_runner", "sparkcaster", "chaos_bolt"];

describe("deck contract", () => {
  it("accepts exactly seven distinct ordinary cards", () => {
    expect(validateDeckDraft(catalog, seven)).toEqual([]);
  });

  it("reports a short deck", () => {
    const problems = validateDeckDraft(catalog, seven.slice(0, 5));
    expect(problems.some((p) => p.code === "too-few")).toBe(true);
  });

  it("reports a duplicate card", () => {
    const problems = validateDeckDraft(catalog, [...seven.slice(0, 6), "choglings"]);
    expect(problems.some((p) => p.code === "duplicate")).toBe(true);
  });

  it("reports a card the ruleset does not know", () => {
    const problems = validateDeckDraft(catalog, [...seven.slice(0, 6), "not_a_card"]);
    expect(problems.some((p) => p.code === "unknown")).toBe(true);
  });

  it("reports a commander card placed among the seven", () => {
    const problems = validateDeckDraft(catalog, [...seven.slice(0, 6), "cmdr:free-scout"]);
    expect(problems.some((p) => p.code === "commander")).toBe(true);
  });

  it("holds the deck at seven cards and refuses duplicates", () => {
    expect(addCard(seven, "rift_sentry")).toEqual(seven);
    expect(addCard(seven, "choglings")).toEqual(seven);
    expect(addCard(seven.slice(0, 6), "rift_sentry")).toHaveLength(7);
  });

  it("removes and replaces a card in place", () => {
    expect(removeCard(seven, "choglings")).toEqual(seven.slice(1));
    expect(replaceCard(seven, 0, "rift_sentry")).toEqual(["rift_sentry", ...seven.slice(1)]);
    expect(replaceCard(seven, 0, "chaos_archer")).toEqual(seven);
  });
});

describe("average energy cost", () => {
  it("averages the seven cards and the commander, because the commander is a card", () => {
    // 2+3+5+4+3+4+3 = 24, commander scout 4 -> 28 over 8 cards = 3.5
    expect(averageEnergyCost(catalog, seven, 4)).toBe(3.5);
  });

  it("is null when the deck is empty and the commander is unknown", () => {
    expect(averageEnergyCost(catalog, [], null)).toBeNull();
    expect(averageEnergyCost(catalog, [], 4)).toBeNull();
  });

  it("ignores cards the ruleset no longer knows", () => {
    expect(averageEnergyCost(catalog, ["choglings", "gone"], 4)).toBe(3);
  });
});

describe("average energy label", () => {
  it("calls a complete seven plus one deck the deck average", () => {
    const average = deckAverage(catalog, seven, 4, true);
    expect(average).toEqual({
      value: 3.5,
      label: "average energy",
      sentence: "Average energy cost 3.5 across the 7 cards and the commander.",
    });
  });

  it("calls an incomplete selection the current selection average", () => {
    const average = deckAverage(catalog, seven.slice(0, 5), 4, false);
    expect(average.value).toBe(3.5);
    expect(average.label).toBe("current selection average");
    expect(average.sentence).toBe("Current selection average energy cost 3.5, from 5 cards and the commander.");
  });

  it("does not call a deck complete without a known commander cost", () => {
    const average = deckAverage(catalog, seven, null, true);
    expect(average.value).toBe(3.4);
    expect(average.label).toBe("current selection average");
    expect(average.sentence).toBe("Current selection average energy cost 3.4, from 7 cards.");
  });

  it("has no average before a card is selected", () => {
    const average = deckAverage(catalog, [], 4, false);
    expect(average.value).toBeNull();
    expect(average.label).toBe("no cards yet");
  });
});

describe("commander cost", () => {
  it("reads the cost of the chosen free class", () => {
    expect(commanderCostFor(catalog, { kind: "free", class: "warden" })).toBe(5);
    expect(commanderCostFor(catalog, { kind: "free", class: "nope" })).toBeNull();
    expect(commanderCostFor(catalog, { kind: "nft", tokenId: "1" })).toBeNull();
  });
});

describe("collection", () => {
  it("lists every ordinary card in the ruleset, cheapest first", () => {
    const all = allOrdinaryCards(catalog);
    expect(all).toHaveLength(8);
    expect(all[0]!.cost).toBe(2);
  });

  it("filters by role and by energy cost", () => {
    expect(filterCards(allOrdinaryCards(catalog), "spell", "all").map((c) => c.id)).toEqual(["chaos_bolt"]);
    expect(filterCards(allOrdinaryCards(catalog), "all", "4").map((c) => c.id).sort()).toEqual([
      "frostshell",
      "rift_sentry",
      "sparkcaster",
    ]);
    expect(filterCards(allOrdinaryCards(catalog), "building", "2")).toEqual([]);
  });

  it("reports the energy costs that exist", () => {
    expect(availableCosts(allOrdinaryCards(catalog))).toEqual([2, 3, 4, 5]);
  });
});

describe("card action", () => {
  it("adds to a deck with room, removes a card that is in it and asks for a slot when full", () => {
    expect(cardAction(seven.slice(0, 3), "rift_sentry").kind).toBe("add");
    expect(cardAction(seven, "boulderback").kind).toBe("remove");
    expect(cardAction(seven, "rift_sentry").kind).toBe("replace");
  });
});

describe("account state", () => {
  const draft: DeckDraft = { cards: seven, commander: { kind: "free", class: "scout" } };

  it("reads the account copy as saved when it matches the deck", () => {
    const state = deckSaveState({
      loading: false,
      unavailable: false,
      serverCards: seven,
      serverCommander: { kind: "free", class: "scout" },
      draft,
      hasSavedDeck: true,
      saveFailed: false,
      conflict: false,
    });
    expect(state).toBe("saved");
  });

  it("reads a different deck as unsaved changes", () => {
    const state = deckSaveState({
      loading: false,
      unavailable: false,
      serverCards: seven,
      serverCommander: { kind: "free", class: "scout" },
      draft: { ...draft, commander: { kind: "free", class: "warden" } },
      hasSavedDeck: true,
      saveFailed: false,
      conflict: false,
    });
    expect(state).toBe("unsaved");
  });

  it("reads an empty account with an untouched deck as no saved deck", () => {
    const state = deckSaveState({
      loading: false,
      unavailable: false,
      serverCards: null,
      serverCommander: null,
      draft: { cards: [], commander: { kind: "free", class: "scout" } },
      hasSavedDeck: false,
      saveFailed: false,
      conflict: false,
    });
    expect(state).toBe("no-saved-deck");
  });

  it("never claims a save when the service is unreachable", () => {
    const state = deckSaveState({
      loading: false,
      unavailable: true,
      serverCards: null,
      serverCommander: null,
      draft,
      hasSavedDeck: false,
      saveFailed: false,
      conflict: false,
    });
    expect(state).toBe("unavailable");
    expect(saveStateLabel(state)).toBe("Save unavailable");
    expect(saveStateLabel(state)).not.toContain("Saved to your account");
    expect(saveStateStatus(state, null)).toBe("Account saving is unavailable, so this deck stays on this device.");
  });

  it("only says Saved to your account for a confirmed save", () => {
    expect(saveStateStatus("saved", 4)).toBe("Saved to your account (revision 4).");
    expect(saveStateStatus("unsaved", 4)).toBe("Unsaved changes on this device.");
  });

  it("reports a conflict and a failed save as their own states", () => {
    const base = {
      loading: false,
      unavailable: false,
      serverCards: null,
      serverCommander: null,
      draft,
      hasSavedDeck: false,
    };
    expect(deckSaveState({ ...base, saveFailed: false, conflict: true })).toBe("conflict");
    expect(deckSaveState({ ...base, saveFailed: true, conflict: false })).toBe("save-failed");
  });

  it("compares decks by card order and commander claim", () => {
    expect(sameDraft(draft, { cards: [...seven], commander: { kind: "free", class: "scout" } })).toBe(true);
    expect(sameDraft(draft, { cards: [...seven].reverse(), commander: { kind: "free", class: "scout" } })).toBe(false);
    expect(sameDraft(draft, { cards: [...seven], commander: { kind: "nft", tokenId: "1" } })).toBe(false);
  });
});
