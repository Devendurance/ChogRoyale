import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LobbyView from "./LobbyView";
import type { LobbyDeckCard, LobbyViewProps } from "./lobby-types";

const art = { src: "/assets/card-art.png", width: 256, height: 256 };
const cards: LobbyDeckCard[] = [
  { id: "troop", name: "Chogling", cost: 2, kind: "troop", typeLabel: "Troop", traits: [], art },
  { id: "building", name: "Rift Sentry", cost: 4, kind: "building", typeLabel: "Building", traits: [], art },
  { id: "spell", name: "Chaos Comet", cost: 3, kind: "spell", typeLabel: "Spell", traits: [], art },
  { id: "commander", name: "Bulwark", cost: 5, kind: "commander", typeLabel: "Commander", traits: [], art },
  { id: "troop-2", name: "Boulderback", cost: 4, kind: "troop", typeLabel: "Ground troop", traits: [], art: { ...art, width: 374, height: 526 } },
  { id: "building-2", name: "Mushroom Grove", cost: 3, kind: "building", typeLabel: "Building", traits: [], art },
  { id: "spell-2", name: "Frost Burst", cost: 2, kind: "spell", typeLabel: "Spell", traits: [], art },
  { id: "troop-3", name: "Choglings", cost: 1, kind: "troop", typeLabel: "Air troop", traits: [], art },
];

const props: LobbyViewProps = {
  phase: "ready",
  player: {
    username: "chog-player",
    displayName: "Chog Player",
    avatarUrl: null,
    avatarName: null,
    walletLinked: false,
    accountStatus: "active",
    onboardingComplete: true,
    onboardingNextStep: "",
  },
  commander: null,
  deck: { cards, averageCost: 3, revision: 1, updatedAt: "2026-10-31T00:00:00.000Z" },
  notices: [],
  battleEnabled: true,
  busy: false,
  calm: true,
  status: "Ready",
  onSignIn: () => undefined,
  onSignOut: () => undefined,
  onRefresh: () => undefined,
};

describe("LobbyView deck cards", () => {
  it("keeps eight cards and separates each desktop art slot from its shared footer", () => {
    const html = renderToStaticMarkup(createElement(LobbyView, props));
    const renderedCards = html.match(/<li class="app-card app-card--/g) ?? [];

    expect(renderedCards).toHaveLength(8);
    expect(html).toContain(
      '<span class="app-card__art"><img alt="" loading="lazy" width="256" height="256"',
    );
    expect(html).toContain(
      '<span class="app-card__footer"><span class="app-card__name">Chogling</span><span class="app-card__type">Troop</span></span>',
    );
  });
});
