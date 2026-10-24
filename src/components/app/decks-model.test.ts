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
  commanderOptionsFor,
  deckAverage,
  deckSaveState,
  filterCards,
  removeCard,
  replaceCard,
  progressionDisplayState,
  progressionPercent,
  progressionStatusText,
  sameDraft,
  saveStateLabel,
  saveStateStatus,
  validateDeckDraft,
  type DeckDraft,
} from "./decks-model";
import type { LobbyCatalog, LobbyCatalogCard, LobbyCatalogCommander } from "./lobby-types";
import type { DeckCardProgression } from "./decks-types";
import type { CommandersPayload } from "./lobby-model";

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

describe("lending-aware commander options", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const borrowed: CommandersPayload["nftCommanders"][number] = {
    tokenId: "42", name: "Genesis commander", status: "derived", eligible: true,
    basis: "borrowed", ownership: "borrowed",
    loan: { id: "loan-42", endsAt: "2026-10-25T12:00:00Z" },
    commander: { class: "scout", variant: "base", prestige: "base", powerScore: 1 },
  };
  const payload = (entry: CommandersPayload["nftCommanders"][number]): CommandersPayload => ({ nftCommanders: [entry], freeCommanders: [], rulesetVersion: "test", walletsChecked: 0 });

  it("allows an eligible borrowed option with its server loan metadata and preserves free options", () => {
    const options = commanderOptionsFor(catalog, payload(borrowed), now);
    expect(options.filter((option) => option.kind === "free")).toHaveLength(catalog.commanders.length);
    expect(options.find((option) => option.tokenId === "42")).toMatchObject({ key: "nft:42", basis: "borrowed", ownership: "borrowed", blockedReason: null, classId: "scout", cost: 4, loan: borrowed.loan });
  });

  it("blocks a lent owned option even when stale eligibility says true", () => {
    const option = commanderOptionsFor(catalog, payload({ ...borrowed, basis: "owned", ownership: "lent" }), now).find((entry) => entry.kind === "nft");
    expect(option).toMatchObject({ basis: "owned", ownership: "lent", blockedReason: "This commander is currently lent and unavailable." });
  });

  it("blocks borrowed options with missing, malformed or expired loan metadata and server refusals", () => {
    for (const entry of [
      { ...borrowed, loan: undefined },
      { ...borrowed, loan: { id: "loan-42", endsAt: "invalid" } },
      { ...borrowed, loan: { id: "loan-42", endsAt: "2026-10-24T12:00:00Z" } },
      { ...borrowed, eligible: false },
    ]) {
      expect(commanderOptionsFor(catalog, payload(entry), now).find((option) => option.kind === "nft")?.blockedReason).toBeTruthy();
    }
  });
});

const progression = (overrides: Partial<DeckCardProgression> = {}): DeckCardProgression => ({
  cardId: "boulderback",
  purchasedLevel: 1,
  xpLevel: 2,
  xp: 5,
  xpTarget: 5,
  goldCost: 100,
  eligible: true,
  maxed: false,
  ...overrides,
});

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

describe("card progression display", () => {
  it("keeps purchased level distinct from the XP-unlocked level", () => {
    const entry = progression({ purchasedLevel: 1, xpLevel: 3, xp: 12, xpTarget: 5 });
    expect(entry.purchasedLevel).toBe(1);
    expect(entry.xpLevel).toBe(3);
    expect(progressionDisplayState(entry, 100)).toBe("ready");
  });

  it("reports XP and Gold locks from server values", () => {
    expect(progressionDisplayState(progression({ xp: 2, xpTarget: 5, eligible: false }), 100)).toBe("xp-locked");
    expect(progressionDisplayState(progression({ eligible: false }), 20)).toBe("gold-locked");
    expect(progressionStatusText("gold-locked", progression({ eligible: false }))).toBe("Need 100 Gold");
  });

  it("reports max level and clamps the XP bar", () => {
    const entry = progression({ purchasedLevel: 10, xpLevel: 10, xp: 999, xpTarget: null, maxed: true, eligible: false, goldCost: null });
    expect(progressionDisplayState(entry, 0)).toBe("maxed");
    expect(progressionPercent(entry)).toBe(100);
  });

  it("keeps missing progression unavailable instead of inventing a level", () => {
    expect(progressionDisplayState(null, 100, "unavailable")).toBe("unavailable");
    expect(progressionPercent(null)).toBe(0);
    expect(progressionStatusText("unavailable", null)).toBe("Progression unavailable");
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
