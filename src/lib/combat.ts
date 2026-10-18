// Deterministic 1v1 combat simulation (B2.1 foundation + B2.2 roster +
// B2.3 commander & Chaos execution, ruleset v1).
//
// Server-authoritative, headless, pure: no DB, no network, no wall clock,
// no Math.random. Fixed 10 ticks/second, integer time and positions,
// simultaneous damage application, stable entity IDs and processing order.
// Identical (config, seed, commands) always yields identical results.
//
// B2.3 scope: commanders fight with real B1.3 abilities (v7: actives fire
// only from player AbilityCommands in the replayed command stream) and
// B1.4b Chaos schedules execute telegraphed battlefield events.
// Commander entitlement is a TRUSTED input: B3 must verify ownership/lease
// before constructing the config; the engine never re-checks wallets.

import { createHash } from "crypto";
import { AppError } from "@/lib/errors";
import { CLASS_ROSTER, freeCommanderTemplates } from "@/lib/commanders";
import type { CommanderDefinition, CommanderAbility, CommanderClass } from "@/lib/commanders";
import type { ChaosSchedule, ChaosEffect } from "@/lib/chaos";

// v4 (B2.5): two-lane arena with river, bridges, deterministic ground
// navigation, lane objectives, in-range target lock, territory + pocket
// deployment and RIFT_SHIFT ford crossings. Hashes differ from v3 by design.
// v5 (B2.5 hardening): troops target enemy commanders, live structures have
// solid footprints (ground units detour; range measured to footprint edge),
// octile movement accounting (straight 10, diagonal 14, carried remainder).
// v6 (B2.6a): commanders are one of the eight deck cards (7 ordinary + 1
// commander), deployed from hand for energy; no tick-0 spawn; runtime stats
// come from the class-keyed competitive profile COMMANDER_COMBAT_PROFILE_V1
// (free and NFT commanders of a class are identical in combat).
// v7 (B2.6b): the five active abilities fire only from validated player
// ability commands (energy cost ABILITY_ACTIVATION_COST_V1, tick cooldowns);
// deploy and onDeath triggers stay automatic. No active auto-fire remains.
// v8 (B2.7a): deployable building cards (Rift Sentry, Decoy Totem) with
// solid footprints, finite lifetimes, building-aware targeting and
// placement rules that keep every river crossing mouth clear.
export const COMBAT_RULESET_VERSION = "v9" as const;
export const TICKS_PER_SECOND = 10;
// Standard ranked timeline (v2): 180s regulation, up to 120s sudden-death overtime.
// Energy phases: 1x ticks 0-1199, 2x ticks 1200-2399, 3x ticks 2400-2999.
export const COMBAT_TIMELINE_V1 = {
  durationTicks: 180 * TICKS_PER_SECOND,
  overtimeTicks: 120 * TICKS_PER_SECOND,
  doubleEnergyTick: 1200,
  tripleEnergyTick: 2400,
} as const;

// Canonical arena v2: x 0..100, y 0..160. Player 0 holds y=0 (south),
// player 1 y=160 (north). Mirror-symmetric under y -> 160 - y (and x -> 100 - x
// for terrain). A river band y 74..86 splits the territories; ground units
// cross only on the two bridges (left x 24..36, right x 64..76) or on the
// central Rift Ford (x 44..56) while a RIFT_SHIFT pulse is active. Lanes split
// at x = 50 (x <= 50 is the left lane). Banks are y 73 (south) and y 87 (north).
// Destroying an enemy side tower unlocks a forward pocket on that lane half:
// 20 rows past the river (p0: y 87..106, p1: y 54..73), x 5..49 or 51..95.
export const ARENA_VERSION = "arena-v2" as const;
export const ARENA_V2 = {
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: 160,
  deployMarginX: 5,
  midY: 80,
  laneSplitX: 50,
  river: { minY: 74, maxY: 86 },
  bridges: [
    { id: "left", minX: 24, maxX: 36 },
    { id: "right", minX: 64, maxX: 76 },
  ],
  riftFord: { id: "rift", minX: 44, maxX: 56 },
  riftRegion: { minX: 40, maxX: 60, minY: 70, maxY: 90 },
  pocketDepth: 20,
  towers: [
    { kind: "tower", x: 30, y: 40, owner: 0 },
    { kind: "tower", x: 70, y: 40, owner: 0 },
    { kind: "tower", x: 30, y: 120, owner: 1 },
    { kind: "tower", x: 70, y: 120, owner: 1 },
  ],
  cores: [
    { kind: "core", x: 50, y: 8, owner: 0 },
    { kind: "core", x: 50, y: 152, owner: 1 },
  ],
} as const;

export type MoveType = "ground" | "air";

export interface TroopCardDef {
  id: string;
  name: string;
  cost: number;
  count: number;
  hp: number;
  damage: number;
  range: number;
  speed: number;
  sight: number;
  attackIntervalTicks: number;
  moveType: MoveType;
  hitsAir: boolean;
  hitsGround: boolean;
  structPriority: boolean;
  splashRadius: number;
  projectileTicks: number;
  slowPct: number;
  slowDurationTicks: number;
}

export interface SpellCardDef {
  id: string;
  name: string;
  cost: number;
  kind: "bolt" | "horn" | "impact";
  radius: number;
  damage: number;
  buffPct: number;
  buffDurationTicks: number;
  /** v9 impact spells only: explicit per-target-class rules. */
  impact?: ImpactSpec;
}

/**
 * B2.7b impact spell rules. Enemy-only (never friendly fire). Lands
 * `delayTicks` after the cast in the damage pass of that tick, so it shares
 * simultaneous damage, shields/armor, building death, crowns and victory
 * with every other damage source. Each entity is hit at most once.
 */
export interface ImpactSpec {
  delayTicks: number;
  /** Troops and (when hitsCommanders) commanders, before shields/armor. */
  unitDamage: number;
  buildingDamage: number;
  /** Towers and Core: deliberately reduced. */
  structureDamage: number;
  slowPct: number;
  slowDurationTicks: number;
  hitsAir: boolean;
  hitsGround: boolean;
  hitsCommanders: boolean;
}

