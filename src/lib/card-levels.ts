// P2c server-authoritative card stat scaling, policy v1. Pure: no engine,
// DB or server imports (combat imports this, never the reverse). TEST
// provisional numbers, not approved balance.
//
// One primary profile per ordinary card. Tanks scale HP, damage attackers
// scale damage, buff spells scale their magnitude. Everything else is
// pinned: energy costs, range, sight, speed, attack cadence, targeting,
// durations, radii, counts, slow/root percentages, commander stats and
// tower/Core stats never move. Spawned units never scale.
//
// Math is integer-safe and anchored to the canonical base every time:
// scaled = round_half_up(base * (100 + rate*(level-1)) / 100). Levels are
// clamped to 1..10, anything else (or unknown/commander ids) resolves to
// base stats, so Level 1 exactly equals the current combat baseline.
export const CARD_LEVEL_POLICY_VERSION = 1;
export const CARD_LEVEL_MIN = 1;
export const CARD_LEVEL_MAX = 10;

/** Percent per level above 1. */
export const HP_SCALE_PCT = 4;
export const DAMAGE_SCALE_PCT = 3;
export const BUFF_SCALE_PCT = 3;

export type LevelProfile = "tank-hp" | "damage" | "buff";

/**
 * The real card-to-profile mapping from the authored v1 roster:
 * - boulderback, frostshell, chog_guardian: front-line bodies (HP)
 * - decoy_totem, chog_burrow: damage 0 / no attack, only HP can scale
 * - rift_sentry: ground turret whose role is damage (damage)
 * - rift_mortar: siege damage via its shell (damage)
 * - every ordinary troop attacker incl. fast fliers: damage
 * - chaos_bolt, chaos_comet, rift_snare: spell damage numbers
 * - rally_horn: its buff magnitude is the card's only scalable number
 *
 * Deliberately unscaled (reported limitations): integer cell speeds (a
 * +1%/level curve never crosses an integer within 10 levels), slow/root
 * percentages, vs-ground/vs-building role percentages, splash/shockwave
 * radii, unit counts, spawn waves and scrapper stats, all durations and
 * cadences, commander stats, tower/Core stats.
 */
export const CARD_LEVEL_PROFILES: Record<string, LevelProfile> = {
  choglings: "damage",
  chaos_archer: "damage",
  boulderback: "tank-hp",
  frostshell: "tank-hp",
  rift_runner: "damage",
  sparkcaster: "damage",
  chog_guardian: "tank-hp",
  hexwing: "damage",
  rift_sprites: "damage",
  gale_netter: "damage",
  riftbreaker: "damage",
  ember_mauler: "damage",
  chaos_bolt: "damage",
  rally_horn: "buff",
  chaos_comet: "damage",
  rift_snare: "damage",
  rift_sentry: "damage",
  decoy_totem: "tank-hp",
  chog_burrow: "tank-hp",
  rift_mortar: "damage",
};

/** Clamp to a usable level; anything invalid means baseline. */
export function clampCardLevel(level: unknown): number {
  return Number.isInteger(level) && (level as number) >= CARD_LEVEL_MIN && (level as number) <= CARD_LEVEL_MAX
    ? (level as number)
    : CARD_LEVEL_MIN;
}

/** Integer-safe round-half-up of base * (100 + rate*(level-1)) / 100. */
export function scaledStat(base: number, ratePct: number, level: number): number {
  const lv = clampCardLevel(level);
  if (lv === CARD_LEVEL_MIN) return base;
  return Math.max(0, Math.floor((base * (100 + ratePct * (lv - 1)) + 50) / 100));
}

/** Levels frozen at match start, indexed by seat then card id. Absent cards and seats resolve to Level 1. */
export type CardLevels = [Record<string, number>, Record<string, number>];

export function levelFor(levels: CardLevels | undefined | null, seat: 0 | 1, cardId: string): number {
  const raw = levels?.[seat]?.[cardId];
  return clampCardLevel(raw);
}

/** Troop combat numbers for a card at a level. Speed never scales. */
export function troopStatsFor(cardId: string, base: { hp: number; damage: number }, level: number): { hp: number; damage: number } {
  const profile = CARD_LEVEL_PROFILES[cardId];
  const lv = clampCardLevel(level);
  if (lv === CARD_LEVEL_MIN || profile === undefined) return { hp: base.hp, damage: base.damage };
  if (profile === "tank-hp") return { hp: scaledStat(base.hp, HP_SCALE_PCT, lv), damage: base.damage };
  return { hp: base.hp, damage: scaledStat(base.damage, DAMAGE_SCALE_PCT, lv) };
}

/** Building combat numbers for a card at a level. */
export function buildingStatsFor(
  cardId: string,
  base: { hp: number; damage: number },
  level: number
): { hp: number; damage: number } {
  const profile = CARD_LEVEL_PROFILES[cardId];
  const lv = clampCardLevel(level);
  if (lv === CARD_LEVEL_MIN || profile === undefined) return { hp: base.hp, damage: base.damage };
  if (profile === "tank-hp") return { hp: scaledStat(base.hp, HP_SCALE_PCT, lv), damage: base.damage };
  return { hp: base.hp, damage: scaledStat(base.damage, DAMAGE_SCALE_PCT, lv) };
}

/** Siege shell damage numbers for a card at a level (mortar role). */
export function shellDamageFor(
  cardId: string,
  base: { unitDamage: number; buildingDamage: number; structureDamage: number },
  level: number
): { unitDamage: number; buildingDamage: number; structureDamage: number } {
  const lv = clampCardLevel(level);
  if (lv === CARD_LEVEL_MIN || CARD_LEVEL_PROFILES[cardId] === undefined) return { ...base };
  return {
    unitDamage: scaledStat(base.unitDamage, DAMAGE_SCALE_PCT, lv),
    buildingDamage: scaledStat(base.buildingDamage, DAMAGE_SCALE_PCT, lv),
    structureDamage: scaledStat(base.structureDamage, DAMAGE_SCALE_PCT, lv),
  };
}

/** Spell magnitudes for a card at a level. Radii, slows and durations stay pinned. */
export function spellMagnitudeFor(
  cardId: string,
  base: { damage: number; buffPct: number; unitDamage: number; buildingDamage: number; structureDamage: number },
  level: number
): { damage: number; buffPct: number; unitDamage: number; buildingDamage: number; structureDamage: number } {
  const profile = CARD_LEVEL_PROFILES[cardId];
  const lv = clampCardLevel(level);
  if (lv === CARD_LEVEL_MIN || profile === undefined) return { ...base };
  if (profile === "buff") return { ...base, buffPct: scaledStat(base.buffPct, BUFF_SCALE_PCT, lv) };
  return {
    ...base,
    damage: scaledStat(base.damage, DAMAGE_SCALE_PCT, lv),
    unitDamage: scaledStat(base.unitDamage, DAMAGE_SCALE_PCT, lv),
    buildingDamage: scaledStat(base.buildingDamage, DAMAGE_SCALE_PCT, lv),
    structureDamage: scaledStat(base.structureDamage, DAMAGE_SCALE_PCT, lv),
  };
}
