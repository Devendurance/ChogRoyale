import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomeSummary from "./HomeSummary";
import type { AccountXpLevelView } from "./account-xp-model";
import type { HomeMetricView } from "./home-summary-model";

const readyLevel: AccountXpLevelView = {
  state: "ready",
  level: 7,
  totalXp: 162,
  currentLevelThreshold: 100,
  nextLevelThreshold: 225,
  xpIntoLevel: 62,
  xpToNext: 63,
  maxLevel: false,
  maxAccountLevel: 100,
  message: null,
};

const unavailableLevel: AccountXpLevelView = {
  state: "unavailable",
  level: null,
  totalXp: null,
  currentLevelThreshold: null,
  nextLevelThreshold: null,
  xpIntoLevel: null,
  xpToNext: null,
  maxLevel: false,
  maxAccountLevel: 100,
  message: "Sign in again to load account progression.",
};

function renderSummary(gold: HomeMetricView, crowns: HomeMetricView, accountLevel: AccountXpLevelView) {
  return renderToStaticMarkup(createElement(HomeSummary, { gold, crowns, accountLevel }));
}

describe("HomeSummary", () => {
  it("renders verified zero balances, earned crowns, current XP, and both destinations", () => {
    const html = renderSummary(
      { state: "ready", value: 0, message: null },
      { state: "ready", value: 0, message: null },
      readyLevel,
    );

    expect(html).toContain("Crowns earned");
    expect(html).toContain("0");
    expect(html).toContain("62 / 125 XP");
    expect(html).toContain("href=\"/app/play\"");
    expect(html).toContain("Earn Gold");
    expect(html).toContain("Gold purchases are unavailable.");
    expect(html).toContain("href=\"/app/progress\"");
    expect(html).toContain("View Progress");
    expect(html).toContain("chog-royale-crown.webp");
  });

  it("keeps auth, setup, and unavailable states without a fake amount or level", () => {
    const html = renderSummary(
      { state: "auth", value: null, message: "Sign in again to load this value." },
      { state: "locked", value: null, message: "Finish profile setup to load this value." },
      unavailableLevel,
    );

    expect(html).toContain("Sign in");
    expect(html).toContain("Setup locked");
    expect(html).toContain("Account level unavailable");
    expect(html).toContain("Finish profile setup to load this value.");
    expect(html).not.toContain("LVL</span><strong>1</strong>");
    expect(html).toContain("<strong>?</strong>");
  });

  it("keeps pending resources and disabled Account XP visibly distinct", () => {
    const disabledLevel: AccountXpLevelView = {
      state: "disabled",
      level: null,
      totalXp: null,
      currentLevelThreshold: null,
      nextLevelThreshold: null,
      xpIntoLevel: null,
      xpToNext: null,
      maxLevel: false,
      maxAccountLevel: 100,
      message: "Account XP is not active yet. Your progression will appear when it opens.",
    };
    const loadingMetric: HomeMetricView = { state: "loading", value: null, message: null };
    const html = renderSummary(loadingMetric, loadingMetric, disabledLevel);

    expect(html).toContain("Loading");
    expect(html).toContain("Account XP paused");
    expect(html).toContain("Account XP is not active yet.");
    expect(html).toContain("<strong>?</strong>");
    expect(html).not.toContain("LVL</span><strong>1</strong>");
  });

  it("renders the max-level crest and full progress bar without requiring level XP", () => {
    const maxLevel: AccountXpLevelView = {
      state: "ready",
      level: 100,
      totalXp: 50000,
      currentLevelThreshold: 50000,
      nextLevelThreshold: null,
      xpIntoLevel: null,
      xpToNext: null,
      maxLevel: true,
      maxAccountLevel: 100,
      message: null,
    };
    const html = renderSummary(
      { state: "ready", value: 25, message: null },
      { state: "ready", value: 14, message: null },
      maxLevel,
    );

    expect(html).toContain("Maximum level");
    expect(html).toContain("50,000 lifetime XP");
    expect(html).toContain("<strong>100</strong>");
    expect(html).toContain("width:100%");
  });
});
