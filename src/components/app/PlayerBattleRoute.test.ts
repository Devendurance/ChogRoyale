import { describe, expect, it } from "vitest";
import { resolvePlayerBattleMode } from "./player-battle-route-model";

describe("player battle route mode recognition", () => {
  it("recognizes practice as its own player-facing mode", () => {
    expect(resolvePlayerBattleMode("practice")).toBe("practice");
  });

  it("preserves private, ranked and unranked mode mapping", () => {
    expect(resolvePlayerBattleMode("private")).toBe("private");
    expect(resolvePlayerBattleMode("ranked")).toBe("ranked");
    expect(resolvePlayerBattleMode("unranked")).toBe("unranked");
  });

  it("fails closed to unranked for unknown or missing modes", () => {
    expect(resolvePlayerBattleMode("unknown")).toBe("unranked");
    expect(resolvePlayerBattleMode(null)).toBe("unranked");
  });
});
