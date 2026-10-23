// Server-side play guide data (A4.4).
//
// Every number, class name, ability name and Chaos family is read from the
// live ruleset tables. Nothing here is a second combat model: it is a plain
// projection for the guide view.

import {
  ABILITY_ACTIVATION_COST_V1,
  ARENA_V2,
  CARDS_V1,
  COMBAT_TIMELINE_V1,
  ENERGY_V1,
  STRUCTURE_V1,
  TICKS_PER_SECOND,
} from "@/lib/combat";
import { CHAOS_BOUNDS_V1, CHAOS_FAMILIES, CHAOS_TIMELINE_V1, type ChaosFamily } from "@/lib/chaos";
import { CLASS_ROSTER, COMMANDER_CLASSES } from "@/lib/commanders";
import type { PlayGuideData, GuideChaosFamily } from "@/components/app/play-guide-types";

const FAMILY_COPY: Record<ChaosFamily, { name: string; effect: string }> = {
  ember_rift: {
    name: "Ember Rift",
    effect: "Telegraphed damage zones. Units caught inside take damage for the pulse duration.",
  },
  frost_crossing: {
    name: "Frost Crossing",
    effect: "Movement-speed zones. Units inside move faster or slower for the pulse duration.",
  },
  energy_surge: {
    name: "Energy Surge",
    effect: "Energy regeneration rises for both players for the pulse duration.",
  },
  rift_shift: {
    name: "Rift Shift",
    effect: "The central Rift Ford opens. The named crossing is slowed or hasted for the pulse duration.",
  },
  chaos_rally: {
    name: "Chaos Rally",
    effect: "Both sides' units gain an attack or defense buff for the pulse duration.",
  },
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function secondsFromTicks(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

export function buildPlayGuideData(): PlayGuideData {
  const families: GuideChaosFamily[] = CHAOS_FAMILIES.map((id) => ({
    id,
    name: FAMILY_COPY[id].name,
    effect: FAMILY_COPY[id].effect,
  }));

  const abilities = COMMANDER_CLASSES.flatMap((classId) => {
    const profile = CLASS_ROSTER[classId];
    const active = profile.abilities.find((ability) => ability.trigger === "active");
    if (!active) return [];
    return [
      {
        classId,
        className: titleCase(classId),
        role: profile.role,
        ability: active.name,
        cost: ABILITY_ACTIVATION_COST_V1[active.id] ?? null,
        cooldownSeconds: active.cooldownMs ? Math.round(active.cooldownMs / 1000) : null,
      },
    ];
  });

  return {
    arena: {
      towersPerSide: ARENA_V2.towers.filter((tower) => tower.owner === 0).length,
      coresPerSide: ARENA_V2.cores.filter((core) => core.owner === 0).length,
      towerHp: STRUCTURE_V1.tower.hp,
      coreHp: STRUCTURE_V1.core.hp,
      towerDamage: STRUCTURE_V1.tower.damage,
      coreDamage: STRUCTURE_V1.core.damage,
      attackIntervalSeconds: secondsFromTicks(STRUCTURE_V1.tower.intervalTicks),
      towerRange: STRUCTURE_V1.tower.range,
      coreRange: STRUCTURE_V1.core.range,
      bridges: ARENA_V2.bridges.length,
      pocketDepth: ARENA_V2.pocketDepth,
    },
    timeline: {
      regulationSeconds: secondsFromTicks(COMBAT_TIMELINE_V1.durationTicks),
      overtimeSeconds: secondsFromTicks(COMBAT_TIMELINE_V1.overtimeTicks),
      maxSeconds: secondsFromTicks(COMBAT_TIMELINE_V1.durationTicks + COMBAT_TIMELINE_V1.overtimeTicks),
      doubleEnergyAtSeconds: secondsFromTicks(COMBAT_TIMELINE_V1.doubleEnergyTick),
      tripleEnergyAtSeconds: secondsFromTicks(COMBAT_TIMELINE_V1.tripleEnergyTick),
    },
    energy: {
      start: ENERGY_V1.start,
      max: ENERGY_V1.max,
      secondsPerPoint: secondsFromTicks(ENERGY_V1.regenTicksPerPoint),
    },
    deck: {
      ordinaryCards: 7,
      commanderCards: 1,
      commanderClasses: COMMANDER_CLASSES.length,
      handSize: 4,
      cardCount: Object.keys(CARDS_V1).length,
    },
    crowns: {
      perTower: 1,
      coreWin: 3,
    },
    chaos: {
      pulseTimesSeconds: CHAOS_TIMELINE_V1.pulseAtMs.map((ms) => ms / 1000),
      warnMinSeconds: CHAOS_BOUNDS_V1.telegraphMs.min / 1000,
      warnMaxSeconds:
        Math.min(CHAOS_BOUNDS_V1.telegraphMs.max, CHAOS_TIMELINE_V1.warnMs) / 1000,
      families,
    },
    abilities,
    modes: [
      {
        id: "private",
        name: "Private room",
        tag: "By code",
        summary: "Create a room and share the room code with your opponent.",
        detail: "Private matches use the same rules and clock. They do not count toward the Casual Alpha Leaderboard.",
      },
      {
        id: "matchmaking",
        name: "Unranked matchmaking",
        tag: "Unranked",
        summary: "Join the queue and the server pairs you with another player.",
        detail: "Matchmaking is unranked. There is no ranked ladder in this alpha.",
      },
    ],
  };
}
