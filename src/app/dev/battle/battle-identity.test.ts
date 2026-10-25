import { describe, expect, it } from "vitest";
import type { EndMessage, LobbyMessage, Seat, StartMessage } from "@/lib/battle-protocol";
import { battleIdentity } from "./battle-identity";
import { scoreView } from "./hud-view";
import { finaleView } from "./battle-result-model";
import { structureTeamFor } from "./arena-registry";

// The live failure: Endychog created the room (join slot 0) and phantom
// joined (slot 1), then the server's seat shuffle put Endychog on seat 1.
const JOIN_ORDER = ["Endychog", "phantom"] as const;
const SEAT_OF_SLOT: [Seat, Seat] = [1, 0];

const startFor = (slot: 0 | 1, withSelf = true): StartMessage =>
  ({ seat: SEAT_OF_SLOT[slot], opponent: JOIN_ORDER[1 - slot], ...(withSelf ? { self: JOIN_ORDER[slot] } : {}) }) as StartMessage;
const lobbyFor = (slot: 0 | 1, players: readonly string[] = JOIN_ORDER): LobbyMessage =>
  ({ phase: "waiting", you: slot, players: players.map((username) => ({ username, ready: true })) }) as LobbyMessage;

describe("battle identity", () => {
  it("shows each player their own name and the opponent's on both devices", () => {
    for (const withSelf of [true, false]) {
      const endy = battleIdentity(startFor(0, withSelf), lobbyFor(0));
      const phantom = battleIdentity(startFor(1, withSelf), lobbyFor(1));
      expect([endy.self, endy.opponent]).toEqual(["Endychog", "phantom"]);
      expect([phantom.self, phantom.opponent]).toEqual(["phantom", "Endychog"]);
    }
  });

  it("never reads the lobby by battle seat (the original bug)", () => {
    const start = startFor(0, false);
    const lobby = lobbyFor(0);
    expect(lobby.players[start.seat]!.username).toBe("phantom");
    expect(battleIdentity(start, lobby).self).toBe("Endychog");
  });

  it("prefers the server's own username over any lobby copy", () => {
    expect(battleIdentity(startFor(1), lobbyFor(1, ["someone", "else"])).self).toBe("phantom");
  });

  it("stays honest when the name is unknown or the lobby belongs to another match", () => {
    expect(battleIdentity(startFor(0, false), null).self).toBeNull();
    expect(battleIdentity(startFor(0, false), lobbyFor(0, ["Endychog", "old-rival"])).self).toBeNull();
  });

  it("maps seats, crowns, towers and the result from each local perspective", () => {
    // phantom (seat 0) breaks one tower, Endychog (seat 1) breaks the Core.
    const crowns: [number, number] = [1, 3];
    for (const slot of [0, 1] as const) {
      const id = battleIdentity(startFor(slot), lobbyFor(slot));
      const winner = id.self === "Endychog";
      const end = { result: winner ? "win" : "loss", reason: "core", crowns, ticks: 1200 } as EndMessage;
      expect(id.opponentSeat).toBe(1 - id.selfSeat);
      expect(scoreView(null, end, id.selfSeat)).toEqual(winner ? { mine: 3, theirs: 1 } : { mine: 1, theirs: 3 });
      expect(structureTeamFor(id.selfSeat, id.selfSeat)).toBe("friendly");
      expect(structureTeamFor(id.opponentSeat, id.selfSeat)).toBe("opponent");
      const view = finaleView(end, null, id.selfSeat, null, 10);
      expect(view.title).toBe(winner ? "Victory" : "Defeat");
      expect(view.winner).toBe(winner ? "mine" : "theirs");
      expect([view.mine, view.theirs]).toEqual(winner ? [3, 1] : [1, 3]);
    }
  });
});
