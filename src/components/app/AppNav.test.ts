import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppNav from "./AppNav";

describe("AppNav tour targets", () => {
  it("marks the five real tabs for the post-training tour", () => {
    const html = renderToStaticMarkup(createElement(AppNav, { activeId: "lobby" }));
    for (const tab of ["lobby", "decks", "commanders", "progress", "profile"]) {
      expect(html).toContain(`data-tour="nav-${tab}"`);
    }
    expect(html).not.toContain('data-tour="nav-play"');
  });

  it("keeps the active tab and the Friends-to-Profile mapping intact", () => {
    const html = renderToStaticMarkup(createElement(AppNav, { activeId: "friends" }));
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-tour="nav-profile" href="/app/profile"');
  });
});