// Authored v1 roster. Stats are versioned here, never derived from NFTs.
// Costs follow the agreed B2.2 roster (boulderback 5, frostshell 4).
export const TROOP_CARDS_V1: Record<string, TroopCardDef> = {
  choglings: { id: "choglings", name: "Choglings", cost: 2, count: 3, hp: 60, damage: 12, range: 2, speed: 2, sight: 25, attackIntervalTicks: 8, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
  chaos_archer: { id: "chaos_archer", name: "Chaos Archer", cost: 3, count: 2, hp: 50, damage: 15, range: 18, speed: 2, sight: 30, attackIntervalTicks: 10, moveType: "ground", hitsAir: true, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
  boulderback: { id: "boulderback", name: "Boulderback", cost: 5, count: 1, hp: 400, damage: 40, range: 2, speed: 1, sight: 22, attackIntervalTicks: 12, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: true, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
  frostshell: { id: "frostshell", name: "Frostshell", cost: 4, count: 1, hp: 250, damage: 20, range: 2, speed: 1, sight: 22, attackIntervalTicks: 12, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 50, slowDurationTicks: 60 },
  rift_runner: { id: "rift_runner", name: "Rift Runner", cost: 3, count: 1, hp: 70, damage: 14, range: 2, speed: 4, sight: 40, attackIntervalTicks: 9, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: true, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
  sparkcaster: { id: "sparkcaster", name: "Sparkcaster", cost: 4, count: 1, hp: 90, damage: 22, range: 20, speed: 2, sight: 26, attackIntervalTicks: 14, moveType: "ground", hitsAir: true, hitsGround: true, structPriority: false, splashRadius: 6, projectileTicks: 6, slowPct: 0, slowDurationTicks: 0 },
  chog_guardian: { id: "chog_guardian", name: "Chog Guardian", cost: 4, count: 1, hp: 260, damage: 26, range: 2, speed: 2, sight: 24, attackIntervalTicks: 10, moveType: "ground", hitsAir: false, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
  hexwing: { id: "hexwing", name: "Hexwing", cost: 4, count: 1, hp: 120, damage: 18, range: 14, speed: 3, sight: 30, attackIntervalTicks: 10, moveType: "air", hitsAir: true, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 4, slowPct: 0, slowDurationTicks: 0 },
  // v9 cheap-cycle air pair: 1 energy, dies to one tower shot. Ground-only
  // defenders (melee, Sentry) cannot touch it; towers, archers, Sparkcaster,
  // Hexwing, Deadeye and every spell can. Soaks tower shots and harasses.
  rift_sprites: { id: "rift_sprites", name: "Rift Sprites", cost: 1, count: 2, hp: 24, damage: 8, range: 2, speed: 4, sight: 25, attackIntervalTicks: 8, moveType: "air", hitsAir: false, hitsGround: true, structPriority: false, splashRadius: 0, projectileTicks: 0, slowPct: 0, slowDurationTicks: 0 },
};

export const SPELL_CARDS_V1: Record<string, SpellCardDef> = {
  // Enemy troops only: no structures, no friendly fire, no self-damage exploits.
  chaos_bolt: { id: "chaos_bolt", name: "Chaos Bolt", cost: 3, kind: "bolt", radius: 8, damage: 120, buffPct: 0, buffDurationTicks: 0 },
  // Friendly troops only, never structures: temporary attack buff, override stacking.
  rally_horn: { id: "rally_horn", name: "Rally Horn", cost: 2, kind: "horn", radius: 12, damage: 0, buffPct: 40, buffDurationTicks: 120 },
  // v9: delayed area blast. Hits enemy troops (ground + air), commanders,
  // buildings, towers and Core. Structure damage is 30% of unit damage, so a
  // tower takes 15 comets (60 energy) to fall to comets alone.
  chaos_comet: {
    id: "chaos_comet", name: "Chaos Comet", cost: 4, kind: "impact", radius: 6, damage: 140, buffPct: 0, buffDurationTicks: 0,
    impact: { delayTicks: 6, unitDamage: 140, buildingDamage: 140, structureDamage: 42, slowPct: 0, slowDurationTicks: 0, hitsAir: true, hitsGround: true, hitsCommanders: true },
  },
  // v9: instant control. Small damage plus a 40% slow for 5s on enemy troops
  // and commanders (ground + air). Never touches buildings or structures.
  rift_snare: {
    id: "rift_snare", name: "Rift Snare", cost: 2, kind: "impact", radius: 7, damage: 25, buffPct: 0, buffDurationTicks: 0,
    impact: { delayTicks: 0, unitDamage: 25, buildingDamage: 0, structureDamage: 0, slowPct: 40, slowDurationTicks: 50, hitsAir: true, hitsGround: true, hitsCommanders: true },
  },
};

/** B2.7a building card: a stationary, solid, finite-lifetime structure. */
export interface BuildingCardDef {
  id: string;
  name: string;
  cost: number;
  kind: "building";
  hp: number;
  /** 0 = never attacks (Decoy Totem). */
  damage: number;
  attackIntervalTicks: number;
  /** Center-to-center attack range, same metric as towers. */
  range: number;
  hitsAir: boolean;
  hitsGround: boolean;
  /** Chebyshev half-size of the solid footprint. */
  footprint: number;
  /** Ticks after placement before the first attack. */
  deployTicks: number;
  lifetimeTicks: number;
}

// Authored v1 buildings (original Chog Royale cards, no earlier spec exists).
// Sentry: ground-only turret, so Hexwing is its natural counter. Totem: no
// attack, a cheap solid structure target that pulls structure-priority and
// idle units that can see it. Neither is affected by Chaos Pulses, Chaos
// Bolt, Rift Snare, Rally Horn or commander abilities (all keep their
// unit-only rules). v9 Chaos Comet is the one spell that damages them.
export const BUILDING_CARDS_V1: Record<string, BuildingCardDef> = {
  rift_sentry: { id: "rift_sentry", name: "Rift Sentry", cost: 4, kind: "building", hp: 320, damage: 16, attackIntervalTicks: 8, range: 16, hitsAir: false, hitsGround: true, footprint: 2, deployTicks: 10, lifetimeTicks: 300 },
  decoy_totem: { id: "decoy_totem", name: "Decoy Totem", cost: 2, kind: "building", hp: 260, damage: 0, attackIntervalTicks: 0, range: 0, hitsAir: false, hitsGround: false, footprint: 1, deployTicks: 0, lifetimeTicks: 200 },
};

// Placement rules: clearance = free cells left between a building footprint
// and any live structure/building footprint (enforced by the shared
// "not within 2 cells of a live footprint" corner rule); crossingMouthRows =
// rows next to each bank, across every crossing's x span, that stay clear.
export const BUILDING_RULES_V1 = { clearance: 2, crossingMouthRows: 6, maxLivePerPlayer: 3 } as const;

export const CARDS_V1: Record<string, TroopCardDef | SpellCardDef | BuildingCardDef> = { ...TROOP_CARDS_V1, ...SPELL_CARDS_V1, ...BUILDING_CARDS_V1 };

// ---------------------------------------------------------------------------
// B2.6a commander card economy.
// A deck is exactly 7 distinct ordinary cards + 1 commander card whose id is
// `cmdr:<commanderId>` and must match the trusted commander snapshot for
// that player. B1 stays authoritative for class identity, traits and ability
// semantics; combat numbers come from this versioned class-keyed profile,
// so Tier/prestige and B1 sidegrade variants never change combat strength
// and free starters equal NFT commanders of the same class.
// ---------------------------------------------------------------------------
export const COMMANDER_CARD_PREFIX = "cmdr:";
export const COMMANDER_PROFILE_VERSION = "cp-v1" as const;

export interface CommanderCombatProfile {
  cost: number;
  hp: number;
  damage: number;
  intervalTicks: number;
  range: number;
  speed: number;
  sight: number;
  armor: number;
  hitsAir: boolean;
}

// Tuned with headless encounters (see src/lib/commander-balance.ts): an
// unanswered commander cannot destroy an intact side tower; ordinary 3-5
// energy counters can kill each class; classes keep their B1 roles.
export const COMMANDER_COMBAT_PROFILE_V1: Record<CommanderClass, CommanderCombatProfile> = {
  bulwark: { cost: 5, hp: 450, damage: 16, intervalTicks: 12, range: 2, speed: 1, sight: 24, armor: 1, hitsAir: false },
  reaver: { cost: 5, hp: 330, damage: 27, intervalTicks: 11, range: 2, speed: 2, sight: 24, armor: 1, hitsAir: false },
  deadeye: { cost: 5, hp: 280, damage: 34, intervalTicks: 13, range: 16, speed: 2, sight: 28, armor: 0, hitsAir: true },
  scout: { cost: 4, hp: 290, damage: 16, intervalTicks: 7, range: 3, speed: 3, sight: 28, armor: 0, hitsAir: false },
  warden: { cost: 5, hp: 380, damage: 22, intervalTicks: 12, range: 8, speed: 2, sight: 26, armor: 1, hitsAir: false },
};

// Runtime overrides for HP-scale magnitudes and B1 cell radii, per ability
// effect index. Fractions (haste/slow/buff/reflect), durations, cooldowns,
// triggers and targets stay exactly as authored in B1.3.
export const ABILITY_RUNTIME_V1: Record<string, Array<{ magnitude?: number; radius?: number }>> = {
  "bulwark-aegis-wall": [{ magnitude: 100 }],
  "bulwark-bedrock": [{}],
  "reaver-frenzy-rush": [{}, {}],
  "reaver-bloodlust": [{ magnitude: 40, radius: 6 }],
  // B1 authored volley radius == attack range (5 cells); runtime keeps it near range.
  "deadeye-piercing-volley": [{ magnitude: 70, radius: 14 }],
  "deadeye-overwatch": [{}],
  "scout-shadow-step": [{}, {}],
  "scout-pathfinder": [{ radius: 10 }],
  "warden-null-field": [{ radius: 8 }, { magnitude: 80 }],
  "warden-mend": [{ magnitude: 60 }],
};

// B2.6b activation economy. B1.3 authors no activation cost (energyCost is
// the deploy cost), so this versioned table is the only source of ability
// costs. Separate from the commander deploy cost; troop costs unchanged.
export const ABILITY_ECONOMY_VERSION = "ae-v1" as const;
export const ABILITY_ACTIVATION_COST_V1: Record<string, number> = {
  "bulwark-aegis-wall": 1,
  "reaver-frenzy-rush": 1,
  "deadeye-piercing-volley": 2,
  "scout-shadow-step": 1,
  "warden-null-field": 2,
};

export function commanderCardId(commanderId: string): string {
  return `${COMMANDER_CARD_PREFIX}${commanderId}`;
}
export function isCommanderCard(cardId: string): boolean {
  return cardId.startsWith(COMMANDER_CARD_PREFIX);
}

/** Runtime abilities: B1 roster semantics with ABILITY_RUNTIME_V1 overrides. */
export function runtimeAbilities(cls: CommanderClass): CommanderAbility[] {
  return CLASS_ROSTER[cls].abilities.map((a) => ({
    ...a,
    effects: a.effects.map((e, i) => {
      const o = ABILITY_RUNTIME_V1[a.id]?.[i] ?? {};
      return { ...e, magnitude: o.magnitude ?? e.magnitude, radiusOrRange: o.radius ?? e.radiusOrRange };
    }),
  }));
}

/** Trusted free-starter snapshot (no NFT required), same budget as NFTs. */
export function freeStarterSlot(cls: CommanderClass): CommanderSlotInput {
  const t = freeCommanderTemplates().find((x) => x.class === cls)!;
  return {
    commanderId: t.id,
    definition: {
      rulesetVersion: "v1",
      class: t.class,
      affinity: t.class,
      scores: { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 },
      signals: [],
      unmatchedTraits: [],
      stats: t.stats,
      abilities: t.abilities,
      variant: "free",
      prestige: "Free",
      powerScore: t.powerScore,
      derivationHash: t.id,
    },
  };
}

export const ENERGY_V1 = { max: 10, start: 5, regenTicksPerPoint: 28 } as const;

// Energy phase multiplier from the tick clock (integer, deterministic).
export function energyPhaseMult(tick: number): number {
  if (tick >= COMBAT_TIMELINE_V1.tripleEnergyTick) return 3;
  if (tick >= COMBAT_TIMELINE_V1.doubleEnergyTick) return 2;
  return 1;
}
export const STRUCTURE_V1 = {
  tower: { hp: 600, damage: 25, range: 25, intervalTicks: 10 },
  core: { hp: 1000, damage: 30, range: 28, intervalTicks: 10 },
} as const;

export type PlayerIndex = 0 | 1;

export interface DeployCommand {
  seq: number;
  player: PlayerIndex;
  tick: number;
  cardId: string;
  x: number;
  y: number;
}

/**
 * B2.6b player ability activation. Identifies only the actor, ordering and
 * ability id. All five current actives are self-centered (center = the
 * authoritative commander position), so x/y must be omitted; any supplied
 * target is rejected. Damage, shield, cooldown, cost and duration are
 * always server-derived.
 */
export interface AbilityCommand {
  kind: "ability";
  seq: number;
  player: PlayerIndex;
  tick: number;
  abilityId: string;
  x?: number;
  y?: number;
}

export type CombatCommand = DeployCommand | AbilityCommand;

export function isAbilityCommand(cmd: CombatCommand): cmd is AbilityCommand {
  return (cmd as AbilityCommand).kind === "ability";
}

export interface TroopEntity {
  id: string;
  kind: "troop";
  owner: PlayerIndex;
  cardId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  sight: number;
  interval: number;
  cooldownUntil: number;
  targetId: string | null;
  moveType: MoveType;
  hitsAir: boolean;
  hitsGround: boolean;
  structPriority: boolean;
  splashRadius: number;
  projectileTicks: number;
  slowPct: number;
  slowDurationTicks: number;
  slowUntil: number;
  activeSlowPct: number;
  buffUntil: number;
  buffPct: number;
  hasteUntil: number;
  hastePct: number;
  stunUntil: number;
  shieldHp: number;
  shieldUntil: number;
  reflectUntil: number;
  reflectFracNumer: number;
  reflectFracDenom: number;
  guardUntil: number;
  guardPct: number;
  armor: number;
  moveCarry: number;
}

// Commanders reuse troop combat mechanics plus armor, shields, reflect,
// and B1.3 abilities. Spawned from trusted B3-verified entitlements.
export interface CommanderEntity {
  id: string;
  kind: "commander";
  owner: PlayerIndex;
  commanderId: string;
  class: CommanderClass;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  sight: number;
  interval: number;
  cooldownUntil: number;
  targetId: string | null;
  armor: number;
  moveType: MoveType;
  hitsAir: boolean;
  hitsGround: boolean;
  structPriority: boolean;
  splashRadius: number;
  projectileTicks: number;
  slowDurationTicks: number;
  slowPct: number;
  slowUntil: number;
  activeSlowPct: number;
  buffUntil: number;
  buffPct: number;
  hasteUntil: number;
  hastePct: number;
  stunUntil: number;
  shieldHp: number;
  shieldUntil: number;
  reflectUntil: number;
  reflectFracNumer: number;
  reflectFracDenom: number;
  guardUntil: number;
  guardPct: number;
  preference: "closest" | "strongest" | "weakest" | "commander";
  abilities: CommanderAbility[];
  abilityReadyAt: Record<string, number>;
  /** Tick at which a fired ability's duration window ends (expiry event). */
  abilityActiveUntil: Record<string, number>;
  derivationHash: string;
  moveCarry: number;
}

export interface ProjectileEntity {
  id: string;
  owner: PlayerIndex;
  targetId: string;
  snapX: number;
  snapY: number;
  damage: number;
  splashRadius: number;
  arrivalTick: number;
}

export interface StructureEntity {
  id: string;
  kind: "structure";
  owner: PlayerIndex;
  structure: "tower" | "core";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface BuildingEntity {
  id: string;
  kind: "building";
  owner: PlayerIndex;
  cardId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  damage: number;
  range: number;
  interval: number;
  cooldownUntil: number;
  hitsAir: boolean;
  hitsGround: boolean;
  footprint: number;
  targetId: string | null;
  spawnTick: number;
  expiresAt: number;
}

export type CombatEvent =
  | { type: "deploy"; tick: number; player: PlayerIndex; cardId: string; entityIds: string[] }
  | { type: "death"; tick: number; entityId: string; owner: PlayerIndex }
  | { type: "structure_destroyed"; tick: number; entityId: string; owner: PlayerIndex; structure: "tower" | "core" }
  | { type: "match_end"; tick: number; winner: PlayerIndex | "draw"; reason: "core" | "crowns" | "overtime" | "timeout"; crowns: [number, number] }
  | { type: "command_rejected"; tick: number; seq: number; reason: string; player?: PlayerIndex; abilityId?: string }
  | { type: "spell_cast"; tick: number; player: PlayerIndex; cardId: string; x: number; y: number; affected: number }
  | { type: "commander_deployed"; tick: number; player: PlayerIndex; commanderId: string; class: string }
  | {
      type: "ability_fired";
      tick: number;
      player: PlayerIndex;
      commanderId: string;
      abilityId: string;
      trigger: "active" | "deploy" | "onDeath";
      seq: number | null;
      energySpent: number;
      x: number;
      y: number;
      radius: number | null;
      affected: number;
      readyAt: number | null;
      activeUntil: number | null;
    }
  | { type: "ability_ready"; tick: number; player: PlayerIndex; commanderId: string; abilityId: string; cost: number }
  | { type: "ability_expired"; tick: number; player: PlayerIndex; commanderId: string; abilityId: string; reason: "duration" | "death" }
  | { type: "pulse_warning"; tick: number; eventId: string; family: string; activationTick: number }
  | { type: "pulse_active"; tick: number; eventId: string; family: string }
  | { type: "pulse_expired"; tick: number; eventId: string; family: string }
  | { type: "rift_crossing"; tick: number; open: boolean; until: number }
  | { type: "building_spawned"; tick: number; player: PlayerIndex; buildingId: string; cardId: string; x: number; y: number; activeAt: number; expiresAt: number }
  | { type: "building_removed"; tick: number; buildingId: string; owner: PlayerIndex; cardId: string; reason: "destroyed" | "expired" }
  | { type: "spell_impact"; tick: number; player: PlayerIndex; cardId: string; impactId: string; x: number; y: number; units: number; buildings: number; structures: number };

/** v9 queued impact spell, resolved in the damage pass of `impactTick`. */
export interface PendingImpact {
  id: string;
  owner: PlayerIndex;
  cardId: string;
  x: number;
  y: number;
  castTick: number;
  impactTick: number;
}

export interface CommanderSlotInput {
  commanderId: string;
  definition: CommanderDefinition;
}

export interface CombatConfig {
  rulesetVersion: typeof COMBAT_RULESET_VERSION;
  seed: string;
  decks: [string[], string[]];
  commanderIds?: [string | null, string | null];
  commanders?: [CommanderSlotInput | null, CommanderSlotInput | null];
  chaosScheduleHash?: string | null;
  chaos?: ChaosSchedule | null;
}

export interface CombatState {
  tick: number;
  phase: "active" | "overtime" | "final";
  energy: [number, number];
  energyProgress: [number, number];
  hands: [string[], string[]];
  queues: [string[], string[]];
  troops: TroopEntity[];
  projectiles: ProjectileEntity[];
  commanders: CommanderEntity[];
  structures: StructureEntity[];
  buildings: BuildingEntity[];
  pendingImpacts: PendingImpact[];
  chaos: null | {
    schedule: ChaosSchedule;
    warned: boolean[];
    active: boolean[];
    expired: boolean[];
  };
  moveModUntil: number;
  moveModPct: number;
  energyModUntil: number;
  energyModPct: number;
  zoneMods: Array<{ zone: string; modifier: "slowed" | "hasted"; until: number }>;
  // Rift Ford is walkable for ground units while tick < riftOpenUntil.
  riftOpenUntil: number;
  // Per-match entity/projectile id counter (deterministic, never global).
  nextEntityId: number;
  // Trusted commander snapshots (validated at init) and per-player deploy counts.
  commanderSnapshots: [{ commanderId: string; class: CommanderClass; derivationHash: string } | null, { commanderId: string; class: CommanderClass; derivationHash: string } | null];
  commanderDeploys: [number, number];
  seenSeqs: number[];
  events: CombatEvent[];
  winner: PlayerIndex | "draw" | null;
  endReason: "core" | "crowns" | "overtime" | "timeout" | null;
  crowns: [number, number];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

const COMMANDER_CLASSES = ["bulwark", "reaver", "deadeye", "scout", "warden"] as const;

export function validateCommanders(slots: [CommanderSlotInput | null, CommanderSlotInput | null] | undefined): void {
  if (slots === undefined) return;
  for (const slot of slots) {
    if (slot === null) continue;
    if (!slot.commanderId || typeof slot.commanderId !== "string" || slot.commanderId.length > 120) {
      throw new AppError("BAD_REQUEST", "Commander slot requires a commander id");
    }
    const def = slot.definition;
    if (!def || def.rulesetVersion !== "v1") throw new AppError("BAD_REQUEST", "Commander definition must be ruleset v1");
    if (!(COMMANDER_CLASSES as readonly string[]).includes(def.class)) {
      throw new AppError("BAD_REQUEST", `Unknown commander class: ${String((def as { class?: unknown }).class)}`);
    }
    for (const n of [def.stats.health, def.stats.damage, def.stats.attackIntervalMs, def.stats.range, def.stats.moveSpeed]) {
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new AppError("BAD_REQUEST", "Commander stats must be non-negative numbers");
    }
    if (!Array.isArray(def.abilities)) throw new AppError("BAD_REQUEST", "Commander abilities must be an array");
    // Unauthorized snapshot guard: abilities must be exactly the B1 roster
    // set for the class, and free starter ids must name their own class.
    const want = CLASS_ROSTER[def.class].abilities.map((a) => a.id).sort().join(",");
    const got = def.abilities.map((a) => a?.id).sort().join(",");
    if (want !== got) throw new AppError("BAD_REQUEST", "Commander abilities do not match the class roster");
    if (slot.commanderId.startsWith("free-") && slot.commanderId !== `free-${def.class}`) {
      throw new AppError("BAD_REQUEST", "Free starter id does not match its class");
    }
    if (typeof def.derivationHash !== "string" || def.derivationHash.length === 0) {
      throw new AppError("BAD_REQUEST", "Commander snapshot requires a derivation hash");
    }
  }
}

export function validateChaos(schedule: ChaosSchedule | null | undefined): void {
  if (schedule === null || schedule === undefined) return;
  if (schedule.rulesetVersion !== "v1") throw new AppError("BAD_REQUEST", "Chaos schedule must be ruleset v1");
  if (!Array.isArray(schedule.events) || schedule.events.length === 0) {
    throw new AppError("BAD_REQUEST", "Chaos schedule requires events");
  }
}
/** v6 deck contract: exactly 7 distinct ordinary cards + 1 commander card
 * matching the player's trusted commander snapshot. */
export function validateDeck(deck: string[], slot: CommanderSlotInput | null = null): void {
  if (!Array.isArray(deck) || deck.length !== 8) {
    throw new AppError("BAD_REQUEST", "Deck must contain exactly 8 cards");
  }
  const seen = new Set<string>();
  let commanders = 0;
  for (const id of deck) {
    if (typeof id !== "string") throw new AppError("BAD_REQUEST", "Card ids must be strings");
    if (seen.has(id)) throw new AppError("BAD_REQUEST", `Duplicate card in deck: ${id}`);
    seen.add(id);
    if (isCommanderCard(id)) {
      commanders += 1;
      if (!slot) throw new AppError("BAD_REQUEST", "Commander card requires a trusted commander snapshot");
      if (id !== commanderCardId(slot.commanderId)) throw new AppError("BAD_REQUEST", `Commander card does not match snapshot: ${id}`);
      continue;
    }
    if (!CARDS_V1[id]) throw new AppError("BAD_REQUEST", `Card not playable: ${id}`);
  }
  if (commanders !== 1) throw new AppError("BAD_REQUEST", "Deck must contain exactly 7 ordinary cards and 1 commander card");
}

export function initMatch(config: CombatConfig): CombatState {
  if (config.rulesetVersion !== COMBAT_RULESET_VERSION) {
    throw new AppError("BAD_REQUEST", `Unsupported combat ruleset: ${config.rulesetVersion}`);
  }
  if (!config.seed || config.seed.trim().length === 0) throw new AppError("BAD_REQUEST", "Match requires a seed");
  validateCommanders(config.commanders);
  const slots = config.commanders ?? [null, null];
  validateDeck(config.decks[0], slots[0]);
  validateDeck(config.decks[1], slots[1]);
  if (config.commanderIds) {
    for (const c of config.commanderIds) {
      if (c !== null && (typeof c !== "string" || c.length === 0 || c.length > 120)) {
        throw new AppError("BAD_REQUEST", "Commander slot must be null or a commander id");
      }
    }
  }
  validateChaos(config.chaos);
  const structures: StructureEntity[] = [];
  for (const t of ARENA_V2.towers) {
    const def = STRUCTURE_V1.tower;
    structures.push({ id: `s-p${t.owner}-${t.kind}-${t.x}`, kind: "structure", owner: t.owner as PlayerIndex, structure: "tower", x: t.x, y: t.y, hp: def.hp, maxHp: def.hp, alive: true });
  }
  for (const c of ARENA_V2.cores) {
    const def = STRUCTURE_V1.core;
    structures.push({ id: `s-p${c.owner}-${c.kind}`, kind: "structure", owner: c.owner as PlayerIndex, structure: "core", x: c.x, y: c.y, hp: def.hp, maxHp: def.hp, alive: true });
  }
  const state: CombatState = {
    tick: 0,
    phase: "active",
    energy: [ENERGY_V1.start, ENERGY_V1.start],
    energyProgress: [0, 0],
    hands: [config.decks[0].slice(0, 4), config.decks[1].slice(0, 4)],
    queues: [config.decks[0].slice(4), config.decks[1].slice(4)],
    troops: [],
    projectiles: [],
    commanders: [],
    structures,
    buildings: [],
    pendingImpacts: [],
    chaos: config.chaos
      ? { schedule: config.chaos, warned: config.chaos.events.map(() => false), active: config.chaos.events.map(() => false), expired: config.chaos.events.map(() => false) }
      : null,
    moveModUntil: 0,
    moveModPct: 100,
    energyModUntil: 0,
    energyModPct: 100,
    zoneMods: [],
    riftOpenUntil: 0,
    nextEntityId: 0,
    commanderSnapshots: [
      slots[0] ? { commanderId: slots[0].commanderId, class: slots[0].definition.class, derivationHash: slots[0].definition.derivationHash } : null,
      slots[1] ? { commanderId: slots[1].commanderId, class: slots[1].definition.class, derivationHash: slots[1].definition.derivationHash } : null,
    ],
    commanderDeploys: [0, 0],
    seenSeqs: [],
    events: [],
    winner: null,
    endReason: null,
    crowns: [0, 0],
  };
  // v6: no commander exists at tick 0; it is deployed from hand.
  return state;
}

/** Spawn the authoritative commander entity from the trusted snapshot and
 * the class-keyed runtime profile (client stats are never used). */
function spawnCommander(state: CombatState, owner: PlayerIndex, x: number, y: number): CommanderEntity {
  const snap = state.commanderSnapshots[owner]!;
  const p = COMMANDER_COMBAT_PROFILE_V1[snap.class];
  state.commanderDeploys[owner] += 1;
  const commander: CommanderEntity = {
      id: `c${owner}-${state.commanderDeploys[owner]}`,
      kind: "commander",
      owner,
      commanderId: snap.commanderId,
      class: snap.class,
      x,
      y,
      hp: p.hp,
      maxHp: p.hp,
      damage: p.damage,
      range: p.range,
      speed: p.speed,
      sight: p.sight,
      interval: p.intervalTicks,
      cooldownUntil: state.tick,
      targetId: null,
      armor: p.armor,
      preference: CLASS_ROSTER[snap.class].baseStats.targetPreference,
      moveType: "ground",
      hitsAir: p.hitsAir,
      hitsGround: true,
      structPriority: false,
      splashRadius: 0,
      projectileTicks: 0,
      slowDurationTicks: 0,
      slowPct: 0,
      slowUntil: 0,
      activeSlowPct: 0,
      buffUntil: 0,
      buffPct: 0,
      hasteUntil: 0,
      hastePct: 0,
      stunUntil: 0,
      shieldHp: 0,
      shieldUntil: 0,
      reflectUntil: 0,
      reflectFracNumer: 0,
      reflectFracDenom: 1,
      guardUntil: 0,
      guardPct: 0,
      abilities: runtimeAbilities(snap.class),
      abilityReadyAt: {},
      abilityActiveUntil: {},
      derivationHash: snap.derivationHash,
      moveCarry: 0,
  };
  state.commanders.push(commander);
  return commander;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

function hittable(t: { hitsAir: boolean; hitsGround: boolean }, e: { moveType?: MoveType }): boolean {
  if (e.moveType === "air") return t.hitsAir;
  return t.hitsGround;
}

// ---------------------------------------------------------------------------
// Arena navigation (B2.5). Integer Chebyshev metric, which matches the
// per-axis clamped movement model exactly (travel ticks = ceil(cheb/speed)).
// The river is the only terrain obstacle, so a bounded crossing graph
// (left bridge, right bridge, Rift Ford when open) is exact and cheap:
// land -> bank entry -> straight across -> far bank -> goal. Routes are
// recomputed every tick from current position + current goal, so target
// changes reroute immediately with no stored path state.
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}
export type CrossingId = "left" | "right" | "rift";
export interface Crossing {
  id: CrossingId;
  minX: number;
  maxX: number;
}
export interface GroundRoute {
  crossing: CrossingId | null;
  cost: number;
  waypoints: Point[];
  stranded: boolean;
}

const RIVER = ARENA_V2.river;

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// v5 movement accounting: straight cell 10, diagonal cell 14 (integer
// octile approximation of Euclidean length). Route costs and per-tick
// movement budgets (speed * 10, unspent remainder carried) share it.
export const MOVE_STRAIGHT = 10;
export const MOVE_DIAG = 14;
export function octile(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return MOVE_DIAG * Math.min(dx, dy) + MOVE_STRAIGHT * (Math.abs(dx - dy));
}

// v5 solid footprints (Chebyshev half-size around the structure center).
// Live structures block ground movement; air flies over; destroyed
// structures become walkable rubble. Attack range against a structure is
// measured to its footprint edge, so adjacent ring cells are melee contact.
export const STRUCTURE_FOOTPRINT_V5 = { tower: 3, core: 4 } as const;
export interface Solid {
  x: number;
  y: number;
  r: number;
}
export function solidsOf(structures: Array<{ x: number; y: number; alive: boolean; structure: "tower" | "core" }>): Solid[] {
  return structures.filter((s) => s.alive).map((s) => ({ x: s.x, y: s.y, r: STRUCTURE_FOOTPRINT_V5[s.structure] }));
}
/** v8: live building footprints are solid exactly like structure footprints. */
export function buildingSolids(buildings: BuildingEntity[]): Solid[] {
  return buildings.filter((b) => b.alive).map((b) => ({ x: b.x, y: b.y, r: b.footprint }));
}
function inSolid(x: number, y: number, s: Solid): boolean {
  return Math.abs(x - s.x) <= s.r && Math.abs(y - s.y) <= s.r;
}
/** Squared reach from a unit to a target: center distance for units, gap to
 * the footprint ring (r + 1) for structures. */
export function reach2(ux: number, uy: number, t: { x: number; y: number; r: number }): number {
  if (t.r <= 0) return dist2(ux, uy, t.x, t.y);
  const dx = Math.max(0, Math.abs(ux - t.x) - (t.r + 1));
  const dy = Math.max(0, Math.abs(uy - t.y) - (t.r + 1));
  return dx * dx + dy * dy;
}
/** Nearest ring cell of a structure footprint, used as the movement goal. */
export function approachPoint(u: Point, t: { x: number; y: number; r: number }): Point {
  if (t.r <= 0) return { x: t.x, y: t.y };
  const k = t.r + 1;
  return { x: Math.max(t.x - k, Math.min(t.x + k, u.x)), y: Math.max(t.y - k, Math.min(t.y + k, u.y)) };
}

export function inRiver(y: number): boolean {
  return y >= RIVER.minY && y <= RIVER.maxY;
}

/** Territory side of a y coordinate: 0 = south (player 0), 1 = north (player 1). */
export function sideOf(y: number): PlayerIndex | "river" {
  if (y < RIVER.minY) return 0;
  if (y > RIVER.maxY) return 1;
  return "river";
}

function bankY(side: PlayerIndex): number {
  return side === 0 ? RIVER.minY - 1 : RIVER.maxY + 1;
}

/** Open crossings in fixed tie-break order: left, right, rift. */
export function openCrossings(riftOpen: boolean): Crossing[] {
  const list: Crossing[] = ARENA_V2.bridges.map((b) => ({ id: b.id as CrossingId, minX: b.minX, maxX: b.maxX }));
  if (riftOpen) list.push({ id: "rift", minX: ARENA_V2.riftFord.minX, maxX: ARENA_V2.riftFord.maxX });
  return list;
}

function crossingAt(x: number, crossings: Crossing[]): Crossing | null {
  return crossings.find((c) => x >= c.minX && x <= c.maxX) ?? null;
}

export function inArena(x: number, y: number): boolean {
  return x >= ARENA_V2.minX && x <= ARENA_V2.maxX && y >= ARENA_V2.minY && y <= ARENA_V2.maxY;
}

/** Ground walkability: in arena, outside live footprints, and either on
 * land or on an open crossing. */
export function isWalkable(x: number, y: number, riftOpen: boolean, solids: Solid[] = []): boolean {
  if (!inArena(x, y)) return false;
  if (solids.some((s) => inSolid(x, y, s))) return false;
  return !inRiver(y) || crossingAt(x, openCrossings(riftOpen)) !== null;
}

/**
 * Deterministic ground route. Returns null when the goal is unreachable
 * for ground units (goal stands in open water). A unit standing in water
 * that is not on an open crossing (Rift Ford closed under it) is
 * "stranded" and walks straight out to the goal-side bank: no teleport,
 * no trap. Equal-cost crossings resolve to the smallest lateral detour
 * (|entry x - unit x|), then the fixed order left, right, rift
 * (identical for both players).
 */
export function planGroundRoute(from: Point, to: Point, riftOpen: boolean): GroundRoute | null {
  const cs = openCrossings(riftOpen);
  const fs = sideOf(from.y);
  const ts = sideOf(to.y);
  const toCrossing = ts === "river" ? crossingAt(to.x, cs) : null;
  if (ts === "river" && !toCrossing) return null;
  if (fs === "river") {
    const here = crossingAt(from.x, cs);
    if (here && toCrossing && here.id === toCrossing.id) {
      return { crossing: here.id, cost: octile(from, to), waypoints: [to], stranded: false };
    }
    const exitSide: PlayerIndex =
      ts !== "river" ? ts : to.y > ARENA_V2.midY ? 1 : to.y < ARENA_V2.midY ? 0 : from.y > ARENA_V2.midY ? 1 : 0;
    const exit = { x: from.x, y: bankY(exitSide) };
    const rest = planGroundRoute(exit, to, riftOpen);
    if (!rest) return null;
    return { crossing: here ? here.id : rest.crossing, cost: octile(from, exit) + rest.cost, waypoints: [exit, ...rest.waypoints], stranded: !here };
  }
  if (ts === fs) return { crossing: null, cost: octile(from, to), waypoints: [to], stranded: false };
  let best: GroundRoute | null = null;
  for (const c of cs) {
    if (toCrossing && c.id !== toCrossing.id) continue;
    const ex = Math.max(c.minX, Math.min(c.maxX, from.x));
    const entry = { x: ex, y: bankY(fs) };
    let route: GroundRoute;
    if (toCrossing) {
      route = { crossing: c.id, cost: octile(from, entry) + octile(entry, to), waypoints: [entry, to], stranded: false };
    } else {
      const exit = { x: ex, y: bankY(ts as PlayerIndex) };
      route = { crossing: c.id, cost: octile(from, entry) + octile(entry, exit) + octile(exit, to), waypoints: [entry, exit, to], stranded: false };
    }
    if (!best || route.cost < best.cost || (route.cost === best.cost && Math.abs(ex - from.x) < Math.abs(best.waypoints[0]!.x - from.x))) {
      best = route;
    }
  }
  return best;
}

function signStep(e: Point, goal: Point): Point {
  return { x: e.x + Math.sign(goal.x - e.x), y: e.y + Math.sign(goal.y - e.y) };
}

/** True when the sign-step polyline a -> b never enters solid s. */
function polylineClear(a: Point, b: Point, s: Solid): boolean {
  let p = { ...a };
  for (let i = 0; i < 400 && (p.x !== b.x || p.y !== b.y); i++) {
    p = signStep(p, b);
    if (inSolid(p.x, p.y, s)) return false;
  }
  return true;
}

/**
 * Deterministic footprint detour: when the next cell toward the waypoint is
 * inside a live footprint, head for the ring corner (r + 1) that is
 * reachable without entering it and minimizes octile(pos, corner) +
 * octile(corner, waypoint); ties keep corner order (-,-), (+,-), (-,+), (+,+).
 */
function detourCorner(e: Point, wp: Point, blocker: Solid, solids: Solid[], open: boolean): Point | null {
  const k = blocker.r + 1;
  let best: Point | null = null;
  let bestCost = Infinity;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const c = { x: blocker.x + sx * k, y: blocker.y + sy * k };
    if ((c.x === e.x && c.y === e.y) || !isWalkable(c.x, c.y, open, solids) || !polylineClear(e, c, blocker)) continue;
    const cost = octile(e, c) + octile(c, wp);
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

function nextCell(e: Point & { moveType: MoveType }, goal: Point, open: boolean, solids: Solid[]): Point | null {
  if (e.x === goal.x && e.y === goal.y) return null;
  if (e.moveType === "air") return signStep(e, goal);
  const route = planGroundRoute(e, goal, open);
  if (!route) return null;
  const wp = route.waypoints.find((w) => w.x !== e.x || w.y !== e.y);
  if (!wp) return null;
  const step = signStep(e, wp);
  const blocker = solids.find((s) => inSolid(step.x, step.y, s));
  if (!blocker) return step;
  const corner = detourCorner(e, wp, blocker, solids, open);
  if (!corner) return null;
  const alt = signStep(e, corner);
  return solids.some((s) => inSolid(alt.x, alt.y, s)) ? null : alt;
}

/**
 * Move one tick toward goal, one cell at a time. Budget = speed * 10 plus
 * the carried remainder; straight cells cost 10, diagonal 14. Air flies
 * straight over water and footprints; ground follows the river-aware route
 * and detours around live footprints. `done` stops movement as soon as the
 * unit is in range. Returns the remainder to carry (0 when idle/arrived).
 */
export function moveUnit(
  e: Point & { moveType: MoveType },
  goal: Point,
  speed: number,
  riftOpen: boolean,
  solids: Solid[] = [],
  carry = 0,
  done?: () => boolean
): number {
  let budget = speed * MOVE_STRAIGHT + carry;
  for (let guard = 0; guard < 64; guard++) {
    if (done?.()) return 0;
    const next = nextCell(e, goal, riftOpen, e.moveType === "air" ? [] : solids);
    if (!next) return 0;
    const cost = next.x !== e.x && next.y !== e.y ? MOVE_DIAG : MOVE_STRAIGHT;
    if (cost > budget) return Math.min(budget, MOVE_DIAG - 1);
    e.x = next.x;
    e.y = next.y;
    budget -= cost;
  }
  return 0;
}

function riftOpen(state: CombatState): boolean {
  return state.tick < state.riftOpenUntil;
}

/** Lane objective when nothing is in sight: the enemy side tower on the
 * unit's current lane (x <= 50 is left), else the enemy Core. */
export function laneObjective(e: { owner: PlayerIndex; x: number }, structures: StructureEntity[]): StructureEntity | null {
  const left = e.x <= ARENA_V2.laneSplitX;
  const tower = structures.find(
    (s) => s.structure === "tower" && s.owner !== e.owner && s.alive && (left ? s.x <= ARENA_V2.laneSplitX : s.x > ARENA_V2.laneSplitX)
  );
  if (tower) return tower;
  const core = structures.find((s) => s.structure === "core" && s.owner !== e.owner && s.alive);
  return core ?? null;
}

/**
 * Troop deployment territory (spells keep their own arena-wide rule).
 * Own territory: x 5..95 and the owner's side of the river (p0 y 0..73,
 * p1 y 87..160). River and bridges are never deployable. Forward pocket:
 * once the enemy side tower on a lane is destroyed, that lane half
 * (x 5..49 left, 51..95 right) opens for the first 20 rows past the river
 * (p0 y 87..106, p1 y 54..73).
 */
export function troopDeployCheck(
  structures: StructureEntity[],
  player: PlayerIndex,
  x: number,
  y: number,
  extraSolids: Solid[] = []
): { ok: true; zone: "own" | "pocket-left" | "pocket-right" } | { ok: false; reason: string } {
  const margin = ARENA_V2.deployMarginX;
  if (!inArena(x, y) || x < ARENA_V2.minX + margin || x > ARENA_V2.maxX - margin) return { ok: false, reason: "Deployment outside arena territory" };
  if (inRiver(y)) return { ok: false, reason: "Deployment on river or bridge" };
  // v5: no deploys on or within swarm-offset reach (2 cells) of a live footprint
  // (v8: building footprints included via extraSolids).
  if ([...solidsOf(structures), ...extraSolids].some((s) => Math.abs(x - s.x) <= s.r + 2 && Math.abs(y - s.y) <= s.r + 2)) {
    return { ok: false, reason: "Deployment on structure" };
  }
  if (sideOf(y) === player) return { ok: true, zone: "own" };
  const depth = ARENA_V2.pocketDepth;
  const inPocketRows = player === 0 ? y <= RIVER.maxY + depth : y >= RIVER.minY - depth;
  const split = ARENA_V2.laneSplitX;
  const lane: "left" | "right" | null = x < split ? "left" : x > split ? "right" : null;
  if (inPocketRows && lane) {
    const towerDown = structures.some(
      (s) => s.structure === "tower" && s.owner !== player && !s.alive && (lane === "left" ? s.x < split : s.x > split)
    );
    if (towerDown) return { ok: true, zone: lane === "left" ? "pocket-left" : "pocket-right" };
  }
  return { ok: false, reason: "Deployment outside own territory" };
}

/**
 * v8 building placement. The center and every footprint corner must pass
 * the troop territory rule (own side or open pocket, x 5..95, never river or
 * bridge, never within 2 cells of a live footprint), which leaves exactly
 * BUILDING_RULES_V1.clearance (2) free cells to every live structure and
 * building footprint. On top of that: no living ground unit inside the new footprint, the
 * footprint (plus 1) never touches the crossingMouthRows next to either bank
 * across any crossing span (left, right and Rift Ford), so no placement can
 * seal a bridge, and at most maxLivePerPlayer live buildings per player.
 */
export function buildingDeployCheck(state: CombatState, player: PlayerIndex, x: number, y: number, def: BuildingCardDef): { ok: true } | { ok: false; reason: string } {
  const rules = BUILDING_RULES_V1;
  if (state.buildings.filter((b) => b.owner === player && b.alive).length >= rules.maxLivePerPlayer) return { ok: false, reason: "Building limit reached" };
  const h = def.footprint;
  const own = buildingSolids(state.buildings);
  for (const [cx, cy] of [[x, y], [x - h, y - h], [x + h, y - h], [x - h, y + h], [x + h, y + h]] as const) {
    const zone = troopDeployCheck(state.structures, player, cx, cy, own);
    if (!zone.ok) return zone;
  }
  if (sideOf(y - h) !== sideOf(y + h)) return { ok: false, reason: "Deployment outside own territory" };
  const rows = rules.crossingMouthRows;
  const mouths = [[RIVER.minY - rows, RIVER.minY - 1], [RIVER.maxY + 1, RIVER.maxY + rows]] as const;
  for (const c of openCrossings(true)) {
    const xHit = x + h + 1 >= c.minX && x - h - 1 <= c.maxX;
    if (xHit && mouths.some(([lo, hi]) => y + h + 1 >= lo && y - h - 1 <= hi)) return { ok: false, reason: "Building blocks a river crossing" };
  }
  if ([...state.troops, ...state.commanders].some((u) => u.hp > 0 && u.moveType === "ground" && Math.abs(u.x - x) <= h && Math.abs(u.y - y) <= h)) {
    return { ok: false, reason: "Building footprint occupied" };
  }
  return { ok: true };
}

export interface CombatTarget {
  id: string;
  x: number;
  y: number;
  r: number;
}
function asTarget(e: { id: string; x: number; y: number; kind: string }): CombatTarget {
  const r = e.kind === "structure" ? STRUCTURE_FOOTPRINT_V5[(e as StructureEntity).structure] : e.kind === "building" ? (e as BuildingEntity).footprint : 0;
  return { id: e.id, x: e.x, y: e.y, r };
}

/** Reachable (ground) or always (air), or already within attack range. */
function engageable(t: Point & { moveType: MoveType; range: number }, target: CombatTarget, open: boolean): boolean {
  if (reach2(t.x, t.y, target) <= t.range * t.range) return true;
  return t.moveType === "air" || planGroundRoute(t, approachPoint(t, target), open) !== null;
}

/**
 * Troop target acquisition (v5). Candidates (enemy troops, enemy commanders
 * and enemy structures) must be in sight and engageable. In-range candidates
 * rank first by squared reach; others rank by real route cost for ground
 * units (squared distance for air), so an enemy across the river ranks by
 * bridge path. Target lock: a troop already attacking an in-range target
 * keeps it until it dies or leaves range (structure-priority units only
 * lock structures). Ties break by entity id.
 */
function acquireTarget(t: TroopEntity, state: CombatState): CombatTarget | null {
  const open = riftOpen(state);
  if (t.targetId) {
    const cur =
      state.troops.find((e) => e.id === t.targetId && e.hp > 0) ??
      state.commanders.find((c) => c.id === t.targetId && c.hp > 0) ??
      state.structures.find((s) => s.id === t.targetId && s.alive) ??
      state.buildings.find((b) => b.id === t.targetId && b.alive) ??
      null;
    if (cur && cur.owner !== t.owner && hittable(t, cur as { moveType?: MoveType }) && (!t.structPriority || cur.kind === "structure" || cur.kind === "building")) {
      const tg = asTarget(cur);
      if (reach2(t.x, t.y, tg) <= t.range * t.range) return tg;
    }
  }
  const rank = (tg: CombatTarget): [number, number] | null => {
    const d = reach2(t.x, t.y, tg);
    if (d > t.sight * t.sight) return null;
    if (d <= t.range * t.range) return [0, d];
    if (t.moveType === "air") return [1, d];
    const r = planGroundRoute(t, approachPoint(t, tg), open);
    return r ? [1, r.cost] : null;
  };
  const better = (a: [number, number], aId: string, b: [number, number] | null, bId: string): boolean =>
    b === null || a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && aId < bId)));
  const scan = (list: Array<{ id: string; x: number; y: number; kind: string }>) => {
    let best: CombatTarget | null = null;
    let bestK: [number, number] | null = null;
    for (const e of list) {
      const tg = asTarget(e);
      const k = rank(tg);
      if (k && better(k, e.id, bestK, best?.id ?? "")) {
        bestK = k;
        best = tg;
      }
    }
    return best;
  };
  const foes = [...state.troops, ...state.commanders].filter((e) => e.owner !== t.owner && e.hp > 0 && hittable(t, e));
  // v8: enemy buildings rank alongside towers/Core by reach (in sight only),
  // so a nearer Decoy Totem or Sentry pulls structure-priority units.
  const structs = [...state.structures, ...state.buildings].filter((s) => s.owner !== t.owner && s.alive);
  if (t.structPriority) return scan(structs) ?? scan(foes);
  return scan(foes) ?? scan(structs);
}

interface Fighter {
  id: string;
  kind: string;
  owner: PlayerIndex;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  sight: number;
  interval: number;
  cooldownUntil: number;
  targetId: string | null;
  moveType: MoveType;
  hitsAir: boolean;
  hitsGround: boolean;
  structPriority: boolean;
  splashRadius: number;
  projectileTicks: number;
  slowDurationTicks: number;
  slowPct: number;
  slowUntil: number;
  activeSlowPct: number;
  buffUntil: number;
  buffPct: number;
  hasteUntil: number;
  hastePct: number;
  stunUntil: number;
  shieldHp: number;
  shieldUntil: number;
  reflectUntil: number;
  reflectFracNumer: number;
  reflectFracDenom: number;
  guardUntil: number;
  guardPct: number;
  armor: number;
}

function zoneOf(y: number): string {
  if (y >= 107) return "north";
  if (y <= 52) return "south";
  return "center";
}

function combatSpeed(e: Fighter, tick: number, state: CombatState): number {
  let v = e.speed;
  if (tick < e.hasteUntil) v = Math.floor((v * (100 + e.hastePct)) / 100);
  if (tick < e.slowUntil) v = Math.floor((v * (100 - e.activeSlowPct)) / 100);
  if (tick < state.moveModUntil) v = Math.floor((v * state.moveModPct) / 100);
  for (const zm of state.zoneMods) {
    if (tick < zm.until && zm.zone === zoneOf(e.y)) {
      v = zm.modifier === "slowed" ? Math.floor(v / 2) : v * 2;
    }
  }
  return Math.max(1, v);
}

function combatDamage(e: Fighter, tick: number): number {
  if (tick < e.buffUntil) return Math.floor((e.damage * (100 + e.buffPct)) / 100);
  return e.damage;
}

function pickCommanderTarget(
  c: CommanderEntity,
  troops: TroopEntity[],
  commanders: CommanderEntity[],
  structures: Array<StructureEntity | BuildingEntity>,
  preference: string,
  open = false
): CombatTarget | null {
  const pool: Fighter[] = [...troops.filter((t) => t.hp > 0), ...commanders.filter((x) => x.hp > 0 && x.id !== c.id)];
  const foes = pool.filter((e) => e.owner !== c.owner && hittable(c as unknown as TroopEntity, e) && engageable(c, asTarget(e), open));
  const inSight = foes.filter((e) => dist2(c.x, c.y, e.x, e.y) <= c.sight * c.sight);
  if (inSight.length > 0) {
    const sorted = [...inSight].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (preference === "strongest") {
      let m = sorted[0] as Fighter;
      for (const e of sorted) if (e.maxHp > m.maxHp) m = e;
      return { id: m.id, x: m.x, y: m.y, r: 0 };
    }
    if (preference === "weakest") {
      let m = sorted[0] as Fighter;
      for (const e of sorted) if (e.hp < m.hp) m = e;
      return { id: m.id, x: m.x, y: m.y, r: 0 };
    }
    if (preference === "commander") {
      const foe = sorted.find((e) => e.kind === "commander");
      if (foe) return { id: foe.id, x: foe.x, y: foe.y, r: 0 };
    }
    let best = sorted[0] as Fighter;
    let bestD = dist2(c.x, c.y, best.x, best.y);
    for (const e of sorted) {
      const d = dist2(c.x, c.y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return { id: best.id, x: best.x, y: best.y, r: 0 };
  }
  let bestS: CombatTarget | null = null;
  let bestD = Infinity;
  for (const s of structures) {
    if (s.owner === c.owner || !s.alive) continue;
    const tg = asTarget(s);
    const d = reach2(c.x, c.y, tg);
    if (d <= c.sight * c.sight && d < bestD) {
      bestD = d;
      bestS = tg;
    }
  }
  return bestS;
}


function commanderAlive(state: CombatState, p: PlayerIndex): boolean {
  return state.commanders.some((c) => c.owner === p && c.hp > 0);
}

/**
 * Card cycle (v6): the played card leaves the hand, the queue head is drawn,
 * then the played card joins the queue tail. Commander hold policy: while
 * the player's commander is alive its card cannot be drawn; if it reaches
 * the queue head it moves to the tail and the next card is drawn instead,
 * so the hand never holds an unplayable commander. After the commander dies
 * the card is drawable again from its current queue position.
 */
function playFromHand(state: CombatState, p: PlayerIndex, cardId: string): void {
  const hand = state.hands[p];
  hand.splice(hand.indexOf(cardId), 1);
  const queue = state.queues[p];
  const held = commanderAlive(state, p) || isCommanderCard(cardId);
  if (held && queue.length > 1 && isCommanderCard(queue[0]!)) queue.push(queue.shift()!);
  const next = queue.shift();
  if (next !== undefined) hand.push(next);
  queue.push(cardId);
}

/** Deploy the commander card: same hand/energy/territory rules as troops,
 * one living commander per player, stats from the trusted snapshot class. */
function deployCommander(state: CombatState, cmd: DeployCommand): void {
  const snap = state.commanderSnapshots[cmd.player];
  if (!snap || cmd.cardId !== commanderCardId(snap.commanderId)) throw new AppError("BAD_REQUEST", "Wrong commander reference");
  const hand = state.hands[cmd.player];
  if (!hand.includes(cmd.cardId)) throw new AppError("UNPROCESSABLE", `Card ${cmd.cardId} not in hand`);
  if (commanderAlive(state, cmd.player)) throw new AppError("UNPROCESSABLE", "Commander already deployed");
  const cost = COMMANDER_COMBAT_PROFILE_V1[snap.class].cost;
  if (state.energy[cmd.player] < cost) throw new AppError("UNPROCESSABLE", "Insufficient energy");
  const zone = troopDeployCheck(state.structures, cmd.player, cmd.x, cmd.y, buildingSolids(state.buildings));
  if (!zone.ok) throw new AppError("UNPROCESSABLE", zone.reason);
  state.energy[cmd.player] -= cost;
  playFromHand(state, cmd.player, cmd.cardId);
  state.seenSeqs.push(cmd.seq);
  const c = spawnCommander(state, cmd.player, cmd.x, cmd.y);
  state.events.push({ type: "deploy", tick: state.tick, player: cmd.player, cardId: cmd.cardId, entityIds: [c.id] });
  state.events.push({ type: "commander_deployed", tick: state.tick, player: cmd.player, commanderId: snap.commanderId, class: snap.class });
  for (const ability of c.abilities) {
    if (ability.trigger === "deploy") fireAbilityOn(state, c, ability.id);
  }
  // Actives are ready on deploy (fresh entity, fresh cooldowns) but fire
  // only when commanded.
  for (const ability of c.abilities) {
    if (ability.trigger === "active") {
      state.events.push({ type: "ability_ready", tick: state.tick, player: c.owner, commanderId: c.commanderId, abilityId: ability.id, cost: ABILITY_ACTIVATION_COST_V1[ability.id] ?? 0 });
    }
  }
}

function applyDeploy(state: CombatState, cmd: DeployCommand, counter: { n: number }): void {
  if (state.phase === "final") throw new AppError("CONFLICT", "Match already finalized");
  if (state.seenSeqs.includes(cmd.seq)) throw new AppError("CONFLICT", `Duplicate command seq: ${cmd.seq}`);
  if (cmd.tick < state.tick) throw new AppError("UNPROCESSABLE", `Stale command tick ${cmd.tick} < ${state.tick}`);
  if (cmd.player !== 0 && cmd.player !== 1) throw new AppError("BAD_REQUEST", "Invalid player");
  if (typeof cmd.cardId === "string" && isCommanderCard(cmd.cardId)) return deployCommander(state, cmd);
  const def = CARDS_V1[cmd.cardId];
  if (!def) throw new AppError("BAD_REQUEST", `Card not playable: ${cmd.cardId}`);
  const hand = state.hands[cmd.player];
  if (!hand.includes(cmd.cardId)) throw new AppError("UNPROCESSABLE", `Card ${cmd.cardId} not in hand`);
  if (state.energy[cmd.player] < def.cost) throw new AppError("UNPROCESSABLE", "Insufficient energy");
  const isSpell = ["bolt", "horn", "impact"].includes((def as SpellCardDef).kind);
  const bdef = (def as BuildingCardDef).kind === "building" ? (def as BuildingCardDef) : null;
  if (bdef) {
    const zone = buildingDeployCheck(state, cmd.player, cmd.x, cmd.y, bdef);
    if (!zone.ok) throw new AppError("UNPROCESSABLE", zone.reason);
  } else if (!isSpell) {
    const zone = troopDeployCheck(state.structures, cmd.player, cmd.x, cmd.y, buildingSolids(state.buildings));
    if (!zone.ok) throw new AppError("UNPROCESSABLE", zone.reason);
  }
  if (isSpell && !inArena(cmd.x, cmd.y)) throw new AppError("UNPROCESSABLE", "Spell target outside arena");
  state.energy[cmd.player] -= def.cost;
  playFromHand(state, cmd.player, cmd.cardId);
  state.seenSeqs.push(cmd.seq);
  if (isSpell) {
    if ((def as SpellCardDef).kind === "impact") counter.n += 1;
    castSpell(state, cmd, def as SpellCardDef, `s${counter.n}`);
    return;
  }
  if (bdef) {
    counter.n += 1;
    const b: BuildingEntity = {
      id: `b${counter.n}`,
      kind: "building",
      owner: cmd.player,
      cardId: bdef.id,
      x: cmd.x,
      y: cmd.y,
      hp: bdef.hp,
      maxHp: bdef.hp,
      alive: true,
      damage: bdef.damage,
      range: bdef.range,
      interval: bdef.attackIntervalTicks,
      cooldownUntil: state.tick + bdef.deployTicks,
      hitsAir: bdef.hitsAir,
      hitsGround: bdef.hitsGround,
      footprint: bdef.footprint,
      targetId: null,
      spawnTick: state.tick,
      expiresAt: state.tick + bdef.lifetimeTicks,
    };
    state.buildings.push(b);
    state.events.push({ type: "deploy", tick: state.tick, player: cmd.player, cardId: cmd.cardId, entityIds: [b.id] });
    state.events.push({ type: "building_spawned", tick: state.tick, player: cmd.player, buildingId: b.id, cardId: b.cardId, x: b.x, y: b.y, activeAt: b.cooldownUntil, expiresAt: b.expiresAt });
    return;
  }
  const tdef = def as TroopCardDef;
  const ids: string[] = [];
  // Swarm offset: third+ unit sits one row back (+1), or -1 when +1 would
  // land in the river or off the arena. Spawns never enter water.
  const backDy = inRiver(cmd.y + 1) || cmd.y + 1 > ARENA_V2.maxY ? -1 : 1;
  for (let i = 0; i < tdef.count; i++) {
    counter.n += 1;
    const id = `t${counter.n}`;
    ids.push(id);
    state.troops.push({
      id,
      kind: "troop",
      owner: cmd.player,
      cardId: tdef.id,
      x: cmd.x + (i % 2 === 0 ? i : -i),
      y: cmd.y + (i > 1 ? backDy : 0),
      hp: tdef.hp,
      maxHp: tdef.hp,
      damage: tdef.damage,
      range: tdef.range,
      speed: tdef.speed,
      sight: tdef.sight,
      interval: tdef.attackIntervalTicks,
      cooldownUntil: state.tick,
      targetId: null,
      moveType: tdef.moveType,
      hitsAir: tdef.hitsAir,
      hitsGround: tdef.hitsGround,
      structPriority: tdef.structPriority,
      splashRadius: tdef.splashRadius,
      projectileTicks: tdef.projectileTicks,
      slowPct: tdef.slowPct,
      slowDurationTicks: tdef.slowDurationTicks,
      slowUntil: 0,
      activeSlowPct: 0,
      buffUntil: 0,
      buffPct: 0,
      hasteUntil: 0,
      hastePct: 0,
      stunUntil: 0,
      shieldHp: 0,
      shieldUntil: 0,
      reflectUntil: 0,
      reflectFracNumer: 0,
      reflectFracDenom: 1,
      guardUntil: 0,
      guardPct: 0,
      armor: 0,
      moveCarry: 0,
    });
  }
  state.events.push({ type: "deploy", tick: state.tick, player: cmd.player, cardId: cmd.cardId, entityIds: ids });
}

/**
 * v9 shared timed-status stacking (slow, haste, damage buff): while active,
 * the strongest percent wins; every application refreshes the end tick to
 * the latest application's duration; an expired status no longer lends its
 * old percent to a new, weaker one (the v8 stale-percent bug).
 */
function stackPct(cur: number, until: number, tick: number, pct: number): number {
  return tick < until ? Math.max(cur, pct) : pct;
}
function applySlow(e: { slowUntil: number; activeSlowPct: number }, tick: number, pct: number, dur: number): void {
  e.activeSlowPct = stackPct(e.activeSlowPct, e.slowUntil, tick, pct);
  e.slowUntil = tick + dur;
}

/** Squared gap from a point to a solid footprint square (0 inside it). */
function footprintGap2(x: number, y: number, s: Solid): number {
  const dx = Math.max(0, Math.abs(x - s.x) - s.r);
  const dy = Math.max(0, Math.abs(y - s.y) - s.r);
  return dx * dx + dy * dy;
}

/**
 * Land one impact spell: enemy units by center distance, buildings and
 * towers/Core when the radius overlaps their footprint. Damage is added to
 * the tick's simultaneous damage map; slows apply immediately.
 */
function resolveImpact(state: CombatState, p: PendingImpact, fighters: Fighter[], hit: (id: string, amount: number) => void): void {
  const def = SPELL_CARDS_V1[p.cardId]!;
  const spec = def.impact!;
  const r2 = def.radius * def.radius;
  let units = 0;
  let buildings = 0;
  let structures = 0;
  for (const u of fighters) {
    if (u.owner === p.owner || u.hp <= 0) continue;
    if (u.kind === "commander" && !spec.hitsCommanders) continue;
    if (u.moveType === "air" ? !spec.hitsAir : !spec.hitsGround) continue;
    if (dist2(u.x, u.y, p.x, p.y) > r2) continue;
    if (spec.unitDamage > 0) hit(u.id, spec.unitDamage);
    if (spec.slowPct > 0) applySlow(u, state.tick, spec.slowPct, spec.slowDurationTicks);
    units += 1;
  }
  if (spec.buildingDamage > 0) {
    for (const b of state.buildings) {
      if (!b.alive || b.owner === p.owner || footprintGap2(p.x, p.y, { x: b.x, y: b.y, r: b.footprint }) > r2) continue;
      hit(b.id, spec.buildingDamage);
      buildings += 1;
    }
  }
  if (spec.structureDamage > 0) {
    for (const s of state.structures) {
      if (!s.alive || s.owner === p.owner || footprintGap2(p.x, p.y, { x: s.x, y: s.y, r: STRUCTURE_FOOTPRINT_V5[s.structure] }) > r2) continue;
      hit(s.id, spec.structureDamage);
      structures += 1;
    }
  }
  state.events.push({ type: "spell_impact", tick: state.tick, player: p.owner, cardId: p.cardId, impactId: p.id, x: p.x, y: p.y, units, buildings, structures });
}

function castSpell(state: CombatState, cmd: DeployCommand, def: SpellCardDef, impactId: string): void {
  if (def.kind === "impact") {
    const impactTick = state.tick + def.impact!.delayTicks;
    state.pendingImpacts.push({ id: impactId, owner: cmd.player, cardId: def.id, x: cmd.x, y: cmd.y, castTick: state.tick, impactTick });
    state.events.push({ type: "spell_cast", tick: state.tick, player: cmd.player, cardId: def.id, x: cmd.x, y: cmd.y, affected: 0 });
    return;
  }
  if (def.kind === "bolt") {
    let affected = 0;
    for (const t of state.troops) {
      if (t.owner === cmd.player || t.hp <= 0) continue;
      if (dist2(t.x, t.y, cmd.x, cmd.y) <= def.radius * def.radius) {
        t.hp -= def.damage;
        affected += 1;
      }
    }
    const dead = state.troops.filter((t) => t.hp <= 0);
    state.troops = state.troops.filter((t) => t.hp > 0);
    for (const d of dead) state.events.push({ type: "death", tick: state.tick, entityId: d.id, owner: d.owner });
    state.events.push({ type: "spell_cast", tick: state.tick, player: cmd.player, cardId: def.id, x: cmd.x, y: cmd.y, affected });
    return;
  }
  let affected = 0;
  for (const t of state.troops) {
    if (t.owner !== cmd.player || t.hp <= 0) continue;
    if (dist2(t.x, t.y, cmd.x, cmd.y) <= def.radius * def.radius) {
      t.buffUntil = state.tick + def.buffDurationTicks;
      t.buffPct = def.buffPct;
      affected += 1;
    }
  }
  state.events.push({ type: "spell_cast", tick: state.tick, player: cmd.player, cardId: def.id, x: cmd.x, y: cmd.y, affected });
}

// Ability magnitude semantics (explicit resolution of B1 fractions):
// buff/haste/slow fractions (0.25 = +25%) convert to integer percent ticks.
function fracToPct(f: number): number {
  return Math.max(0, Math.round(f * 100));
}

function applyAbilityEffect(
  state: CombatState,
  source: CommanderEntity,
  effect: { kind: string; target: string; magnitude: number; radiusOrRange: number | null; durationMs: number | null },
  ticksForMs: (ms: number | null, fallback: number) => number
): number {
  let affected = 0;
  const dur = ticksForMs(effect.durationMs, 0);
  const collectTargets = (): Array<TroopEntity | CommanderEntity> => {
    const out: Array<TroopEntity | CommanderEntity> = [];
    const radius = effect.radiusOrRange ?? 0;
    if (effect.target === "self") return [source];
    const pool: Array<TroopEntity | CommanderEntity> = [...state.troops, ...state.commanders];
    for (const e of pool) {
      if (e.hp <= 0) continue;
      if (effect.target === "allies" && e.owner !== source.owner) continue;
      if ((effect.target === "enemies" || effect.target === "enemiesInRadius") && e.owner === source.owner) continue;
      if (effect.target === "enemies" && dist2(source.x, source.y, e.x, e.y) > source.sight * source.sight) continue;
      if ((effect.target === "allies" || effect.target === "enemiesInRadius") && dist2(source.x, source.y, e.x, e.y) > radius * radius) continue;
      out.push(e);
    }
    return out;
  };
  for (const t of collectTargets()) {
    switch (effect.kind) {
      case "damage":
        t.hp -= Math.max(1, Math.round(effect.magnitude));
        affected += 1;
        break;
      case "heal":
        t.hp = Math.min(t.maxHp, t.hp + Math.round(effect.magnitude));
        affected += 1;
        break;
      case "shield":
        t.shieldHp = Math.round(effect.magnitude);
        t.shieldUntil = state.tick + dur;
        affected += 1;
        break;
      case "slow":
        applySlow(t, state.tick, fracToPct(effect.magnitude), dur);
        affected += 1;
        break;
      case "stun":
        t.stunUntil = state.tick + dur;
        affected += 1;
        break;
      case "haste":
        t.hastePct = stackPct(t.hastePct, t.hasteUntil, state.tick, fracToPct(effect.magnitude));
        t.hasteUntil = state.tick + dur;
        affected += 1;
        break;
      case "cleanse":
        t.slowUntil = 0;
        t.activeSlowPct = 0;
        t.stunUntil = 0;
        affected += 1;
        break;
      case "damageBuff":
        t.buffPct = stackPct(t.buffPct, t.buffUntil, state.tick, fracToPct(effect.magnitude));
        t.buffUntil = state.tick + dur;
        affected += 1;
        break;
      case "damageReflect": {
        const num = Math.round(effect.magnitude * 100);
        t.reflectUntil = state.tick + dur;
        t.reflectFracNumer = num;
        t.reflectFracDenom = 100;
        affected += 1;
        break;
      }
      default:
        throw new AppError("INTERNAL_ERROR", `Unsupported ability effect: ${effect.kind}`);
    }
  }
  return affected;
}

const msToTicks = (ms: number | null, fallback: number) => (ms === null ? fallback : Math.max(1, Math.round(ms / 100)));

function abilityRadius(ability: CommanderAbility): number | null {
  const r = ability.effects.map((e) => e.radiusOrRange ?? 0).filter((x) => x > 0);
  return r.length ? Math.max(...r) : null;
}

/** Existing B2.3 targeting conditions for actives (pure, no mutation). */
function activeConditionError(state: CombatState, commander: CommanderEntity, ability: CommanderAbility): string | null {
  if (ability.cooldownMs !== null && state.tick < (commander.abilityReadyAt[ability.id] ?? 0)) return `Ability on cooldown: ${ability.id}`;
  const needsEnemy = ability.effects.some((e) => e.target === "enemies" || e.target === "enemiesInRadius");
  if (needsEnemy) {
    const radius = abilityRadius(ability) ?? 0;
    const seen = [...state.troops, ...state.commanders].some(
      (e) => e.owner !== commander.owner && e.hp > 0 && dist2(commander.x, commander.y, e.x, e.y) <= radius * radius
    );
    if (!seen) return `No enemies in range for ${ability.id}`;
  }
  if (ability.effects.every((e) => e.target === "self" && (e.kind === "shield" || e.kind === "heal")) && commander.hp >= commander.maxHp) {
    return `No effect to apply for ${ability.id}`;
  }
  return null;
}

/** Execute an ability (conditions already checked by the caller). */
function fireAbilityOn(state: CombatState, commander: CommanderEntity, abilityId: string, seq: number | null = null, energySpent = 0): void {
  const ability = commander.abilities.find((a) => a.id === abilityId);
  if (!ability) throw new AppError("BAD_REQUEST", `Unknown ability: ${abilityId}`);
  let affected = 0;
  for (const effect of ability.effects) affected += applyAbilityEffect(state, commander, effect, msToTicks);
  const readyAt = ability.cooldownMs !== null ? state.tick + msToTicks(ability.cooldownMs, 1) : null;
  if (readyAt !== null) commander.abilityReadyAt[abilityId] = readyAt;
  const activeUntil = ability.durationMs !== null ? state.tick + msToTicks(ability.durationMs, 1) : null;
  if (activeUntil !== null && commander.hp > 0) commander.abilityActiveUntil[abilityId] = activeUntil;
  state.events.push({
    type: "ability_fired",
    tick: state.tick,
    player: commander.owner,
    commanderId: commander.commanderId,
    abilityId,
    trigger: ability.trigger,
    seq,
    energySpent,
    x: commander.x,
    y: commander.y,
    radius: abilityRadius(ability),
    affected,
    readyAt,
    activeUntil,
  });
}

/**
 * Validated player ability command (B2.6b). Rejections throw before any
 * mutation, so an invalid command never spends energy, starts a cooldown,
 * applies effects or records its seq.
 */
function applyAbility(state: CombatState, cmd: AbilityCommand): void {
  if (state.phase === "final") throw new AppError("CONFLICT", "Match already finalized");
  if (state.seenSeqs.includes(cmd.seq)) throw new AppError("CONFLICT", `Duplicate command seq: ${cmd.seq}`);
  if (cmd.tick < state.tick) throw new AppError("UNPROCESSABLE", `Stale command tick ${cmd.tick} < ${state.tick}`);
  if (cmd.player !== 0 && cmd.player !== 1) throw new AppError("BAD_REQUEST", "Invalid player");
  if (cmd.x !== undefined || cmd.y !== undefined) throw new AppError("BAD_REQUEST", "Ability takes no target");
  const commander = state.commanders.find((c) => c.owner === cmd.player && c.hp > 0);
  if (!commander) throw new AppError("UNPROCESSABLE", "No living commander for player");
  const ability = commander.abilities.find((a) => a.id === cmd.abilityId);
  if (!ability) throw new AppError("BAD_REQUEST", `Ability not on commander: ${cmd.abilityId}`);
  if (ability.trigger !== "active") throw new AppError("BAD_REQUEST", `Ability not player-activated: ${cmd.abilityId}`);
  if (state.tick < commander.stunUntil) throw new AppError("UNPROCESSABLE", "Commander stunned");
  const condition = activeConditionError(state, commander, ability);
  if (condition) throw new AppError("UNPROCESSABLE", condition);
  const cost = ABILITY_ACTIVATION_COST_V1[ability.id] ?? 0;
  if (state.energy[cmd.player] < cost) throw new AppError("UNPROCESSABLE", "Insufficient energy");
  state.energy[cmd.player] -= cost;
  state.seenSeqs.push(cmd.seq);
  fireAbilityOn(state, commander, ability.id, cmd.seq, cost);
}

function applyCommand(state: CombatState, cmd: CombatCommand, counter: { n: number }): void {
  if (isAbilityCommand(cmd)) applyAbility(state, cmd);
  else applyDeploy(state, cmd, counter);
}

export interface AbilityStatus {
  abilityId: string;
  cost: number;
  readyAt: number;
  cooldownTicks: number;
  activeUntil: number | null;
  ready: boolean;
  affordable: boolean;
  /** Why activation would be rejected now, or null when it would succeed. */
  blockedBy: string | null;
}

/** Authoritative ability-button state for a player's living commander. */
export function commanderAbilityStatus(state: CombatState, player: PlayerIndex): AbilityStatus[] {
  const c = state.commanders.find((x) => x.owner === player && x.hp > 0);
  if (!c) return [];
  return c.abilities
    .filter((a) => a.trigger === "active")
    .map((a) => {
      const cost = ABILITY_ACTIVATION_COST_V1[a.id] ?? 0;
      const readyAt = c.abilityReadyAt[a.id] ?? 0;
      const ready = state.tick >= readyAt;
      const affordable = state.energy[player] >= cost;
      const blockedBy =
        state.phase === "final" ? "Match already finalized" : state.tick < c.stunUntil ? "Commander stunned" : activeConditionError(state, c, a) ?? (affordable ? null : "Insufficient energy");
      return { abilityId: a.id, cost, readyAt, cooldownTicks: msToTicks(a.cooldownMs, 0), activeUntil: c.abilityActiveUntil[a.id] ?? null, ready, affordable, blockedBy };
    });
}

function chaosEffectDurationMs(effect: ChaosEffect): number {
  return effect.durationMs;
}

function applyChaosActivation(state: CombatState, ev: { family: string; effect: ChaosEffect }, activationTick: number): void {
  const effect = ev.effect;
  const durTicks = Math.max(1, Math.round(effect.durationMs / 100));
  const until = activationTick + durTicks;
  if (effect.kind === "modifier" && effect.stat === "move_speed") {
    state.moveModUntil = until;
    state.moveModPct = effect.multiplierPct;
  } else if (effect.kind === "modifier" && effect.stat === "energy_regen") {
    state.energyModUntil = until;
    state.energyModPct = effect.deltaPct;
  } else if (effect.kind === "zone") {
    // RIFT_SHIFT: the named zone keeps its slowed/hasted speed modifier and
    // the central Rift Ford opens as a real ground crossing for both players.
    state.zoneMods.push({ zone: effect.crossing, modifier: effect.modifier, until });
    state.riftOpenUntil = Math.max(state.riftOpenUntil, until);
    state.events.push({ type: "rift_crossing", tick: state.tick, open: true, until: state.riftOpenUntil });
  } else if (effect.kind === "buff" && effect.stat === "attack") {
    const pct = Math.max(0, effect.multiplierPct - 100);
    for (const t of [...state.troops, ...state.commanders]) {
      if (t.hp <= 0) continue;
      t.buffUntil = until;
      t.buffPct = Math.max(t.buffPct, pct);
    }
  } else if (effect.kind === "buff" && effect.stat === "defense") {
    const pct = Math.max(0, effect.multiplierPct - 100);
    for (const t of [...state.troops, ...state.commanders]) {
      if (t.hp <= 0) continue;
      t.guardUntil = until;
      t.guardPct = Math.max(t.guardPct, pct);
    }
  }
}

function expireChaos(state: CombatState, ev: { family: string; effect: ChaosEffect }): void {
  const effect = ev.effect;
  if (effect.kind === "modifier" && effect.stat === "move_speed") {
    state.moveModUntil = 0;
    state.moveModPct = 100;
  } else if (effect.kind === "modifier" && effect.stat === "energy_regen") {
    state.energyModUntil = 0;
    state.energyModPct = 100;
  } else if (effect.kind === "zone") {
    state.zoneMods = state.zoneMods.filter((z) => z.until > state.tick);
    // Ford closes; units still on it walk out to their goal-side bank.
    if (state.riftOpenUntil <= state.tick) {
      state.riftOpenUntil = 0;
      state.events.push({ type: "rift_crossing", tick: state.tick, open: false, until: 0 });
    }
  }
}

// Overtime-expiry tiebreak (pure, deterministic). Order: towers alive,
// then surviving tower HP, then Core HP, then draw. Exported so the exact
// production path is directly testable.
export function resolveOvertimeTiebreak(state: CombatState): PlayerIndex | "draw" {
  const alive = (o: PlayerIndex) => state.structures.filter((s) => s.structure === "tower" && s.owner === o && s.alive);
  const t0 = alive(0);
  const t1 = alive(1);
  if (t0.length !== t1.length) return t0.length > t1.length ? 0 : 1;
  const hp = (list: typeof t0) => list.reduce((n, s) => n + s.hp, 0);
  if (hp(t0) !== hp(t1)) return hp(t0) > hp(t1) ? 0 : 1;
  const c0 = state.structures.find((s) => s.structure === "core" && s.owner === 0);
  const c1 = state.structures.find((s) => s.structure === "core" && s.owner === 1);
  if (c0 && c1 && c0.hp !== c1.hp) return c0.hp > c1.hp ? 0 : 1;
  return "draw";
}

// Single-tick stepper for harnesses and tests. Same deterministic path as
// runMatch; entity ids continue from the per-match counter in state
// (v5: no module-global state, so stepped and runMatch replays agree).
export function stepMatch(state: CombatState, commands: CombatCommand[] = []): void {
  // Canonical (tick, seq) order, identical to runMatch.
  const due = commands.filter((c) => c.tick <= state.tick + 1).sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  const counter = { n: state.nextEntityId };
  advanceOneTick(state, due, counter);
  state.nextEntityId = counter.n;
}

function advanceOneTick(state: CombatState, due: CombatCommand[], counter: { n: number }): void {
  if (state.phase === "final") return;
  state.tick += 1;
  // Energy economy: phase multiplier (1x/2x/3x by tick) composed with the
  // active Chaos modifier (order: phase first, then chaos percent).
  // Exact integer schedule: each tick accrues phaseMult * chaosPct progress
  // against a 2800-per-energy threshold, so 1x/2x/3x yield exactly 1/2/3
  // energy per 28 ticks (3x lands on a 10,9,9 repeating cadence averaging
  // exactly 28/3 ticks). Remainders carry across ticks and phase
  // transitions; capping only pauses accrual, never destroys progress.
  const phaseMult = energyPhaseMult(state.tick);
  const chaosPct = state.tick < state.energyModUntil ? state.energyModPct : 100;
  const step = phaseMult * chaosPct;
  for (const p of [0, 1] as PlayerIndex[]) {
    if (state.energy[p] < ENERGY_V1.max) {
      state.energyProgress[p] += step;
      while (state.energyProgress[p] >= ENERGY_V1.regenTicksPerPoint * 100 && state.energy[p] < ENERGY_V1.max) {
        state.energyProgress[p] -= ENERGY_V1.regenTicksPerPoint * 100;
        state.energy[p] += 1;
      }
    }
  }
  // Ability windows and cooldowns resolve at the start of the tick they end,
  // before commands, so a command on the ready tick follows its ready event.
  for (const c of state.commanders) {
    for (const ability of c.abilities) {
      const until = c.abilityActiveUntil[ability.id];
      if (until !== undefined && state.tick >= until) {
        delete c.abilityActiveUntil[ability.id];
        state.events.push({ type: "ability_expired", tick: state.tick, player: c.owner, commanderId: c.commanderId, abilityId: ability.id, reason: "duration" });
      }
      if (ability.trigger === "active" && c.abilityReadyAt[ability.id] === state.tick) {
        state.events.push({ type: "ability_ready", tick: state.tick, player: c.owner, commanderId: c.commanderId, abilityId: ability.id, cost: ABILITY_ACTIVATION_COST_V1[ability.id] ?? 0 });
      }
    }
  }
  // v8 building expiry runs before commands, movement and attacks, so an
  // expired building neither attracts nor blocks anything this tick, and an
  // expiry always wins over same-tick damage (stable priority).
  for (const b of state.buildings) {
    if (b.alive && state.tick >= b.expiresAt) {
      b.alive = false;
      state.events.push({ type: "building_removed", tick: state.tick, buildingId: b.id, owner: b.owner, cardId: b.cardId, reason: "expired" });
    }
  }
  state.buildings = state.buildings.filter((b) => b.alive);
  for (const cmd of due) {
    try {
      applyCommand(state, cmd, counter);
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "rejected";
      state.events.push(
        isAbilityCommand(cmd)
          ? { type: "command_rejected", tick: state.tick, seq: cmd.seq, reason, player: cmd.player, abilityId: String(cmd.abilityId).slice(0, 60) }
          : { type: "command_rejected", tick: state.tick, seq: cmd.seq, reason }
      );
    }
  }
  // Movement + targeting (troops and commanders; stunned units hold still).
  // v4: ground units follow river-aware routes; with nothing in sight they
  // march on their current lane toward the lane tower, then the Core.
  const fighters: Fighter[] = [...state.troops, ...state.commanders];
  const open = riftOpen(state);
  // v5: footprints of structures alive at movement time are solid.
  const solids = [...solidsOf(state.structures), ...buildingSolids(state.buildings)];
  const advance = (u: TroopEntity | CommanderEntity, target: CombatTarget | null) => {
    const speed = combatSpeed(u, state.tick, state);
    const lane = target ? null : laneObjective(u, state.structures);
    const goal = target ?? (lane ? asTarget(lane) : null);
    u.targetId = goal ? goal.id : null;
    if (!goal) {
      u.moveCarry = 0;
      return;
    }
    const inRange = () => reach2(u.x, u.y, goal) <= u.range * u.range;
    if (inRange()) {
      u.moveCarry = 0;
      return;
    }
    u.moveCarry = moveUnit(u, approachPoint(u, goal), speed, open, solids, u.moveCarry, inRange);
  };
  for (const t of state.troops) {
    if (t.hp <= 0 || state.tick < t.stunUntil) continue;
    advance(t, acquireTarget(t, state));
  }
  for (const c of state.commanders) {
    if (c.hp <= 0 || state.tick < c.stunUntil) continue;
    advance(c, pickCommanderTarget(c, state.troops, state.commanders, [...state.structures, ...state.buildings], c.preference, open));
  }
  // Simultaneous attacks.
  const byId = new Map<string, TroopEntity | CommanderEntity | StructureEntity | BuildingEntity>();
  for (const t of state.troops) byId.set(t.id, t);
  for (const c of state.commanders) byId.set(c.id, c);
  for (const s of state.structures) byId.set(s.id, s);
  for (const b of state.buildings) byId.set(b.id, b);
  const damage = new Map<string, number>();
  const hit = (id: string, amount: number) => damage.set(id, (damage.get(id) ?? 0) + amount);
  // Projectile arrivals resolve before new attacks (deterministic order).
  const arrivals = state.projectiles.filter((p) => p.arrivalTick <= state.tick);
  state.projectiles = state.projectiles.filter((p) => p.arrivalTick > state.tick);
  const splashHits: Array<{ x: number; y: number; owner: PlayerIndex; damage: number; radius: number; primaryId: string }> = [];
  for (const p of arrivals) {
    const tgt = byId.get(p.targetId);
    const live = tgt && (tgt.kind === "troop" || tgt.kind === "commander") && (tgt as TroopEntity | CommanderEntity).hp > 0;
    const ix = live ? (tgt as TroopEntity | CommanderEntity).x : p.snapX;
    const iy = live ? (tgt as TroopEntity | CommanderEntity).y : p.snapY;
    splashHits.push({ x: ix, y: iy, owner: p.owner, damage: p.damage, radius: p.splashRadius, primaryId: p.targetId });
  }
  for (const t of fighters) {
    if (t.hp <= 0 || state.tick < t.cooldownUntil || state.tick < t.stunUntil) continue;
    const tgt = t.targetId ? byId.get(t.targetId) : null;
    if (!tgt) continue;
    const alive = tgt.kind === "troop" || tgt.kind === "commander" ? (tgt as TroopEntity).hp > 0 : (tgt as StructureEntity).alive;
    if (!alive) continue;
    if (t.owner !== tgt.owner && reach2(t.x, t.y, asTarget(tgt)) <= t.range * t.range) {
      const dmg = combatDamage(t, state.tick);
      if (t.projectileTicks > 0) {
        counter.n += 1;
        state.projectiles.push({
          id: `p${counter.n}`,
          owner: t.owner,
          targetId: tgt.id,
          snapX: tgt.x,
          snapY: tgt.y,
          damage: dmg,
          splashRadius: t.splashRadius,
          arrivalTick: state.tick + t.projectileTicks,
        });
      } else {
        hit(tgt.id, dmg);
        if (t.slowDurationTicks > 0 && (tgt.kind === "troop" || tgt.kind === "commander")) {
          const st = tgt as TroopEntity;
          applySlow(st, state.tick, t.slowPct, t.slowDurationTicks);
        }
        if (t.splashRadius > 0) {
          splashHits.push({ x: tgt.x, y: tgt.y, owner: t.owner, damage: dmg, radius: t.splashRadius, primaryId: tgt.id });
        }
        if ((tgt.kind === "troop" || tgt.kind === "commander") && state.tick < (tgt as TroopEntity).reflectUntil) {
          const rt = tgt as TroopEntity;
          hit(t.id, Math.floor((dmg * rt.reflectFracNumer) / rt.reflectFracDenom));
        }
      }
      t.cooldownUntil = state.tick + t.interval;
    }
  }
  for (const s of splashHits) {
    for (const t of fighters) {
      if (t.owner === s.owner || t.hp <= 0 || t.id === s.primaryId) continue;
      if (dist2(t.x, t.y, s.x, s.y) <= s.radius * s.radius) hit(t.id, s.damage);
    }
    const primary = byId.get(s.primaryId);
    if (primary) hit(primary.id, s.damage);
  }
  for (const s of state.structures) {
    if (!s.alive) continue;
    const def = STRUCTURE_V1[s.structure];
    if (state.tick % def.intervalTicks !== 0) continue;
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const t of fighters) {
      if (t.owner === s.owner || t.hp <= 0) continue;
      const d = dist2(s.x, s.y, t.x, t.y);
      if (d <= def.range * def.range && (d < bestD || (d === bestD && best !== null && t.id < best.id))) {
        bestD = d;
        best = t;
      }
    }
    if (best) hit(best.id, def.damage);
  }
  // v8 Rift Sentry fire: per-building cooldown (first shot at activeAt),
  // keeps its current target while it stays hittable and in range, else the
  // nearest hittable enemy unit by center distance, ties by id.
  for (const b of state.buildings) {
    if (!b.alive || b.damage <= 0 || state.tick < b.cooldownUntil) continue;
    const valid = (t: Fighter) => t.owner !== b.owner && t.hp > 0 && hittable(b, t) && dist2(b.x, b.y, t.x, t.y) <= b.range * b.range;
    let target = b.targetId ? fighters.find((t) => t.id === b.targetId && valid(t)) ?? null : null;
    if (!target) {
      let bestD = Infinity;
      for (const t of fighters) {
        if (!valid(t)) continue;
        const d = dist2(b.x, b.y, t.x, t.y);
        if (d < bestD || (d === bestD && target !== null && t.id < target.id)) {
          bestD = d;
          target = t;
        }
      }
    }
    b.targetId = target ? target.id : null;
    if (target) {
      hit(target.id, b.damage);
      b.cooldownUntil = state.tick + b.interval;
    }
  }
  // v9 impact spells land after attacks are collected and before damage
  // resolves, sharing the one simultaneous damage pass (shields/armor,
  // building death, crowns, Core victory, sudden death). Cast order breaks
  // ties only for event order; damage is summed, so order never matters.
  const landing = state.pendingImpacts.filter((p) => p.impactTick <= state.tick);
  state.pendingImpacts = state.pendingImpacts.filter((p) => p.impactTick > state.tick);
  for (const p of landing) resolveImpact(state, p, fighters, hit);
  const eventsBeforeDamage = state.events.length;
  const absorbDamage = (ent: TroopEntity | CommanderEntity, amount: number): number => {
    let rem = amount;
    if (state.tick < ent.shieldUntil && ent.shieldHp > 0) {
      const absorbed = Math.min(ent.shieldHp, rem);
      ent.shieldHp -= absorbed;
      rem -= absorbed;
    }
    if (rem > 0 && state.tick < ent.guardUntil) rem = Math.floor((rem * (100 - ent.guardPct)) / 100);
    if (rem > 0 && ent.armor > 0) rem = Math.max(1, rem - ent.armor);
    ent.hp -= rem;
    return rem;
  };
  for (const [id, amount] of damage) {
    const ent = byId.get(id);
    if (!ent) continue;
    if (ent.kind === "troop" || ent.kind === "commander") {
      absorbDamage(ent as TroopEntity | CommanderEntity, amount);
    } else if (ent.kind === "building") {
      const b = ent as BuildingEntity;
      if (b.alive) {
        b.hp -= amount;
        if (b.hp <= 0) {
          b.hp = 0;
          b.alive = false;
          state.events.push({ type: "building_removed", tick: state.tick, buildingId: b.id, owner: b.owner, cardId: b.cardId, reason: "destroyed" });
        }
      }
    } else {
      const st = ent as StructureEntity;
      if (st.alive) {
        st.hp -= amount;
        if (st.hp <= 0) {
          st.hp = 0;
          st.alive = false;
          // Authoritative crown: +1 to the destroyer per enemy tower.
          // Fires once (alive flag), so double-counting is impossible.
          if (st.structure === "tower") state.crowns[st.owner === 0 ? 1 : 0] += 1;
          state.events.push({ type: "structure_destroyed", tick: state.tick, entityId: st.id, owner: st.owner, structure: st.structure });
        }
      }
    }
  }
  // Destroyed buildings leave no rubble: entity and footprint are removed now.
  state.buildings = state.buildings.filter((b) => b.alive);
  const deadTroops = state.troops.filter((t) => t.hp <= 0);
  state.troops = state.troops.filter((t) => t.hp > 0);
  for (const d of deadTroops) state.events.push({ type: "death", tick: state.tick, entityId: d.id, owner: d.owner });
  const deadCommanders = state.commanders.filter((c) => c.hp <= 0);
  state.commanders = state.commanders.filter((c) => c.hp > 0);
  for (const d of deadCommanders) {
    state.events.push({ type: "death", tick: state.tick, entityId: d.id, owner: d.owner });
    // Open ability windows end with the commander (statuses die with it).
    for (const id of Object.keys(d.abilityActiveUntil).sort()) {
      state.events.push({ type: "ability_expired", tick: state.tick, player: d.owner, commanderId: d.commanderId, abilityId: id, reason: "death" });
    }
    d.abilityActiveUntil = {};
    for (const ability of d.abilities) {
      if (ability.trigger === "onDeath") fireAbilityOn(state, d, ability.id);
    }
  }
  // v7: no active auto-fire. Actives run only from player ability commands
  // (applyAbility, earlier in the tick).
  // Chaos Pulse execution from the immutable B1.4b schedule.
  if (state.chaos) {
    const { schedule } = state.chaos;
    schedule.events.forEach((ev, i) => {
      const activationTick = Math.round(ev.activationMs / 100);
      if (!state.chaos!.warned[i] && state.tick >= activationTick - 50) {
        state.chaos!.warned[i] = true;
        state.events.push({ type: "pulse_warning", tick: state.tick, eventId: ev.id, family: ev.family, activationTick });
      }
      if (!state.chaos!.active[i] && state.tick >= activationTick) {
        state.chaos!.active[i] = true;
        applyChaosActivation(state, ev, activationTick);
        state.events.push({ type: "pulse_active", tick: state.tick, eventId: ev.id, family: ev.family });
      }
      const durTicks = Math.max(1, Math.round(chaosEffectDurationMs(ev.effect) / 100));
      if (state.chaos!.active[i] && !state.chaos!.expired[i] && state.tick >= activationTick + durTicks) {
        state.chaos!.expired[i] = true;
        expireChaos(state, ev);
        state.events.push({ type: "pulse_expired", tick: state.tick, eventId: ev.id, family: ev.family });
      }
    });
    for (let i = 0; i < schedule.events.length; i++) {
      const ev = schedule.events[i] as (typeof schedule.events)[number];
      if (!state.chaos!.active[i] || state.chaos!.expired[i] || ev.family !== "ember_rift") continue;
      const fx = ev.effect as { kind: string; dps?: number };
      if (fx.kind !== "hazard") continue;
      const perTick = Math.max(1, Math.round(((fx.dps ?? 0) as number) / 10));
      for (const t of [...state.troops, ...state.commanders]) {
        if (t.owner !== 0 && t.owner !== 1) continue;
        if (t.hp <= 0) continue;
        if (!(ev.zones as string[]).includes(zoneOf(t.y))) continue;
        hit(t.id, perTick);
      }
    }
  }
  // Victory / lifecycle (ranked rules v2).
  // Crowns: +1 per enemy tower destroyed, Core kill = instant 3-crown win.
  // Regulation end: crown lead wins now; tie goes to sudden-death overtime.
  // Overtime: first tower destruction wins; expiry falls back to the tower
  // health tiebreak (towers alive, then tower HP, then Core HP, then draw).
  const core0 = state.structures.find((s) => s.structure === "core" && s.owner === 0);
  const core1 = state.structures.find((s) => s.structure === "core" && s.owner === 1);
  const c0Dead = !core0?.alive;
  const c1Dead = !core1?.alive;
  const finish = (winner: PlayerIndex | "draw", reason: "core" | "crowns" | "overtime" | "timeout") => {
    // Only a Core kill crowns the winner at 3; all other wins keep earned crowns.
    if (reason === "core" && winner !== "draw") state.crowns[winner] = 3;
    if (reason === "core" && winner === "draw") state.crowns = [3, 3];
    state.phase = "final";
    state.winner = winner;
    state.endReason = reason;
    state.events.push({ type: "match_end", tick: state.tick, winner, reason, crowns: [...state.crowns] as [number, number] });
  };
  const towerKillThisTick = (owner: PlayerIndex): boolean =>
    state.events
      .slice(eventsBeforeDamage)
      .some((e) => e.type === "structure_destroyed" && e.structure === "tower" && e.owner !== owner);
  if (c0Dead && c1Dead) {
    return finish("draw", "core");
  }
  if (c0Dead) return finish(1, "core");
  if (c1Dead) return finish(0, "core");
  if (state.phase === "overtime") {
    if (towerKillThisTick(0)) return finish(0, "overtime");
    if (towerKillThisTick(1)) return finish(1, "overtime");
  }
  if (state.phase === "active" && state.tick >= COMBAT_TIMELINE_V1.durationTicks) {
    if (state.crowns[0] !== state.crowns[1]) {
      return finish(state.crowns[0] > state.crowns[1] ? 0 : 1, "crowns");
    }
    state.phase = "overtime";
  } else if (state.phase === "overtime") {
    if (state.tick >= COMBAT_TIMELINE_V1.durationTicks + COMBAT_TIMELINE_V1.overtimeTicks) {
      const winner = resolveOvertimeTiebreak(state);
      return finish(winner, "timeout");
    }
  }
}

export function stateHash(state: CombatState): string {
  return createHash("sha256")
    .update(
      `combat:${COMBAT_RULESET_VERSION}:${stableStringify({
        tick: state.tick,
        phase: state.phase,
        energy: state.energy,
        hands: state.hands,
        queues: state.queues,
        troops: [...state.troops].sort((a, b) => (a.id < b.id ? -1 : 1)),
        projectiles: [...state.projectiles].sort((a, b) => (a.id < b.id ? -1 : 1)),
        commanders: [...state.commanders].sort((a, b) => (a.id < b.id ? -1 : 1)),
        chaos: state.chaos ? { warned: state.chaos.warned, active: state.chaos.active, expired: state.chaos.expired, mods: [state.moveModUntil, state.moveModPct, state.energyModUntil, state.energyModPct, state.zoneMods, state.riftOpenUntil] } : null,
        structures: [...state.structures].sort((a, b) => (a.id < b.id ? -1 : 1)),
        buildings: [...state.buildings].sort((a, b) => (a.id < b.id ? -1 : 1)),
        pendingImpacts: state.pendingImpacts,
        winner: state.winner,
        crowns: state.crowns,
      })}`
    )
    .digest("hex");
}

export interface RunResult {
  winner: PlayerIndex | "draw" | null;
  endReason: "core" | "crowns" | "overtime" | "timeout" | null;
  crowns: [number, number];
  ticks: number;
  events: number;
  stateHash: string;
  structuresAlive: number;
  troopsAlive: number;
}

// Advance a match to termination (or tick cap). Commands must be
// pre-sorted; same inputs always yield the same result.
export function runMatch(config: CombatConfig, commands: CombatCommand[], maxTicks?: number): { state: CombatState; result: RunResult } {
  const state = initMatch(config);
  const counter = { n: state.nextEntityId };
  const sorted = [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  const cap = maxTicks ?? COMBAT_TIMELINE_V1.durationTicks + COMBAT_TIMELINE_V1.overtimeTicks + 10;
  let ci = 0;
  while (state.phase !== "final" && state.tick < cap) {
    const due: CombatCommand[] = [];
    while (ci < sorted.length && sorted[ci]!.tick <= state.tick + 1) {
      due.push(sorted[ci]!);
      ci += 1;
    }
    advanceOneTick(state, due, counter);
  }
  while (ci < sorted.length && state.phase !== "final") {
    const cmd = sorted[ci]!;
    ci += 1;
    try {
      applyCommand(state, cmd, counter);
    } catch {
      break;
    }
  }
  state.nextEntityId = counter.n;
  return {
    state,
    result: {
      winner: state.winner,
      endReason: state.endReason,
      crowns: [...state.crowns] as [number, number],
      ticks: state.tick,
      events: state.events.length,
      stateHash: stateHash(state),
      structuresAlive: state.structures.filter((s) => s.alive).length,
      troopsAlive: state.troops.length,
    },
  };
}

export function combatRulesetSummary() {
  return {
    version: COMBAT_RULESET_VERSION,
    ticksPerSecond: TICKS_PER_SECOND,
    timeline: { ...COMBAT_TIMELINE_V1 },
    arena: {
      version: ARENA_VERSION,
      minX: ARENA_V2.minX,
      maxX: ARENA_V2.maxX,
      minY: ARENA_V2.minY,
      maxY: ARENA_V2.maxY,
      midY: ARENA_V2.midY,
      laneSplitX: ARENA_V2.laneSplitX,
      river: ARENA_V2.river,
      bridges: ARENA_V2.bridges,
      riftFord: ARENA_V2.riftFord,
      riftRegion: ARENA_V2.riftRegion,
      deployment: "troops: own side x 5..95 (p0 y 0..73, p1 y 87..160), never river/bridge; pocket after enemy lane tower falls: lane half x 5..49 / 51..95, p0 y 87..106, p1 y 54..73; spells: anywhere in arena",
      navigation: "ground: octile routes (straight 10, diagonal 14) via left/right bridge (+ Rift Ford while RIFT_SHIFT active), recomputed each tick, ties -> smallest lateral detour then left>right>rift; cell-by-cell movement with budget speed*10 and carried remainder; deterministic ring-corner detours around live structure footprints; air: straight line over river and footprints",
      targeting: "enemy troops, enemy commanders and structures; in sight + engageable; in-range first by reach, else ground route cost (air distance); in-range lock until death/out of range; no target -> lane tower then Core",
      footprints: "live tower half-size 3, core half-size 4 (solid for ground, rubble when destroyed); structure reach measured to footprint ring; no deploys within 2 cells of a live footprint",
    },
    energy: { ...ENERGY_V1, phases: "1x/2x/3x yield exactly 1/2/3 energy per 28 ticks via remainder-preserving accumulator; chaos mods compose after the phase rate" },
    scoring: {
      crowns: "tower +1, core = instant 3-crown win; regulation crown lead wins at tick 1800; tie enters sudden-death overtime",
      overtime: "first tower destruction wins; expiry tiebreak: towers alive, then tower HP, then Core HP, then draw",
    },
    cards: Object.values(CARDS_V1),
    troops: Object.values(TROOP_CARDS_V1),
    spells: Object.values(SPELL_CARDS_V1),
    spellRules: {
      targeting: "any point inside the arena; enemy-only, never friendly fire; each entity hit at most once per cast",
      chaos_bolt: "instant, enemy troops only (ground + air), never commanders, buildings or structures",
      rally_horn: "instant, friendly troops only, override stacking",
      chaos_comet: "lands 6 ticks after cast in that tick's damage pass: 140 to enemy troops (ground + air) and commanders (shields/armor apply), 140 to enemy buildings, 42 to enemy towers/Core when the radius overlaps their footprint; crowns, Core win and sudden death follow the normal damage path",
      rift_snare: "lands the cast tick: 25 to enemy troops and commanders (ground + air) plus 40% slow for 50 ticks; no building/structure effect",
      statusStacking: "slow/haste/damage buff: strongest active percent wins, each application refreshes the end tick, expired statuses reset; slow composes after haste and before Chaos move/zone modifiers",
    },
    structures: STRUCTURE_V1,
    buildings: {
      cards: Object.values(BUILDING_CARDS_V1),
      rules: BUILDING_RULES_V1,
      placement:
        "center and all footprint corners pass troop territory rules (own side or open pocket, x 5..95, no river/bridge, not within 2 of a live footprint, which leaves 2 free cells between footprints); footprint+1 never touches the crossingMouthRows beside either bank over any crossing span (left, right, Rift Ford); no living ground unit inside; at most maxLivePerPlayer live per player",
      targeting:
        "enemy buildings join towers/Core in the structure pool (in sight, ranked by reach); structure-priority units prefer them when nearer; others take them only with no enemy unit in sight; air units can hit them; Sentry hits ground only",
      lifecycle:
        "deploy event + building_spawned; Sentry first shot at activeAt (spawn + deployTicks), then every attackIntervalTicks; expiry at the start of tick expiresAt (before commands, movement and attacks, so it beats same-tick damage); destruction at damage resolution; both emit building_removed and remove entity + footprint immediately; never award crowns",
      immunities: "Chaos Pulses, Chaos Bolt, Rally Horn and commander abilities never affect buildings (unchanged unit-only rules); troop splash hits only the primary building",
    },
    playableCards: Object.keys(CARDS_V1),
    commanders: {
      slots: 1,
      entitlement: "trusted-server-input (B3 verifies ownership/lease; engine never re-checks wallets); snapshot must carry the exact B1 roster abilities for its class; free ids must name their class",
      deck: "exactly 7 distinct ordinary cards + 1 commander card `cmdr:<commanderId>` matching the snapshot",
      deploy: "from hand only, pays profile cost, same territory/pocket/river/footprint rules as troops; no tick-0 spawn; one living commander per player",
      cycle: "played card -> queue tail after drawing the head; while the commander lives its card is skipped at the queue head (moved to tail), so the hand never holds it; drawable again after death",
      profile: { version: COMMANDER_PROFILE_VERSION, stats: COMMANDER_COMBAT_PROFILE_V1, abilityOverrides: ABILITY_RUNTIME_V1 },
      statMapping: "class-keyed runtime profile; B1 stats, sidegrade variant and Tier never affect combat (free == NFT per class)",
      triggers: "deploy on deploy, onDeath on death (automatic); the five actives fire only from validated player ability commands, never automatically",
    },
    abilities: {
      version: ABILITY_ECONOMY_VERSION,
      command: "{ kind: 'ability', seq, player, tick, abilityId } (no x/y: all five actives are self-centered on the authoritative commander position; a supplied target is rejected)",
      activationCost: ABILITY_ACTIVATION_COST_V1,
      validation: "match active, unique seq, not stale, living deployed commander owned by player, ability on that commander and trigger=active, not stunned, cooldown elapsed, B2.3 targeting condition (enemy within ability radius for volley/null field; aegis needs missing HP), energy >= cost; rejection mutates nothing except a command_rejected event",
      cooldowns: "ticks = round(cooldownMs/100); ready on deploy; cooldown starts on the activation tick; redeploy spawns a fresh entity with fresh cooldowns; death cancels open windows",
      ordering: "commands apply in (tick, seq) order before movement/combat; activation then death in the same tick keeps the applied effects; a dead commander cannot activate",
      events: "ability_fired (trigger, seq, energySpent, center, radius, affected, readyAt, activeUntil), ability_ready, ability_expired (duration|death), command_rejected with abilityId",
    },
    chaos: {
      ticks: "activationMs/100, warning 50 ticks prior",
      zones: "north y>=107, center 53..106, south y<=52",
      dpsResolution: "per-tick max(1, round(dps/10))",
    },
    statuses: {
      slow: "refresh duration, strongest pct wins, fully reverts on expiry",
      buff: "override on recast, fully reverts on expiry, troops only",
    },
    deferred: [],
    compatibility: "v8 adds building cards, state.buildings (hashed) and building events; decks without buildings simulate as in v7 apart from the version in the hash domain; v7 configs are rejected by validation. v7 differs from v6 only in commander actives (command-driven, energy-costed) and ability events; v6 configs are rejected by validation. v6 configs differ from v5 (decks require a commander card; commanders spawn only by deploy; ids c<player>-<n>); v5 configs are rejected by validation. No persisted replays of earlier versions exist (pre-release, headless fixtures only)",
  };
}
