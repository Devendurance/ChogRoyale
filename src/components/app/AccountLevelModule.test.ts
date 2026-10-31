import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountLevelModule from "./AccountLevelModule";
import type { AccountLevelView } from "./profile-types";

const readyAccountLevel: AccountLevelView = {
  state: "ready",
  level: 7,
  totalXp: 925,
  currentLevelThreshold: 800,
  nextLevelThreshold: 1000,
  xpIntoLevel: 125,
  xpToNext: 75,
  maxLevel: false,
  maxAccountLevel: 100,
  message: null,
};

function render(accountLevel: AccountLevelView, presentation: "card" | "content" = "card") {
  return renderToStaticMarkup(createElement(AccountLevelModule, { accountLevel, presentation }));
}

function renderEmbeddedWithoutAction(accountLevel: AccountLevelView) {
  return renderToStaticMarkup(
    createElement(AccountLevelModule, {
      accountLevel,
      presentation: "content",
      showViewProgress: false,
    }),
  );
}

describe("AccountLevelModule presentation boundary", () => {
  it("renders Profile's full account level card by default", () => {
    const html = render(readyAccountLevel);

    expect(html).toContain("app-panel");
    expect(html).toContain("Account Level");
    expect(html).toContain("925");
    expect(html).toContain("Lifetime XP");
    expect(html).toContain("125");
    expect(html).toContain("200");
    expect(html).toContain("1,000");
    expect(html).toContain("Next level target");
    expect(html).toContain('href="/app/progress"');
  });

  it("embeds Progress content without adding another panel frame or heading", () => {
    const html = render(readyAccountLevel, "content");

    expect(html).not.toContain("app-panel");
    expect(html).not.toContain("Account Level");
    expect(html).toContain("Current level");
    expect(html).toContain("Lifetime XP");
    expect(html).toContain("125");
    expect(html).toContain("200");
    expect(html).toContain("Next level target");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('href="/app/progress"');
  });

  it("can omit the self-link when embedded inside Progress", () => {
    const html = renderEmbeddedWithoutAction(readyAccountLevel);

    expect(html).not.toContain('href="/app/progress"');
    expect(html).toContain("Current level");
  });

  it("shows the server-confirmed maximum level without calculating more progress", () => {
    const html = render(
      {
        ...readyAccountLevel,
        level: 100,
        totalXp: 250000,
        currentLevelThreshold: 200000,
        nextLevelThreshold: null,
        xpIntoLevel: null,
        xpToNext: null,
        maxLevel: true,
      },
      "content",
    );

    expect(html).toContain("250,000");
    expect(html).toContain(">MAX</span>");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("Lifetime XP keeps counting after the level cap.");
    expect(html).not.toContain("Next level target");
  });

  it("keeps disabled progression explicit without showing inferred level or XP", () => {
    const html = render(
      {
        ...readyAccountLevel,
        state: "disabled",
        level: null,
        totalXp: null,
        currentLevelThreshold: null,
        nextLevelThreshold: null,
        xpIntoLevel: null,
        xpToNext: null,
        message: "Account XP is disabled on the server.",
      },
      "content",
    );

    expect(html).toContain("Coming soon");
    expect(html).toContain("Account XP is disabled on the server.");
    expect(html).not.toContain("0 XP");
    expect(html).not.toContain("Level 1");
  });
});
