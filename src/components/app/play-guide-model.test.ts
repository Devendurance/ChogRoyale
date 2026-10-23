// Focused tests for the A4.4 play guide data and formatting. The guide must
// never carry a hand-written rule when the ruleset already exports it.

import { describe, it, expect } from "vitest";
import { buildPlayGuideData } from "./play-guide-data";
import {
  formatClock,
  formatCooldown,
  formatSecondsPerPoint,
  groupGuideCards,
} from "./play-guide-model";
import type { LobbyCatalogCard } from "./lobby-types";

const CARD = (id: string, name: string, cost: number, kind: LobbyCatalogCard["kind"]): LobbyCatalogCard => ({
  id,
  name,
  cost,
  kind,
  typeLabel: kind === "troop" ? "Troop" : kind === "spell" ? "Spell" : "Building",
  traits: [],
  description: `${name} description`,
  stats: [],
  art: null,
});

describe("buildPlayGuideData", () => {
  const guide = buildPlayGuideData();

  it("reads the real match clock", () => {
    expect(guide.timeline).toEqual({
      regulationSeconds: 180,
      overtimeSeconds: 120,
      maxSeconds: 300,
      doubleEnergyAtSeconds: 120,
      tripleEnergyAtSeconds: 240,
    });
  });

  it("reads the real energy economy", () => {
    expect(guide.energy).toEqual({ start: 5, max: 10, secondsPerPoint: 2.8 });
  });

  it("reads the real arena structure counts and stats", () => {
    expect(guide.arena).toMatchObject({
      towersPerSide: 2,
      coresPerSide: 1,
      towerHp: 600,
      coreHp: 1000,
      towerDamage: 25,
      coreDamage: 30,
      attackIntervalSeconds: 1,
      towerRange: 25,
      coreRange: 28,
      bridges: 2,
      pocketDepth: 20,
    });
  });

  it("reads the real deck and crown contract", () => {
    expect(guide.deck).toMatchObject({
      ordinaryCards: 7,
      commanderCards: 1,
      commanderClasses: 5,
      handSize: 4,
      cardCount: 20,
    });
    expect(guide.crowns).toEqual({ perTower: 1, coreWin: 3 });
  });

  it("reads the real Chaos schedule, warning window and families", () => {
    expect(guide.chaos.pulseTimesSeconds).toEqual([45, 90, 135]);
    expect(guide.chaos.warnMinSeconds).toBe(3);
    expect(guide.chaos.warnMaxSeconds).toBe(5);
    expect(guide.chaos.families.map((family) => family.name)).toEqual([
      "Ember Rift",
      "Frost Crossing",
      "Energy Surge",
      "Rift Shift",
      "Chaos Rally",
    ]);
    for (const family of guide.chaos.families) {
      expect(family.effect.length).toBeGreaterThan(20);
    }
  });

  it("reads one active ability per real commander class", () => {
    expect(guide.abilities.map((ability) => ability.className)).toEqual([
      "Bulwark",
      "Reaver",
      "Deadeye",
      "Scout",
      "Warden",
    ]);
    expect(guide.abilities.map((ability) => ability.cost)).toEqual([1, 1, 2, 1, 2]);
    expect(guide.abilities.every((ability) => ability.ability.length > 0)).toBe(true);
    expect(guide.abilities.every((ability) => ability.cooldownSeconds !== null)).toBe(true);
  });

  it("names only the supported unranked modes", () => {
    expect(guide.modes.map((mode) => mode.name)).toEqual(["Private room", "Unranked matchmaking"]);
    expect(guide.modes[1].detail).toContain("no ranked ladder");
  });
});

describe("formatClock", () => {
  it("formats the guide clock as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(45)).toBe("0:45");
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(300)).toBe("5:00");
  });

  it("degrades an unreadable clock instead of throwing", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatSecondsPerPoint and formatCooldown", () => {
  it("keeps the 2.8s energy cadence and drops a trailing zero", () => {
    expect(formatSecondsPerPoint(2.8)).toBe("2.8s");
    expect(formatSecondsPerPoint(3)).toBe("3s");
    expect(formatSecondsPerPoint(Number.NaN)).toBe("unavailable");
  });

  it("formats a real cooldown and a missing one differently", () => {
    expect(formatCooldown(22)).toBe("22s cooldown");
    expect(formatCooldown(null)).toBe("Not listed");
  });
});

describe("groupGuideCards", () => {
  it("groups and sorts the real card roster by cost and name", () => {
    const groups = groupGuideCards([
      CARD("b", "Zeta", 4, "troop"),
      CARD("a", "Alpha", 2, "troop"),
      CARD("s", "Spell", 3, "spell"),
      CARD("c", "Beta", 2, "troop"),
      CARD("x", "Building", 5, "building"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Troops", "Spells", "Buildings"]);
    expect(groups[0].cards.map((card) => card.name)).toEqual(["Alpha", "Beta", "Zeta"]);
    expect(groups[1].cards.map((card) => card.name)).toEqual(["Spell"]);
    expect(groups[2].cards.map((card) => card.name)).toEqual(["Building"]);
  });

  it("drops empty groups", () => {
    expect(groupGuideCards([CARD("s", "Spell", 3, "spell")]).map((group) => group.label)).toEqual(["Spells"]);
  });
});
