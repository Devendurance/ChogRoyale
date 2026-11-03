import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { SPAWNED_TROOPS_V1, TROOP_CARDS_V1 } from "@/lib/combat";
import { anchorOffset, type UnitAnimManifest } from "./unit-anim";
import { BUILDING_SIZE_MULT, SCALE_CLAMP, SIZE_CLASS_TARGET, UNIT_SIZE_CLASS, hpBarWidth, sizeClassOf, unitDrawScale, unitDrawnHeight, unitSizeMult } from "./unit-scale";

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/assets/chog-units/v001/manifests/units.runtime.json"), "utf8")
) as UnitAnimManifest;
const units = Object.values(manifest.units);
const drawn = (id: string) => unitDrawnHeight(manifest.units[id]!);

describe("unit size-class policy", () => {
  it("assigns every units-manifest entity a size class", () => {
    for (const u of units) expect(sizeClassOf(u), u.entityId).not.toBeNull();
  });

  it("orders drawn heights swarm < regular < heavy < titan", () => {
    const max = (ids: string[]) => Math.max(...ids.map(drawn));
    const min = (ids: string[]) => Math.min(...ids.map(drawn));
    const of = (cls: string) => Object.entries(UNIT_SIZE_CLASS).filter(([, c]) => c === cls).map(([id]) => id);
    expect(max(of("swarm"))).toBeLessThan(min(of("regular")));
    expect(max(of("regular"))).toBeLessThan(min(of("heavy")));
    expect(max(of("heavy"))).toBeLessThan(min(of("titan")));
    expect(max(of("flying_swarm"))).toBeLessThan(min(of("flying")));
  });

  it("scales buildings by one flat multiplier", () => {
    for (const u of units.filter((x) => x.kind === "building")) {
      expect(unitSizeMult(u)).toBe(BUILDING_SIZE_MULT);
      expect(unitDrawScale(u)).toBeCloseTo(u.displayScale * BUILDING_SIZE_MULT, 9);
    }
  });

  it("clamps the multiplier and lands every actor on its class target", () => {
    for (const u of units) {
      const cls = sizeClassOf(u)!;
      const m = unitSizeMult(u);
      expect(m).toBeGreaterThanOrEqual(SCALE_CLAMP[0]);
      expect(m).toBeLessThanOrEqual(SCALE_CLAMP[1]);
      if (cls !== "building") expect(unitDrawnHeight(u)).toBeCloseTo(SIZE_CLASS_TARGET[cls], 5);
    }
  });

  it("matches class assignments to the ruleset", () => {
    const troops = Object.values(TROOP_CARDS_V1);
    const maxHp = Math.max(...troops.map((t) => t.hp));
    for (const [id, cls] of Object.entries(UNIT_SIZE_CLASS)) {
      const t = TROOP_CARDS_V1[id] ?? SPAWNED_TROOPS_V1[id]!;
      expect(t, id).toBeDefined();
      if (cls === "titan") expect(t.hp).toBe(maxHp);
      if (cls === "swarm") expect(t.count >= 3 || id in SPAWNED_TROOPS_V1).toBe(true);
      if (cls === "flying_swarm") expect(t.count).toBeGreaterThanOrEqual(2);
      if (cls === "flying" || cls === "flying_swarm") expect(t.moveType).toBe("air");
      else expect(t.moveType).toBe("ground");
      if (cls === "heavy") expect(t.hp).toBeGreaterThanOrEqual(200);
      if (cls === "regular") expect(t.hp).toBeLessThan(200);
    }
    // The only troop at the max HP is the titan.
    expect(troops.filter((t) => t.hp === maxHp).map((t) => t.id)).toEqual(["boulderback"]);
    // Every ruleset troop with a sheet has a class.
    for (const t of troops) if (manifest.units[t.id]) expect(UNIT_SIZE_CLASS[t.id], t.id).toBeDefined();
  });

  it("scales sheet anchors with the drawn scale so effects stay on the art", () => {
    for (const u of units) {
      const a = u.anchors?.muzzle?.front?.idle ?? u.anchors?.tip?.front?.idle;
      if (!a) continue;
      const name = u.anchors?.muzzle ? "muzzle" : "tip";
      const off = anchorOffset(u, name, "front", "idle", false)!;
      expect(off.x).toBeCloseTo((a[0] - u.pivot[0]) * unitDrawScale(u), 6);
      expect(off.y).toBeCloseTo((a[1] - u.pivot[1]) * unitDrawScale(u), 6);
    }
  });

  it("widens HP bars with mass", () => {
    expect(hpBarWidth("swarm", 38)).toBeLessThan(hpBarWidth("regular", 50));
    expect(hpBarWidth("regular", 50)).toBeLessThan(hpBarWidth("heavy", 62));
    expect(hpBarWidth("heavy", 62)).toBeLessThan(hpBarWidth("titan", 74));
  });
});
