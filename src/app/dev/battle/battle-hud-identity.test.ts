import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BattleHud, { type BattleHudProps } from "./BattleHud";
import { battleIdentity } from "./battle-identity";
import type { StartMessage } from "@/lib/battle-protocol";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("./use-sprite-manifest", () => ({ useSpriteManifest: () => null }));
vi.mock("@/components/site/fonts", () => ({ satoshi: {}, georama: {}, lilitaOne: {} }));

describe("local battle scoreboard", () => {
  it("places self left and opponent right with the correct seat scores for both devices", () => {
    for (const seat of [0, 1] as const) {
      const start = { seat, self: "LocalChog", opponent: "RivalChog", resumed: true, catalog: {}, commander: { class: "scout", kind: "class", name: "Scout" }, patron: { tokenId: "1", theme: "test" } } as unknown as StartMessage;
      const identity = battleIdentity(start, null);
      const props = { start, me: identity.selfSeat, playerName: identity.self, frame: null, end: { result: "draw", reason: "timeout", crowns: [2, 1] }, abort: null, settlement: null, acks: [], showDevDiagnostics: false, feed: { current: null }, mapRef: { current: null }, audioMuted: true, audioVolume: 0 } as unknown as BattleHudProps;
      const html = renderToStaticMarkup(React.createElement(BattleHud, props));
      const header = html.slice(html.indexOf('class="chud-score"'), html.indexOf('class="chud-subrow"'));
      expect(header.indexOf('data-side="you"')).toBeLessThan(header.indexOf('data-side="foe"'));
      const mine = header.slice(header.indexOf('data-side="you"'), header.indexOf('class="chud-clock2"'));
      const foe = header.slice(header.indexOf('data-side="foe"'));
      expect(mine).toContain("LocalChog");
      expect(mine).toContain(`/> ${seat === 0 ? 2 : 1}</span>`);
      expect(foe).toContain("RivalChog");
      expect(foe).toContain(`${seat === 0 ? 1 : 2} <img`);
    }
  });
});
