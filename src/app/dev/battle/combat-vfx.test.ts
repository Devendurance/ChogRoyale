import { describe, expect, it } from "vitest";
import { chaosFamilyColor, combatEventKey } from "./combat-vfx";

describe("combat VFX event identity", () => {
  it("deduplicates the same authoritative event across refreshed snapshots", () => {
    const event = { type: "structure_destroyed", tick: 1416, entityId: "s-p1-tower-30", owner: 1 };
    expect(combatEventKey(event)).toBe(combatEventKey({ ...event }));
    expect(combatEventKey(event)).not.toBe(combatEventKey({ ...event, tick: 1417 }));
    expect(combatEventKey(event)).not.toBe(combatEventKey({ ...event, entityId: "s-p1-core" }));
  });

  it("keeps separate same-tick spell impacts distinct", () => {
    const base = { type: "spell_impact", tick: 200, cardId: "chaos_comet", x: 30, y: 70, impactId: "i-a" };
    expect(combatEventKey(base)).not.toBe(combatEventKey({ ...base, impactId: "i-b" }));
  });
});

describe("Chaos feedback palette", () => {
  it("uses authored family colors and a readable fallback", () => {
    expect(chaosFamilyColor("ember_rift")).toBe(0xf97316);
    expect(chaosFamilyColor("frost_crossing")).toBe(0x67e8f9);
    expect(chaosFamilyColor("unknown-family")).toBe(0xffffff);
  });
});
