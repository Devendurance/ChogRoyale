import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LobbyMessage } from "@/lib/battle-protocol";
import BattleLobby from "./BattleLobby";

vi.mock("./use-sprite-manifest", () => ({ useSpriteManifest: () => null }));

const catalog: LobbyMessage["catalog"] = Array.from({ length: 7 }, (_, index) => ({
  id: `card-${index}`, name: `Card ${index + 1}`, cost: index % 5 + 1,
  kind: "troop", air: false, radius: 0, description: `Authoritative card ${index + 1} description`,
}));
const lobby: LobbyMessage = {
  phase: "waiting", you: 0, locked: false,
  players: [{ username: "ChogOne", ready: false }, { username: "ChogTwo", ready: true }],
  catalog, presets: { balanced: { cards: catalog.map((card) => card.id), commanderClass: "scout" } }, mine: null,
};
const mine: NonNullable<LobbyMessage["mine"]> = {
  cards: catalog.map((card) => card.id),
  commander: { kind: "nft", commanderId: "private-commander-id", cardId: "private-card-id", class: "reaver", variant: "base", prestige: "standard", name: "Genesis Commander", tokenId: "9191919", imageOriginal: "ipfs://private-original", rulesetVersion: "test", derivationHash: "private-derivation-hash", basis: "direct-owner", verifiedAt: null },
};
function render(override: Partial<LobbyMessage> = {}) {
  return renderToStaticMarkup(React.createElement(BattleLobby, {
    lobby: { ...lobby, ...override }, roomCode: "ROOM42", now: 100_000,
    getAccessToken: async () => null, onConfirm: () => {}, onEdit: () => {},
  }));
}

describe("production battle ready room", () => {
  it("stages seven ordinary portraits and one distinct commander with a real ready action", () => {
    const html = render();
    expect(html.match(/class="lp-card"/g)).toHaveLength(7);
    expect(html).toContain("Scout class art");
    expect(html).toContain("7/7 cards");
    expect(html).toContain("Ready for Battle");
    expect(html).toContain("Loading account deck");
    expect(html).not.toContain("Saved to your account");
  });
  it("keeps readiness separate from the advisory selection and labels the private room", () => {
    const html = render();
    expect(html).toContain("Private battle");
    expect(html).toContain("ROOM42");
    expect(html).toContain("Not ready");
    expect(html).not.toContain("You&#x27;re Ready");
  });
  it("preserves all seven portraits after server confirmation without exposing identity evidence", () => {
    const html = render({ mine });
    expect(html.match(/class="lp-card"/g)).toHaveLength(7);
    expect(html).toContain("Reaver class art");
    expect(html).toContain("You&#x27;re Ready");
    expect(html).toContain("Edit Loadout");
    for (const secret of ["9191919", "private-commander-id", "private-card-id", "private-original", "private-derivation-hash"]) expect(html).not.toContain(secret);
    expect(html).not.toContain("Ready for Battle");
  });
  it("removes the edit action once the server locks loadouts", () => {
    const html = render({ mine, locked: true });
    expect(html).toContain("Preparing your battle");
    expect(html).toContain("Both players are ready");
    expect(html).not.toContain("Edit Loadout");
  });
  it("waits for the server start when both player readiness flags are confirmed", () => {
    const html = render({ mine, players: [{ username: "ChogOne", ready: true }, { username: "ChogTwo", ready: true }] });
    expect(html).toContain("Both players are ready. Waiting for the server to start the battle.");
    expect(html).not.toContain("Waiting for the other player");
  });
  it("uses the server match deadline and never exposes a private code for matchmaking", () => {
    const html = render({ match: { opponent: "ChogTwo", deadlineAt: 112_000, mode: "matchmaking" } });
    expect(html).toContain("12s to ready up");
    expect(html).toContain("Opponent found");
    expect(html).not.toContain("ROOM42");
    expect(html).not.toContain("Share your room code");
  });
  it("disables readiness for an incomplete deck and preserves empty slots", () => {
    const html = render({ presets: {} });
    expect(html.match(/lp-card--empty/g)).toHaveLength(7);
    expect(html).toContain("Choose 7 more cards");
    expect(html).toMatch(/<button[^>]*class="lp-button lp-button--ready"[^>]*disabled=""/);
  });
  it("maps the player's seat rather than assuming the first slot belongs to them", () => {
    const html = render({ you: 1, players: [{ username: "OtherChog", ready: false }, { username: "MyChog", ready: true }] });
    expect(html).toMatch(/battle-lobby-player--ready[^]*?<span>You<\/span><strong>MyChog<\/strong><small>Ready<\/small>/);
    expect(html).toContain("OtherChog");
  });
});
