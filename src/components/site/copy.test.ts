// Focused A4.5 tests for the public site's game-entry links. Every action that
// enters the game must land in the authenticated shell, while the battle
// surface stays behind the lobby action and its existing gate.

import { describe, it, expect } from "vitest";
import { BENTO, CTA, FOOTER, PLAY } from "./copy";

describe("public game entry links", () => {
  it("sends the header, hero and shared Play action to /app", () => {
    expect(PLAY.href).toBe("/app");
  });

  it("sends the closing primary action to /app", () => {
    expect(CTA.primary.href).toBe("/app");
  });

  it("sends the footer play link to /app", () => {
    expect(FOOTER.playLink.href).toBe("/app");
  });

  it("sends the battle tile to /app without touching the in-page link", () => {
    const battle = BENTO.tiles.find((tile) => tile.id === "battle");
    expect(battle?.link?.href).toBe("/app");
  });

  it("does not use the battle development route as a public entry", () => {
    const battle = BENTO.tiles.find((tile) => tile.id === "battle");
    const entries = [PLAY.href, CTA.primary.href, FOOTER.playLink.href, battle?.link?.href];
    expect(entries).not.toContain("/dev/battle");
  });

  it("leaves the informational bento anchors alone", () => {
    expect(BENTO.tiles.find((tile) => tile.id === "deck")?.link?.href).toBe("#cards");
    expect(BENTO.tiles.find((tile) => tile.id === "patron")?.link?.href).toBe("#arena");
  });
});
