import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DecksView from "./DecksView";
import type { DeckCardProgression, DecksCatalogCard, DecksViewProps } from "./decks-types";

const art = { src: "/assets/card-art.png", width: 256, height: 256 };
const card = (id: string, name: string, cost: number): DecksCatalogCard => ({
  id,
  name,
  cost,
  kind: "troop",
  typeLabel: "Troop",
  traits: [],
  description: `${name} description`,
  stats: [{ label: "Health", value: "100" }],
  art,
});
const cards = [card("chogling", "Chogling", 1), card("boulderback", "Boulderback", 4)];
const ready: DeckCardProgression = { cardId: "chogling", purchasedLevel: 3, xpLevel: 4, xp: 450, xpTarget: 400, goldCost: 150, eligible: true, maxed: false };
const locked: DeckCardProgression = { cardId: "boulderback", purchasedLevel: 2, xpLevel: 2, xp: 120, xpTarget: 300, goldCost: 100, eligible: false, maxed: false };
const noop = () => undefined;

const base: DecksViewProps = {
  phase: "ready",
  player: null,
  tab: "collection",
  onTabChange: noop,
  cards,
  visibleCards: cards,
  roleFilter: "all",
  costFilter: "all",
  costs: [1, 4],
  onRoleFilter: noop,
  onCostFilter: noop,
  deckCards: [cards[0]!, null, null, null, null, null, null],
  swapping: false,
  deckProblems: [],
  averageCost: null,
  averageLabel: "avg cost",
  onDeckSlot: noop,
  onCancelSwap: noop,
  commanderOption: null,
  commanderOptions: [],
  onSelectCommander: noop,
  selectedCardId: null,
  commanderOpen: false,
  onSelectCard: noop,
  onOpenCommander: noop,
  onCloseDetail: noop,
  onCardAction: noop,
  progression: { chogling: ready, boulderback: locked },
  progressionPhase: "ready",
  progressionMessage: null,
  goldBalance: 500,
  goldHistoryAvailable: true,
  upgradeCardId: null,
  upgradeStatus: "idle",
  upgradeMessage: null,
  onUpgrade: noop,
  saveState: "saved",
  saveLabel: "Saved",
  saveStatus: "Saved",
  revision: 1,
  saving: false,
  canSave: false,
  saveError: null,
  conflict: null,
  onSave: noop,
  onLoadAccountDeck: noop,
  onOverwriteAccountDeck: noop,
  notices: [],
  busy: false,
  calm: true,
  status: "",
  onSignIn: noop,
  onSignOut: noop,
  onRefresh: noop,
};

const render = (props: Partial<DecksViewProps>) => renderToStaticMarkup(createElement(DecksView, { ...base, ...props }));

describe("DecksView card level plates", () => {
  it("draws server levels on a plate, with the upgrade-ready state only for an eligible card", () => {
    const html = render({});
    expect(html).toContain('<span class="app-lvl__plate">Level 3</span>');
    expect(html).toContain('<span class="app-lvl__plate">Level 2</span>');
    expect(html).toContain("app-lvl app-lvl--ready");
    expect(html).toContain("app-lvl app-lvl--xp-locked");
    expect((html.match(/app-tile--ready/g) ?? []).length).toBe(1);
    expect((html.match(/app-lvl__up/g) ?? []).length).toBe(1);
  });

  it("never draws a level when progression is not a ready server read", () => {
    for (const phase of ["loading", "unavailable", "session", "locked"] as const) {
      const html = render({ progressionPhase: phase });
      expect(html).not.toContain("app-lvl__plate");
      expect(html).not.toContain("app-tile--ready");
      expect(html).toContain("Unavailable");
    }
  });
});

describe("DecksView upgrade feedback", () => {
  it("opens the card detail as a modal with a reachable close and deck action", () => {
    const html = render({ selectedCardId: "chogling" });
    expect(html).toContain('class="app-cardmodal"');
    expect(html).toMatch(/role="dialog" aria-modal="true"/);
    expect(html).toContain('aria-label="Close the card details"');
    expect(html).toContain("app-cardmodal__body");
    expect(html).toContain("app-cardmodal__foot");
    expect(html).toContain("Remove from deck");
  });

  it("uses the green upgrade action in the card detail and keeps it disabled while locked", () => {
    const readyHtml = render({ selectedCardId: "chogling" });
    expect(readyHtml).toMatch(/class="app-btn app-btn--upgrade"[^>]*>.*Upgrade card/);
    const lockedHtml = render({ selectedCardId: "boulderback" });
    expect(lockedHtml).toMatch(/class="app-btn app-btn--upgrade"[^>]*disabled=""[^>]*>180 XP to unlock/);
  });

  it("shows the before and after levels only from a supplied confirmed celebration", () => {
    expect(render({ selectedCardId: "chogling" })).not.toContain("app-levelup");
    const html = render({
      selectedCardId: "chogling",
      upgradeStatus: "success",
      upgradeCelebration: { cardId: "chogling", fromLevel: 3, toLevel: 4, key: "k" },
      onDismissCelebration: noop,
    });
    expect(html).toContain("Upgrade confirmed");
    expect(html).toContain('<span class="app-levelup__plate">Level 3</span>');
    expect(html).toContain('<span class="app-levelup__plate app-levelup__plate--after">Level 4</span>');
    expect(html).toContain('aria-modal="true"');
  });
});

describe("DecksView post-training tour targets", () => {
  it("marks only the first visible collection card as the real card target", () => {
    const deckTab = render({ tab: "deck" });
    expect(deckTab).not.toContain('data-tour="collection-card"');

    const collection = render({ tab: "collection" });
    expect((collection.match(/data-tour="collection-card"/g) ?? []).length).toBe(1);
  });

  it("exposes the real progression values the tour sentence reads", () => {
    const html = render({ selectedCardId: "chogling" });
    expect(html).toContain('data-tour="card-progress"');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('data-level="3"');
    expect(html).toContain('data-xp="450"');
    expect(html).toContain('data-xp-target="400"');
    expect(html).toContain('data-gold="150"');
    expect(html).toContain("data-tour=\"card-detail-close\"");
  });

  it("never exposes a level or a Gold price while the server read is unavailable", () => {
    const html = render({ selectedCardId: "chogling", progressionPhase: "unavailable", progression: {} });
    expect(html).toContain('data-tour="card-progress"');
    expect(html).toContain('data-state="unavailable"');
    expect(html).toMatch(/data-level=""/);
    expect(html).toMatch(/data-gold=""/);
  });
});
