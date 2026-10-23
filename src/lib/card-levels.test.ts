// P2c scaling policy: pure mapping, formula and rounding. No engine, DB or
// server involved. TEST provisional numbers.
import { describe, it, expect } from "vitest";
import { CARDS_V1, TROOP_CARDS_V1, SPELL_CARDS_V1, BUILDING_CARDS_V1 } from "@/lib/combat";
import {
  CARD_LEVEL_PROFILES,
  HP_SCALE_PCT,
  buildingStatsFor,
  clampCardLevel,
  levelFor,
  scaledStat,
  shellDamageFor,
  spellMagnitudeFor,
  troopStatsFor,
} from "./card-levels";

describe("P2c card-to-profile mapping", () => {
  it("maps exactly the 20 ordinary cards, one profile each", () => {
    expect(new Set(Object.keys(CARD_LEVEL_PROFILES))).toEqual(new Set(Object.keys(CARDS_V1)));
    for (const [id, profile] of Object.entries(CARD_LEVEL_PROFILES)) {
      expect(["tank-hp", "damage", "buff"], `profile for ${id}`).toContain(profile);
    }
  });

  it("pins everything the policy does not scale", () => {
    // Speed never scales (integer cells/tick: +1%/level never crosses an
    // integer within 10 levels), ranges/costs/cadences are untouched by
    // construction: the helpers only return hp/damage/buff/impact numbers.
    expect(Object.keys(troopStatsFor("rift_runner", { hp: 70, damage: 14 }, 10)).sort()).toEqual(["damage", "hp"]);
    expect(Object.keys(buildingStatsFor("rift_sentry", { hp: 320, damage: 16 }, 10)).sort()).toEqual(["damage", "hp"]);
    const m = spellMagnitudeFor("chaos_comet", { damage: 140, buffPct: 0, unitDamage: 140, buildingDamage: 140, structureDamage: 42 }, 10);
    expect(Object.keys(m).sort()).toEqual(["buffPct", "buildingDamage", "damage", "structureDamage", "unitDamage"]);
  });
});

describe("P2c scaling formula", () => {
  it("is identity at Level 1 and invalid levels", () => {
    for (const [id, def] of Object.entries(TROOP_CARDS_V1)) {
      expect(troopStatsFor(id, def, 1)).toEqual({ hp: def.hp, damage: def.damage });
      expect(troopStatsFor(id, def, 0)).toEqual({ hp: def.hp, damage: def.damage });
      expect(troopStatsFor(id, def, 11)).toEqual({ hp: def.hp, damage: def.damage });
    }
    expect(scaledStat(100, HP_SCALE_PCT, 1)).toBe(100);
    expect(clampCardLevel(0)).toBe(1);
    expect(clampCardLevel(11)).toBe(1);
    expect(clampCardLevel(2.5)).toBe(1);
    expect(clampCardLevel("7")).toBe(1);
    expect(clampCardLevel(null)).toBe(1);
    expect(clampCardLevel(undefined)).toBe(1);
    expect(clampCardLevel(10)).toBe(10);
  });

  it("scales tanks +4% HP and only HP", () => {
    // Boulderback 400 -> L5: 400*1.16=464; L10: 400*1.36=544.
    expect(troopStatsFor("boulderback", TROOP_CARDS_V1.boulderback!, 5)).toEqual({ hp: 464, damage: 40 });
    expect(troopStatsFor("boulderback", TROOP_CARDS_V1.boulderback!, 10)).toEqual({ hp: 544, damage: 40 });
    // Frostshell slow control untouched, HP scales: 250 -> L10 340.
    expect(troopStatsFor("frostshell", TROOP_CARDS_V1.frostshell!, 10)).toEqual({ hp: 340, damage: 20 });
    // Decoy totem (damage 0 wall): 260 -> L10 354 (353.6 rounds up).
    expect(buildingStatsFor("decoy_totem", BUILDING_CARDS_V1.decoy_totem!, 10)).toEqual({ hp: 354, damage: 0 });
    // Burrow spawner body scales, spawn waves do not.
    expect(buildingStatsFor("chog_burrow", BUILDING_CARDS_V1.chog_burrow!, 10).hp).toBe(408);
  });

  it("scales attackers +3% damage and only damage", () => {
    // Archer 15 -> L5: 15*1.12=16.8 -> 17; L10: 15*1.27=19.05 -> 19.
    expect(troopStatsFor("chaos_archer", TROOP_CARDS_V1.chaos_archer!, 5)).toEqual({ hp: 50, damage: 17 });
    expect(troopStatsFor("chaos_archer", TROOP_CARDS_V1.chaos_archer!, 10)).toEqual({ hp: 50, damage: 19 });
    // Choglings swarm: HP pinned, damage 12 -> L10 15 (15.24 -> 15).
    expect(troopStatsFor("choglings", TROOP_CARDS_V1.choglings!, 10)).toEqual({ hp: 60, damage: 15 });
    // Sentry turret role is damage: 16 -> L10 20 (20.32 -> 20).
    expect(buildingStatsFor("rift_sentry", BUILDING_CARDS_V1.rift_sentry!, 10)).toEqual({ hp: 320, damage: 20 });
  });

  it("scales spell damage numbers and the horn buff, never radii or slows", () => {
    const bolt = SPELL_CARDS_V1.chaos_bolt!;
    expect(spellMagnitudeFor("chaos_bolt", { damage: bolt.damage, buffPct: 0, unitDamage: 0, buildingDamage: 0, structureDamage: 0 }, 10).damage).toBe(152);
    const comet = spellMagnitudeFor("chaos_comet", { damage: 140, buffPct: 0, unitDamage: 140, buildingDamage: 140, structureDamage: 42 }, 10);
    expect(comet).toMatchObject({ unitDamage: 178, buildingDamage: 178, structureDamage: 53 });
    // Snare damage scales, slow percentage stays pinned.
    const snare = spellMagnitudeFor("rift_snare", { damage: 25, buffPct: 0, unitDamage: 25, buildingDamage: 0, structureDamage: 0 }, 10);
    expect(snare.unitDamage).toBe(32);
    // Horn buff magnitude: 40 -> L10 51 (50.8 rounds up).
    expect(spellMagnitudeFor("rally_horn", { damage: 0, buffPct: 40, unitDamage: 0, buildingDamage: 0, structureDamage: 0 }, 10).buffPct).toBe(51);
  });

  it("scales mortar shells as the card's damage", () => {
    const shell = shellDamageFor("rift_mortar", { unitDamage: 40, buildingDamage: 40, structureDamage: 30 }, 10);
    expect(shell).toEqual({ unitDamage: 51, buildingDamage: 51, structureDamage: 38 });
  });

  it("resolves unknown and commander ids to baseline", () => {
    expect(troopStatsFor("cmdr:free-scout", { hp: 1, damage: 1 }, 10)).toEqual({ hp: 1, damage: 1 });
    expect(buildingStatsFor("nope", { hp: 9, damage: 9 }, 10)).toEqual({ hp: 9, damage: 9 });
    expect(levelFor(undefined, 0, "choglings")).toBe(1);
    expect(levelFor([{}, {}], 1, "choglings")).toBe(1);
    expect(levelFor([{ choglings: 10 }, {}], 0, "choglings")).toBe(10);
    expect(levelFor([{ choglings: 99 }, {}], 0, "choglings")).toBe(1);
  });
});
