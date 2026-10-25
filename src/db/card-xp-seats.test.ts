// P7.1 regression: reversed database row order must never reverse XP
// ownership. Pure: exercises the seat-order mapping and the deployment
// counter without any database.
import { describe, expect, it } from "vitest";
import { seatOrderedPlayers } from "@/db/card-xp";
import { countDeployments } from "@/server/battle/card-xp";

const SEAT0 = "aaaaaaaa-0000-4000-8000-000000000001";
const SEAT1 = "bbbbbbbb-0000-4000-8000-000000000002";

describe("P7.1 XP seat attribution", () => {
  it("maps reversed rows back to seat order", () => {
    const r = seatOrderedPlayers([
      { seat: 1, playerId: SEAT1 },
      { seat: 0, playerId: SEAT0 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.players[0]!.playerId).toBe(SEAT0);
    expect(r.players[1]!.playerId).toBe(SEAT1);
  });

  it("fails closed on missing, duplicated, or non-distinct seats", () => {
    expect(seatOrderedPlayers([{ seat: 0, playerId: SEAT0 }]).ok).toBe(false);
    expect(
      seatOrderedPlayers([
        { seat: 0, playerId: SEAT0 },
        { seat: 0, playerId: SEAT1 },
      ]).ok
    ).toBe(false);
    expect(
      seatOrderedPlayers([
        { seat: 0, playerId: SEAT0 },
        { seat: 1, playerId: SEAT0 },
      ]).ok
    ).toBe(false);
  });

  it("attributes all seat-1 deployments to the seat-1 player", () => {
    const ordered = seatOrderedPlayers([
      { seat: 1, playerId: SEAT1 },
      { seat: 0, playerId: SEAT0 },
    ]);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    const units = countDeployments(
      Array.from({ length: 4 }, (_, i) => ({ seq: i, player: 1, cardId: "choglings" })) as never,
      new Set(),
      ordered.players
    );
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) expect(u.playerId).toBe(SEAT1);
    expect(units.reduce((n, u) => n + u.xp, 0)).toBe(4);
  });
});
