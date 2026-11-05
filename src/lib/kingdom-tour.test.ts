import { describe, expect, it } from "vitest";
import {
  EMPTY_KINGDOM_TOUR,
  KINGDOM_TOUR_STEPS,
  KINGDOM_TOUR_TOTAL,
  coachPlacement,
  coachPosition,
  kingdomTourCanStart,
  kingdomTourInvite,
  kingdomTourKey,
  kingdomTourProgressionLine,
  kingdomTourRouteMatches,
  kingdomTourStepIndex,
  parseKingdomTour,
} from "./kingdom-tour";

const graduated = { completedStages: 3, grandfathered: false };
const store = (over: Partial<typeof EMPTY_KINGDOM_TOUR> = {}) => ({ ...EMPTY_KINGDOM_TOUR, ...over });

describe("Meet Your Kingdom tour contract", () => {
  it("covers the five real tabs, the battle hall and the card detail beats", () => {
    const ids = KINGDOM_TOUR_STEPS.map((step) => step.id);
    expect(ids).toEqual(["lobby", "battle", "decks", "card-detail", "card-upgrades", "commanders", "progress", "profile"]);
    expect(KINGDOM_TOUR_TOTAL).toBe(8);
    for (const step of KINGDOM_TOUR_STEPS) {
      expect(step.route.startsWith("/app")).toBe(true);
      expect(step.target.startsWith("[data-tour=")).toBe(true);
      expect(step.title.length).toBeGreaterThan(3);
    }
    expect(KINGDOM_TOUR_STEPS.map((step) => step.target)).toEqual(
      expect.arrayContaining([
        '[data-tour="nav-lobby"]',
        '[data-tour="play-practice"]',
        '[data-tour="nav-decks"]',
        '[data-tour="collection-card"]',
        '[data-tour="card-progress"]',
        '[data-tour="nav-commanders"]',
        '[data-tour="nav-progress"]',
        '[data-tour="nav-profile"]',
      ]),
    );
    // Tower upgrading is not part of this slice and has no step or fake control.
    expect(ids.join(" ")).not.toContain("tower");
  });

  it("states the real battle modes, the closed ranked gate and the missing tower upgrades", () => {
    const battle = KINGDOM_TOUR_STEPS.find((step) => step.id === "battle")!;
    expect(battle.body).toContain("Practice");
    expect(battle.body).toContain("Unranked");
    expect(battle.body).toContain("Private");
    expect(battle.body).toContain("Ranked stays closed");
    expect(battle.body).toContain("result screen");
    const upgrades = KINGDOM_TOUR_STEPS.find((step) => step.id === "card-upgrades")!;
    expect(upgrades.body).toContain("Tower upgrades are not available");
  });

  it("matches routes exactly so a subroute is never mistaken for its parent", () => {
    expect(kingdomTourRouteMatches("/app", "/app")).toBe(true);
    expect(kingdomTourRouteMatches("/app/", "/app")).toBe(true);
    expect(kingdomTourRouteMatches("/app/play", "/app/play")).toBe(true);
    expect(kingdomTourRouteMatches("/app/play/training", "/app/play")).toBe(false);
    expect(kingdomTourRouteMatches("/app/play/training/battle", "/app/play")).toBe(false);
    expect(kingdomTourRouteMatches("/app/progress/legacy", "/app/progress")).toBe(false);
  });

  it("invites only a server-verified 3/3 account that has not been prompted or finished", () => {
    expect(kingdomTourInvite(graduated, store())).toBe(true);
    expect(kingdomTourInvite({ completedStages: 2, grandfathered: false }, store())).toBe(false);
    expect(kingdomTourInvite({ completedStages: 0, grandfathered: false }, store())).toBe(false);
    expect(kingdomTourInvite(null, store())).toBe(false);
    expect(kingdomTourInvite(graduated, store({ completed: true }))).toBe(false);
    expect(kingdomTourInvite(graduated, store({ dismissed: true }))).toBe(false);
    expect(kingdomTourInvite(graduated, store({ prompted: true }))).toBe(false);
    expect(kingdomTourInvite(graduated, store({ active: true, stepId: "decks" }))).toBe(false);
  });

  it("never forces the tour on a grandfathered account but lets it start manually", () => {
    const grandfathered = { completedStages: 0, grandfathered: true };
    expect(kingdomTourInvite(grandfathered, store())).toBe(false);
    expect(kingdomTourCanStart(grandfathered)).toBe(true);
    expect(kingdomTourCanStart({ completedStages: 3, grandfathered: false })).toBe(true);
    expect(kingdomTourCanStart({ completedStages: 2, grandfathered: false })).toBe(false);
    expect(kingdomTourCanStart(null)).toBe(false);
  });

  it("persists an account-scoped resume state and survives malformed JSON", () => {
    expect(kingdomTourKey("did:privy:abc")).toBe("chog-royale.kingdom-tour.v1.did:privy:abc");
    expect(kingdomTourKey("did:privy:abc")).not.toContain("token");
    expect(parseKingdomTour(null)).toEqual(EMPTY_KINGDOM_TOUR);
    expect(parseKingdomTour("not json")).toEqual(EMPTY_KINGDOM_TOUR);
    expect(parseKingdomTour('{"active":true,"stepId":"nope"}')).toEqual({
      completed: false,
      dismissed: false,
      prompted: false,
      active: true,
      stepId: null,
    });
    expect(parseKingdomTour('{"active":true,"stepId":"card-upgrades","completed":false,"prompted":true}')).toMatchObject({
      active: true,
      stepId: "card-upgrades",
      prompted: true,
    });
    expect(kingdomTourStepIndex("profile")).toBe(7);
    expect(kingdomTourStepIndex("unknown" as never)).toBe(0);
  });

  it("describes real card progression values and never invents a balance", () => {
    expect(
      kingdomTourProgressionLine({ state: "ready", level: "4", xp: "120", xpTarget: "200", gold: "250", status: "" }),
    ).toBe(
      "Purchased level 4, 120 earned XP toward a 200 XP target. The next upgrade costs 250 Gold, and only the Upgrade button spends it.",
    );
    expect(
      kingdomTourProgressionLine({ state: "xp-locked", level: "2", xp: "40", xpTarget: "90", gold: "150", status: "50 XP to unlock" }),
    ).toContain("50 XP to unlock");
    expect(
      kingdomTourProgressionLine({ state: "maxed", level: "10", xp: "900", xpTarget: "", gold: "", status: "" }),
    ).toContain("maximum level");
    expect(
      kingdomTourProgressionLine({ state: "unavailable", level: "", xp: "", xpTarget: "", gold: "", status: "" }),
    ).toContain("cannot be checked right now");
    expect(kingdomTourProgressionLine(null)).toContain("No level or Gold");
  });

  it("places the coach away from a bottom nav and clamps tight viewports to the centre", () => {
    expect(coachPlacement({ top: 720, bottom: 790 }, 844, 200, 76)).toBe("above");
    expect(coachPlacement({ top: 90, bottom: 150 }, 844, 200, 76)).toBe("below");
    expect(coachPlacement(null, 844, 200, 76)).toBe("center");
    // A 320x568 phone with a tall card cannot fit above or below a mid-page
    // target, so the coach centres and stays fully visible.
    expect(coachPlacement({ top: 250, bottom: 330 }, 568, 260, 76)).toBe("center");
  });

  it("keeps the coach inside a phone viewport, safe areas and above the nav", () => {
    const base = {
      viewportWidth: 390,
      viewportHeight: 844,
      cardHeight: 240,
      coachWidth: 348,
      navHeight: 76,
      safeTop: 0,
      safeLeft: 0,
      safeRight: 0,
    };
    const centred = coachPosition({
      ...base,
      rect: { left: 80, top: 260, width: 230, height: 120 },
      placement: "center",
    });
    expect(centred.left).toBe(21);
    expect(centred.top).toBeGreaterThanOrEqual(12);
    expect(centred.top + base.cardHeight).toBeLessThanOrEqual(base.viewportHeight - base.navHeight);

    const above = coachPosition({
      ...base,
      rect: { left: 120, top: 700, width: 150, height: 44 },
      placement: "above",
    });
    expect(above.top).toBe(700 - 14 - 240);

    const safe = coachPosition({
      ...base,
      safeTop: 47,
      safeLeft: 20,
      safeRight: 20,
      rect: { left: 0, top: 100, width: 20, height: 20 },
      placement: "above",
    });
    expect(safe.top).toBe(59);
    expect(safe.left).toBe(32);
  });

  it("shrinks to a 320px phone without crossing its safe edges", () => {
    const position = coachPosition({
      rect: null,
      viewportWidth: 320,
      viewportHeight: 568,
      cardHeight: 260,
      coachWidth: 296,
      navHeight: 76,
      safeTop: 0,
      safeLeft: 0,
      safeRight: 0,
      placement: "center",
    });
    expect(position.left).toBe(12);
    expect(position.left + 296).toBeLessThanOrEqual(320 - 12);
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it("keeps a tall coach on screen in short landscape", () => {
    const position = coachPosition({
      rect: { left: 200, top: 120, width: 100, height: 40 },
      viewportWidth: 568,
      viewportHeight: 320,
      cardHeight: 260,
      coachWidth: 348,
      navHeight: 64,
      safeTop: 0,
      safeLeft: 0,
      safeRight: 0,
      placement: "center",
    });
    expect(position.left).toBe(76);
    expect(position.left + 348).toBeLessThanOrEqual(568 - 12);
    expect(position.top).toBe(12);
    expect(position.top + 260).toBeLessThanOrEqual(320);
  });
});
