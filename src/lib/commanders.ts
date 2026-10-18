// Commander ruleset v1: deterministic, metadata-driven commander derivation.
//
// Separation of concerns (never mix these layers):
//   A. Real onchain traits: the `attributesOriginal` preserved verbatim from
//      NFT metadata. This engine READS them, never rewrites them.
//   B. Authored gameplay rules: the versioned tables below (CLASS_ROSTER,
//      SIGNAL_RULES, BASE_STATS, ABILITY_ROSTER, POWER_BUDGET). These are game
//      design, not onchain facts.
//   C. Calculated results: CommanderDefinition. Game-generated values; never
//      present them as onchain NFT metadata.
//
// Fairness invariants (non-negotiable, enforced by tests):
//   - Every class (and every free starter template) scores within POWER_BUDGET
//     tolerance of the same mean power score. No class is ranked-stronger.
//   - Tier affects prestige/presentation ONLY. Same attributes + different
//     Tier produce identical stats, abilities, and power score.
//   - Token ID identifies the NFT. It never influences stats, class, or
//     abilities: same attributes + different token ID = identical commander.
//   - Trait sidegrades are zero-sum tradeoffs inside the class budget, never
//     net power gains.

import { createHash } from "crypto";

export const COMMANDER_RULESET_VERSION = "v1" as const;

export const COMMANDER_CLASSES = ["bulwark", "reaver", "deadeye", "scout", "warden"] as const;
export type CommanderClass = (typeof COMMANDER_CLASSES)[number];

// Fixed tie-break precedence. First entry wins ties, so class selection is
// fully deterministic regardless of input ordering.
export const CLASS_PRECEDENCE: CommanderClass[] = ["bulwark", "reaver", "deadeye", "scout", "warden"];

// ---------------------------------------------------------------------------
// Typed stat + ability model (what B2 consumes)
// ---------------------------------------------------------------------------

export interface CommanderStats {
  health: number;
  damage: number;
  attackIntervalMs: number;
  range: number;
  moveSpeed: number;
  energyCost: number;
  /** Preferred target category for the B2 engine. */
  targetPreference: "closest" | "strongest" | "weakest" | "commander";
  armor: number;
  /** Damage per second, derived, rounded to 2dp. */
  dps: number;
}

export type AbilityTrigger = "active" | "deploy" | "onDeath";
export type EffectKind =
  | "damage"
  | "heal"
  | "shield"
  | "slow"
  | "stun"
  | "haste"
  | "cleanse"
  | "damageBuff"
  | "damageReflect";
export type EffectTarget = "self" | "allies" | "enemies" | "enemiesInRadius";

export interface AbilityEffect {
  kind: EffectKind;
  target: EffectTarget;
  /** Primary magnitude: damage/heal/shield points, or buff fraction (0.25 = +25%), or slow fraction. */
  magnitude: number;
  radiusOrRange: number | null;
  durationMs: number | null;
}

export interface CommanderAbility {
  id: string;
  name: string;
  trigger: AbilityTrigger;
  cooldownMs: number | null;
  durationMs: number | null;
  effects: AbilityEffect[];
}

// ---------------------------------------------------------------------------
// Authored class roster (game design, versioned under ruleset v1)
// ---------------------------------------------------------------------------

export interface ClassProfile {
  class: CommanderClass;
  role: string;
  strengths: string[];
  weaknesses: string[];
  counters: CommanderClass[];
  counteredBy: CommanderClass[];
  baseStats: Omit<CommanderStats, "dps">;
  abilities: CommanderAbility[];
}

function dpsOf(s: Omit<CommanderStats, "dps">): number {
  return Math.round((s.damage / (s.attackIntervalMs / 1000)) * 100) / 100;
}

function stats(base: Omit<CommanderStats, "dps">): CommanderStats {
  return { ...base, dps: dpsOf(base) };
}

export const CLASS_ROSTER: Record<CommanderClass, ClassProfile> = {
  bulwark: {
    class: "bulwark",
    role: "Tank / frontline anchor. Holds ground, absorbs pressure, protects damage dealers.",
    strengths: ["Highest health pool", "Armor reduces incoming damage", "Long shield uptime"],
    weaknesses: ["Lowest damage output", "Short melee range", "Slow movement"],
    counters: ["reaver", "scout"],
    counteredBy: ["deadeye", "warden"],
    baseStats: {
      health: 1400, damage: 90, attackIntervalMs: 1400, range: 1,
      moveSpeed: 2.2, energyCost: 5, targetPreference: "closest", armor: 3,
    },
    abilities: [
      {
        id: "bulwark-aegis-wall", name: "Aegis Wall", trigger: "active",
        cooldownMs: 22000, durationMs: 4000,
        effects: [{ kind: "shield", target: "self", magnitude: 420, radiusOrRange: null, durationMs: 4000 }],
      },
      {
        id: "bulwark-bedrock", name: "Bedrock Stance", trigger: "deploy",
        cooldownMs: null, durationMs: 6000,
        effects: [{ kind: "damageReflect", target: "self", magnitude: 0.2, radiusOrRange: null, durationMs: 6000 }],
      },
    ],
  },
  reaver: {
    class: "reaver",
    role: "Bruiser / melee brawler. Dives the frontline and trades damage up close.",
    strengths: ["Highest melee DPS", "Frenzy windows punish slow decks", "Fast for a melee unit"],
    weaknesses: ["Exposed at range", "Frenzy downtime is punishable", "No self-sustain"],
    counters: ["deadeye", "warden"],
    counteredBy: ["bulwark", "scout"],
    baseStats: {
      health: 1100, damage: 130, attackIntervalMs: 1200, range: 1,
      moveSpeed: 2.8, energyCost: 5, targetPreference: "closest", armor: 1,
    },
    abilities: [
      {
        id: "reaver-frenzy-rush", name: "Frenzy Rush", trigger: "active",
        cooldownMs: 20000, durationMs: 5000,
        effects: [
          { kind: "haste", target: "self", magnitude: 0.3, radiusOrRange: null, durationMs: 5000 },
          { kind: "damageBuff", target: "self", magnitude: 0.25, radiusOrRange: null, durationMs: 5000 },
        ],
      },
      {
        id: "reaver-bloodlust", name: "Bloodlust", trigger: "onDeath",
        cooldownMs: null, durationMs: null,
        effects: [{ kind: "damage", target: "enemiesInRadius", magnitude: 150, radiusOrRange: 2, durationMs: null }],
      },
    ],
  },
  deadeye: {
    class: "deadeye",
    role: "Ranged specialist. Controls space from distance, weak when cornered.",
    strengths: ["Longest attack range", "Burst volley deletes supports", "Kites melee"],
    weaknesses: ["Fragile if reached", "Slow attack cadence", "Volley has long cooldown"],
    counters: ["bulwark", "warden"],
    counteredBy: ["reaver", "scout"],
    baseStats: {
      health: 800, damage: 110, attackIntervalMs: 1500, range: 5,
      moveSpeed: 2.4, energyCost: 5, targetPreference: "strongest", armor: 0,
    },
    abilities: [
      {
        id: "deadeye-piercing-volley", name: "Piercing Volley", trigger: "active",
        cooldownMs: 18000, durationMs: null,
        effects: [{ kind: "damage", target: "enemiesInRadius", magnitude: 260, radiusOrRange: 5, durationMs: null }],
      },
      {
        id: "deadeye-overwatch", name: "Overwatch", trigger: "deploy",
        cooldownMs: null, durationMs: 8000,
        effects: [{ kind: "damageBuff", target: "self", magnitude: 0.15, radiusOrRange: null, durationMs: 8000 }],
      },
    ],
  },
  scout: {
    class: "scout",
    role: "Mobility / skirmisher. Fastest unit, raids and repositions, wins on tempo.",
    strengths: ["Fastest movement", "Fastest attack cadence", "Cheapest deployment"],
    weaknesses: ["Low health", "Short range", "Loses straight trades"],
    counters: ["reaver", "deadeye"],
    counteredBy: ["bulwark", "warden"],
    baseStats: {
      health: 850, damage: 95, attackIntervalMs: 1000, range: 2,
      moveSpeed: 3.6, energyCost: 4, targetPreference: "weakest", armor: 0,
    },
    abilities: [
      {
        id: "scout-shadow-step", name: "Shadow Step", trigger: "active",
        cooldownMs: 16000, durationMs: 3000,
        effects: [
          { kind: "haste", target: "self", magnitude: 0.5, radiusOrRange: null, durationMs: 3000 },
          { kind: "cleanse", target: "self", magnitude: 1, radiusOrRange: null, durationMs: null },
        ],
      },
      {
        id: "scout-pathfinder", name: "Pathfinder", trigger: "deploy",
        cooldownMs: null, durationMs: 5000,
        effects: [{ kind: "haste", target: "allies", magnitude: 0.15, radiusOrRange: 4, durationMs: 5000 }],
      },
    ],
  },
  warden: {
    class: "warden",
    role: "Support / control. Slows and disrupts enemies while shielding itself.",
    strengths: ["AoE slow controls tempo", "Self-shield wins attrition", "Punishes divers"],
    weaknesses: ["Lowest raw DPS", "Longest ability cooldown", "Needs time to grind value"],
    counters: ["scout", "bulwark"],
    counteredBy: ["reaver", "deadeye"],
    baseStats: {
      health: 1050, damage: 85, attackIntervalMs: 1300, range: 3,
      moveSpeed: 2.5, energyCost: 5, targetPreference: "closest", armor: 1,
    },
    abilities: [
      {
        id: "warden-null-field", name: "Null Field", trigger: "active",
        cooldownMs: 24000, durationMs: 4000,
        effects: [
          { kind: "slow", target: "enemiesInRadius", magnitude: 0.4, radiusOrRange: 3, durationMs: 4000 },
          { kind: "shield", target: "self", magnitude: 220, radiusOrRange: null, durationMs: 4000 },
        ],
      },
      {
        id: "warden-mend", name: "Mend", trigger: "deploy",
        cooldownMs: null, durationMs: null,
        effects: [{ kind: "heal", target: "self", magnitude: 180, radiusOrRange: null, durationMs: null }],
      },
    ],
  },
};

// Shared competitive power budget. Score formula is public and auditable;
// the invariant test asserts every class lands within tolerance of the mean.
export const POWER_BUDGET = {
  meanTarget: 520,
  /** Max relative deviation of any class base score from the class mean. */
  classTolerance: 0.08,
  /** Max relative deviation of a sidegrade variant from its class base. */
  variantTolerance: 0.1,
} as const;

export function powerScore(s: CommanderStats): number {
  return s.health * 0.4 + s.dps * 3 + s.range * 45 + s.moveSpeed * 15 - s.energyCost * 60;
}

// ---------------------------------------------------------------------------
// Trait-to-class signal rules (explicit v1 taxonomy over OBSERVED values)
//
// Built from the live trait catalog (Background/Base/Body/Eyes/Form/Head/
// Mouth/Skin/Tier/Aura/Accessory/Side/Naked). Matching is case-insensitive
// substring so minor metadata spelling variants resolve identically.
// Trait types with no gameplay meaning (Background) are documented cosmetic.
// Missing, unknown, or unsupported values score 0: neutral fallback.
// ---------------------------------------------------------------------------

interface SignalRule {
  traitType: string;
  /** Lowercase substring to match against the trait value. */
  match: string;
  class: CommanderClass;
  weight: number;
  reason: string;
}

export const SIGNAL_RULES: SignalRule[] = [
  // Eyes: optics determine engagement style.
  { traitType: "Eyes", match: "laser", class: "deadeye", weight: 3, reason: "Laser optics mark precision ranged attackers" },
  { traitType: "Eyes", match: "visor", class: "deadeye", weight: 2, reason: "Visors mark ranged targeting gear" },
  { traitType: "Eyes", match: "glass", class: "scout", weight: 2, reason: "Lenses mark recon and target acquisition" },
  { traitType: "Eyes", match: "crying", class: "warden", weight: 2, reason: "Weeping eyes mark attrition and endurance casting" },
  { traitType: "Eyes", match: "tear", class: "warden", weight: 2, reason: "Tears mark attrition and endurance casting" },
  { traitType: "Eyes", match: "teary", class: "warden", weight: 2, reason: "Tears mark attrition and endurance casting" },
  { traitType: "Eyes", match: "dead", class: "reaver", weight: 2, reason: "Dead eyes mark fearless melee aggression" },
  { traitType: "Eyes", match: "angry", class: "reaver", weight: 2, reason: "Anger marks melee aggression" },
  { traitType: "Eyes", match: "happy", class: "reaver", weight: 1, reason: "Eager eyes lean toward aggressive brawling" },
  { traitType: "Eyes", match: "heart", class: "reaver", weight: 1, reason: "Zeal leans toward aggressive brawling" },
  { traitType: "Eyes", match: "smirk", class: "scout", weight: 1, reason: "Smug looks mark skirmishers" },
  { traitType: "Eyes", match: "tired", class: "bulwark", weight: 1, reason: "Heavy-lidded eyes mark stoic line-holders" },
  { traitType: "Eyes", match: "side eye", class: "scout", weight: 1, reason: "Wary glances mark skirmish awareness" },
  { traitType: "Eyes", match: "clown", class: "warden", weight: 1, reason: "Clownish looks mark disruption and misdirection" },
  { traitType: "Eyes", match: "mog", class: "bulwark", weight: 1, reason: "Dominant stare marks frontline presence" },
  { traitType: "Eyes", match: "plasma", class: "deadeye", weight: 2, reason: "Plasma optics mark energy ranged attacks" },
  { traitType: "Eyes", match: "round", class: "scout", weight: 1, reason: "Wide eyes mark alert skirmishers" },
  { traitType: "Eyes", match: "normal", class: "bulwark", weight: 1, reason: "Steady eyes mark dependable line-holders" },
  { traitType: "Eyes", match: "vertical", class: "scout", weight: 1, reason: "Unusual gaze marks elusive skirmishers" },
  // Aura: present auras are energy affinity (control or firepower).
  { traitType: "Aura", match: "fiery", class: "reaver", weight: 2, reason: "Burning auras feed melee ferocity" },
  { traitType: "Aura", match: "burning", class: "reaver", weight: 2, reason: "Burning auras feed melee ferocity" },
  { traitType: "Aura", match: "fire", class: "reaver", weight: 2, reason: "Fire affinity feeds melee ferocity" },
  { traitType: "Aura", match: "electric", class: "deadeye", weight: 2, reason: "Electric aura marks volatile ranged energy" },
  { traitType: "Aura", match: "royal", class: "warden", weight: 2, reason: "Royal auras mark commanding control presence" },
  { traitType: "Aura", match: "rose", class: "warden", weight: 1, reason: "Soft auras mark supportive control" },
  { traitType: "Aura", match: "cool", class: "bulwark", weight: 1, reason: "Cool auras mark composed defenders" },
  { traitType: "Aura", match: "aqua", class: "warden", weight: 1, reason: "Watery auras mark fluid control" },
  { traitType: "Aura", match: "mint", class: "scout", weight: 1, reason: "Fresh auras mark swift skirmishers" },
  { traitType: "Aura", match: "wind", class: "scout", weight: 2, reason: "Wind affinity marks mobility" },
  { traitType: "Aura", match: "smoke", class: "scout", weight: 1, reason: "Smoke marks elusive skirmishers" },
  { traitType: "Aura", match: "clean", class: "bulwark", weight: 1, reason: "Clean aura marks disciplined defenders" },
  { traitType: "Aura", match: "violet", class: "deadeye", weight: 1, reason: "Charged hues mark ranged energy" },
  { traitType: "Aura", match: "purple", class: "deadeye", weight: 1, reason: "Charged hues mark ranged energy" },
  { traitType: "Aura", match: "yellow", class: "deadeye", weight: 1, reason: "Charged hues mark ranged energy" },
  { traitType: "Aura", match: "pink", class: "warden", weight: 1, reason: "Soft auras mark supportive control" },
  { traitType: "Aura", match: "white", class: "bulwark", weight: 1, reason: "Pure aura marks stalwart defenders" },
  { traitType: "Aura", match: "green", class: "warden", weight: 1, reason: "Verdant aura marks restorative control" },
  { traitType: "Aura", match: "blue", class: "warden", weight: 1, reason: "Deep hues mark steady control" },
  // Body: garments determine battlefield role.
  { traitType: "Body", match: "suit", class: "bulwark", weight: 2, reason: "Tailored suits mark armored frontline dress" },
  { traitType: "Body", match: "tuxedo", class: "bulwark", weight: 2, reason: "Formal armor marks frontline dress" },
  { traitType: "Body", match: "tux", class: "bulwark", weight: 2, reason: "Formal armor marks frontline dress" },
  { traitType: "Body", match: "robe", class: "bulwark", weight: 2, reason: "Heavy robes mark line-holding bulk" },
  { traitType: "Body", match: "guard", class: "bulwark", weight: 3, reason: "Guard uniforms are literal frontline gear" },
  { traitType: "Body", match: "astro", class: "bulwark", weight: 2, reason: "Sealed suits mark heavy protection" },
  { traitType: "Body", match: "wizard", class: "warden", weight: 3, reason: "Wizard garb marks control casting" },
  { traitType: "Body", match: "hoodie", class: "scout", weight: 2, reason: "Streetwear marks fast skirmishers" },
  { traitType: "Body", match: "trackset", class: "scout", weight: 2, reason: "Tracksuits mark runners" },
  { traitType: "Body", match: "shirt", class: "scout", weight: 1, reason: "Light shirts mark mobile skirmishers" },
  { traitType: "Body", match: "polo", class: "scout", weight: 1, reason: "Light shirts mark mobile skirmishers" },
  { traitType: "Body", match: "jersey", class: "scout", weight: 1, reason: "Sportswear marks runners" },
  { traitType: "Body", match: "dragon", class: "reaver", weight: 2, reason: "Beast garb marks ferocious brawlers" },
  { traitType: "Body", match: "fire", class: "reaver", weight: 2, reason: "Flame motifs mark aggression" },
  { traitType: "Body", match: "gangster", class: "reaver", weight: 2, reason: "Enforcer dress marks brawlers" },
  { traitType: "Body", match: "inmate", class: "reaver", weight: 2, reason: "Hardened dress marks brawlers" },
  { traitType: "Body", match: "banana", class: "reaver", weight: 1, reason: "Absurdist bulk marks chaotic brawlers" },
  { traitType: "Body", match: "chug", class: "reaver", weight: 1, reason: "Rowdy dress marks brawlers" },
  { traitType: "Body", match: "chinese", class: "deadeye", weight: 1, reason: "Disciplined dress marks precise strikers" },
  { traitType: "Body", match: "yukata", class: "warden", weight: 1, reason: "Ceremonial dress marks composed casters" },
  { traitType: "Body", match: "stripes", class: "scout", weight: 1, reason: "Sporty stripes mark runners" },
  { traitType: "Body", match: "farmer", class: "bulwark", weight: 1, reason: "Workwear marks sturdy line-holders" },
  { traitType: "Body", match: "hawaiian", class: "warden", weight: 1, reason: "Easygoing dress marks unhurried control" },
  { traitType: "Body", match: "cwo", class: "deadeye", weight: 1, reason: "Uniformed dress marks disciplined strikers" },
  { traitType: "Body", match: "milf lover", class: "reaver", weight: 1, reason: "Rowdy dress marks brawlers" },
  // Head: headgear signals battlefield posture.
  { traitType: "Head", match: "helmet", class: "bulwark", weight: 3, reason: "Helmets are literal armor" },
  { traitType: "Head", match: "crown", class: "warden", weight: 3, reason: "Crowns mark commanding control" },
  { traitType: "Head", match: "wizard", class: "warden", weight: 3, reason: "Wizard hats mark control casting" },
  { traitType: "Head", match: "cap", class: "bulwark", weight: 1, reason: "Team caps mark organized line-holders" },
  { traitType: "Head", match: "bucket", class: "scout", weight: 2, reason: "Bucket hats mark outdoorsy skirmishers" },
  { traitType: "Head", match: "headband", class: "scout", weight: 2, reason: "Headbands mark runners" },
  { traitType: "Head", match: "hair", class: "scout", weight: 1, reason: "Flowing hair marks unencumbered skirmishers" },
  { traitType: "Head", match: "hat", class: "bulwark", weight: 1, reason: "Sturdy hats mark line-holders" },
  { traitType: "Head", match: "durag", class: "scout", weight: 1, reason: "Street headwear marks skirmishers" },
  { traitType: "Head", match: "plumber", class: "bulwark", weight: 1, reason: "Work headwear marks sturdy holders" },
  { traitType: "Head", match: "clown", class: "warden", weight: 1, reason: "Clown gear marks disruption" },
  { traitType: "Head", match: "horny", class: "reaver", weight: 1, reason: "Provocative gear marks reckless brawlers" },
  { traitType: "Head", match: "boob", class: "reaver", weight: 1, reason: "Provocative gear marks reckless brawlers" },
  { traitType: "Head", match: "peace", class: "warden", weight: 1, reason: "Peace motifs mark composed control" },
  { traitType: "Head", match: "thunder", class: "deadeye", weight: 1, reason: "Storm motifs mark striking power" },
  { traitType: "Head", match: "star", class: "deadeye", weight: 1, reason: "Show motifs mark precise strikers" },
  { traitType: "Head", match: "dollar", class: "deadeye", weight: 1, reason: "High-roller gear marks calculated strikers" },
  { traitType: "Head", match: "btc", class: "deadeye", weight: 1, reason: "High-roller gear marks calculated strikers" },
  { traitType: "Head", match: "cloud", class: "scout", weight: 1, reason: "Airy motifs mark elusive skirmishers" },
  { traitType: "Head", match: "retard", class: "reaver", weight: 1, reason: "Chaotic caps mark reckless brawlers" },
  { traitType: "Head", match: "mmga", class: "reaver", weight: 1, reason: "Abrasive caps mark brawlers" },
  { traitType: "Head", match: "tism", class: "warden", weight: 1, reason: "Idiosyncratic caps mark unconventional control" },
  { traitType: "Head", match: "mon cap", class: "bulwark", weight: 1, reason: "Team caps mark organized line-holders" },
  { traitType: "Head", match: "balls", class: "reaver", weight: 1, reason: "Brash caps mark reckless brawlers" },
  // Mouth: expression sets temperament.
  { traitType: "Mouth", match: "grit", class: "bulwark", weight: 2, reason: "Gritted teeth mark stoic defenders" },
  { traitType: "Mouth", match: "gold tooth", class: "reaver", weight: 2, reason: "Gold teeth mark hardened brawlers" },
  { traitType: "Mouth", match: "coin", class: "reaver", weight: 2, reason: "Coin mouths mark high-stakes brawlers" },
  { traitType: "Mouth", match: "smile", class: "reaver", weight: 1, reason: "Grins lean toward confident brawling" },
  { traitType: "Mouth", match: "smirk", class: "scout", weight: 1, reason: "Smirks mark cocky skirmishers" },
  { traitType: "Mouth", match: "bubblegum", class: "warden", weight: 2, reason: "Bubblegum marks disarming disruption" },
  { traitType: "Mouth", match: "puke", class: "warden", weight: 2, reason: "Noxious mouths mark disruption" },
  { traitType: "Mouth", match: "drooling", class: "warden", weight: 1, reason: "Unkempt mouths mark chaotic control" },
  { traitType: "Mouth", match: "sad", class: "bulwark", weight: 1, reason: "Grim mouths mark enduring defenders" },
  { traitType: "Mouth", match: "worried", class: "bulwark", weight: 1, reason: "Tense mouths mark braced defenders" },
  { traitType: "Mouth", match: "flat", class: "bulwark", weight: 1, reason: "Flat mouths mark impassive holders" },
  { traitType: "Mouth", match: "lip bite", class: "scout", weight: 1, reason: "Tense focus marks skirmishers" },
  { traitType: "Mouth", match: "clown", class: "warden", weight: 1, reason: "Clown mouths mark disruption" },
  { traitType: "Mouth", match: "wo", class: "scout", weight: 1, reason: "Surprised mouths mark reactive skirmishers" },
  // Skin: material determines durability vs agility.
  { traitType: "Skin", match: "metal", class: "bulwark", weight: 3, reason: "Metal skin is literal armor" },
  { traitType: "Skin", match: "black", class: "reaver", weight: 1, reason: "Dark hides mark intimidating brawlers" },
  { traitType: "Skin", match: "red", class: "reaver", weight: 1, reason: "Blood hues mark aggression" },
  { traitType: "Skin", match: "grey", class: "bulwark", weight: 1, reason: "Stone hues mark sturdy holders" },
  { traitType: "Skin", match: "blue", class: "warden", weight: 1, reason: "Cool hues mark composed control" },
  { traitType: "Skin", match: "green", class: "warden", weight: 1, reason: "Verdant hues mark restorative control" },
  { traitType: "Skin", match: "white", class: "deadeye", weight: 1, reason: "Pale precision marks cold strikers" },
  { traitType: "Skin", match: "beige", class: "scout", weight: 1, reason: "Plain hides mark unremarkable skirmishers" },
  // Form / Base: body plan sets the chassis.
  { traitType: "Form", match: "skull", class: "reaver", weight: 3, reason: "Skull form marks fearless melee" },
  { traitType: "Base", match: "skull", class: "reaver", weight: 3, reason: "Skull base marks fearless melee" },
  { traitType: "Base", match: "radioactive", class: "deadeye", weight: 3, reason: "Radioactive base marks volatile ranged energy" },
  // Accessory: carried objects grant utility lean.
  { traitType: "Accessory", match: "knife", class: "reaver", weight: 3, reason: "A blade marks close-quarters intent" },
  { traitType: "Accessory", match: "candle", class: "warden", weight: 2, reason: "Candles mark ritual control" },
  { traitType: "Accessory", match: "cigar", class: "bulwark", weight: 1, reason: "Cigars mark unflappable holders" },
  { traitType: "Accessory", match: "coin", class: "deadeye", weight: 1, reason: "Coins mark calculated strikers" },
  { traitType: "Accessory", match: "heart", class: "warden", weight: 1, reason: "Hearts mark supportive lean" },
  { traitType: "Accessory", match: "fwog", class: "scout", weight: 1, reason: "Companions mark nimble skirmishers" },
  { traitType: "Accessory", match: "pepe", class: "scout", weight: 1, reason: "Companions mark nimble skirmishers" },
  { traitType: "Accessory", match: "sb", class: "scout", weight: 1, reason: "Street tags mark skirmishers" },
  // Side: tiny tiebreak lean, never decisive alone.
  { traitType: "Side", match: "right", class: "reaver", weight: 0.5, reason: "Right-facing stance leans assault" },
  { traitType: "Side", match: "left", class: "bulwark", weight: 0.5, reason: "Left-facing stance leans guard" },
  // Naked: unencumbered bodies move fast.
  { traitType: "Naked", match: "yes", class: "scout", weight: 2, reason: "Unencumbered bodies mark runners" },
];

// Trait types that are cosmetic only: read for presentation, never scored.
export const COSMETIC_TRAIT_TYPES = ["Background"] as const;

// Observed prestige tiers. Gameplay-neutral by design: any tier value not
// seen here still resolves, labeled with its raw value, zero stat effect.
export const KNOWN_TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const;

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface NftAttribute {
  trait_type: string;
  value: string | number;
}

export interface TraitSignal {
  traitType: string;
  traitValue: string;
  matchedRule: string;
  class: CommanderClass;
  weight: number;
  reason: string;
}

export interface CommanderDefinition {
  rulesetVersion: typeof COMMANDER_RULESET_VERSION;
  class: CommanderClass;
  /** Runner-up class: flavor and matchup hint only, never stats. */
  affinity: CommanderClass;
  scores: Record<CommanderClass, number>;
  signals: TraitSignal[];
  /** Observed trait values no rule matched (plus cosmetic types). Monitoring data, not errors. */
  unmatchedTraits: Array<{ traitType: string; traitValue: string; cosmetic: boolean }>;
  stats: CommanderStats;
  abilities: CommanderAbility[];
  /** Zero-sum variant name within the class budget (e.g. assault/bastion/swift/focused/balanced). */
  variant: string;
  /** Tier label for prestige/presentation. Gameplay-neutral. */
  prestige: string;
  powerScore: number;
  /** Canonical input fingerprint: sha256 of sorted traits + ruleset version. */
  derivationHash: string;
}

export interface FreeCommanderTemplate {
  id: string;
  name: string;
  class: CommanderClass;
  stats: CommanderStats;
  abilities: CommanderAbility[];
  powerScore: number;
  rulesetVersion: typeof COMMANDER_RULESET_VERSION;
}

export function canonicalTraitString(attributes: NftAttribute[]): string {
  const pairs = attributes.map((a) => `${String(a.trait_type)}=${String(a.value)}`);
  pairs.sort();
  return pairs.join("|");
}

export function derivationHashFor(attributes: NftAttribute[]): string {
  return createHash("sha256")
    .update(`${COMMANDER_RULESET_VERSION}:${canonicalTraitString(attributes)}`)
    .digest("hex");
}

// Gameplay-relevant fingerprint: Tier (prestige) and cosmetic types are
// excluded, so prestige-only differences can never change class, stats,
// abilities, or variant. This is what seeds sidegrade selection.

function zeroScores(): Record<CommanderClass, number> {
  return { bulwark: 0, reaver: 0, deadeye: 0, scout: 0, warden: 0 };
}

const SIDEGRADE_AXES = ["assault", "bastion", "swift", "focused", "balanced"] as const;

/** Zero-sum stat tradeoff inside the class budget. Net power drift is bounded by variantTolerance. */
function applySidegrade(base: CommanderStats, axis: string): CommanderStats {
  const out = { ...base };
  switch (axis) {
    case "assault": // +6% damage, -6% health
      out.damage = Math.round(base.damage * 1.06);
      out.health = Math.round(base.health * 0.94);
      break;
    case "bastion": // +6% health, -6% damage
      out.health = Math.round(base.health * 1.06);
      out.damage = Math.round(base.damage * 0.94);
      break;
    case "swift": // +8% speed, -5% health
      out.moveSpeed = Math.round(base.moveSpeed * 1.08 * 100) / 100;
      out.health = Math.round(base.health * 0.95);
      break;
    case "focused": // +1 range-side tradeoff: +4% damage, -1 armor floor 0, -3% health
      out.damage = Math.round(base.damage * 1.04);
      out.armor = Math.max(0, base.armor - 1);
      out.health = Math.round(base.health * 0.97);
      break;
    case "balanced": // no change
    default:
      break;
  }
  return { ...out, dps: dpsOf(out) };
}

export function deriveCommander(input: {
  attributes: NftAttribute[];
}): CommanderDefinition {
  const { attributes } = input;
  const scores = zeroScores();
  const signals: TraitSignal[] = [];
  const unmatched: CommanderDefinition["unmatchedTraits"] = [];

  // Stable rule order: iterate attributes in canonical (sorted) order so
  // signal arrays are deterministic regardless of metadata key order.
  const sorted = [...attributes].sort((a, b) =>
    String(a.trait_type).localeCompare(String(b.trait_type))
  );

  for (const attr of sorted) {
    const traitType = String(attr.trait_type);
    const traitValue = String(attr.value);
    if ((COSMETIC_TRAIT_TYPES as readonly string[]).includes(traitType)) {
      unmatched.push({ traitType, traitValue, cosmetic: true });
      continue;
    }
    if (traitType === "Tier") continue; // prestige handled separately, never scored
    const lowered = traitValue.toLowerCase();
    let matched = false;
    for (const rule of SIGNAL_RULES) {
      if (rule.traitType !== traitType) continue;
      if (!lowered.includes(rule.match)) continue;
      scores[rule.class] += rule.weight;
      signals.push({
        traitType, traitValue,
        matchedRule: `${rule.traitType}~${rule.match}`,
        class: rule.class, weight: rule.weight, reason: rule.reason,
      });
      matched = true;
    }
    if (!matched) unmatched.push({ traitType, traitValue, cosmetic: false });
  }

  // Class selection: highest score, ties broken by fixed precedence.
  let selected: CommanderClass = CLASS_PRECEDENCE[0];
  for (const c of CLASS_PRECEDENCE) {
    if (scores[c] > scores[selected]) selected = c;
  }
  // Affinity: runner-up by the same precedence order (never equals class
  // unless every score is zero, in which case affinity defaults to scout).
  let affinity: CommanderClass = selected === "scout" ? "warden" : "scout";
  for (const c of CLASS_PRECEDENCE) {
    if (c === selected) continue;
    if (scores[c] > scores[affinity] || (scores[c] === scores[affinity] && affinity === (selected === "scout" ? "warden" : "scout") && scores[c] > 0)) {
      affinity = c;
    }
  }
  // Simpler deterministic runner-up: highest score excluding selected, precedence tiebreak.
  let best = -1;
  affinity = CLASS_PRECEDENCE.find((c) => c !== selected) ?? "scout";
  for (const c of CLASS_PRECEDENCE) {
    if (c === selected) continue;
    if (scores[c] > best) {
      best = scores[c];
      affinity = c;
    }
  }

  // Sidegrade axis: deterministic from the gameplay fingerprint (uniform,
  // stable). NOTE: hash-derived, never tokenId-derived; token ID is
  // identity only. Tier and cosmetic traits are excluded from the seed.
  const hash = derivationHashFor(attributes);
  const gameplayAttrs = attributes.filter(
    (a) =>
      String(a.trait_type) !== "Tier" &&
      !(COSMETIC_TRAIT_TYPES as readonly string[]).includes(String(a.trait_type))
  );
  const gameplayHash = createHash("sha256")
    .update(`${COMMANDER_RULESET_VERSION}:${canonicalTraitString(gameplayAttrs)}`)
    .digest("hex");
  const axisIndex = parseInt(gameplayHash.slice(0, 8), 16) % SIDEGRADE_AXES.length;
  const variant = SIDEGRADE_AXES[axisIndex] ?? "balanced";

  const profile = CLASS_ROSTER[selected];
  const finalStats = applySidegrade(stats(profile.baseStats), variant);

  const tierAttr = attributes.find((a) => String(a.trait_type) === "Tier");
  const prestige = tierAttr ? String(tierAttr.value) : "Unknown";

  return {
    rulesetVersion: COMMANDER_RULESET_VERSION,
    class: selected,
    affinity,
    scores,
    signals,
    unmatchedTraits: unmatched,
    stats: finalStats,
    abilities: profile.abilities,
    variant,
    prestige,
    powerScore: Math.round(powerScore(finalStats) * 100) / 100,
    derivationHash: hash,
  };
}

// ---------------------------------------------------------------------------
// Free starter templates: same budget, same ability shapes, no NFT required.
// Genuine gameplay options: identical base stats to their NFT class peers.
// ---------------------------------------------------------------------------

const FREE_NAMES: Record<CommanderClass, string> = {
  bulwark: "Oathbound Recruit",
  reaver: "Ashen Recruit",
  deadeye: "Longshot Recruit",
  scout: "Fleet Recruit",
  warden: "Lantern Recruit",
};

export function freeCommanderTemplates(): FreeCommanderTemplate[] {
  return COMMANDER_CLASSES.map((c) => {
    const profile = CLASS_ROSTER[c];
    const s = stats(profile.baseStats);
    return {
      id: `free-${c}`,
      name: FREE_NAMES[c],
      class: c,
      stats: s,
      abilities: profile.abilities,
      powerScore: Math.round(powerScore(s) * 100) / 100,
      rulesetVersion: COMMANDER_RULESET_VERSION,
    };
  });
}

export function rulesetSummary() {
  const classes = COMMANDER_CLASSES.map((c) => {
    const p = CLASS_ROSTER[c];
    const s = stats(p.baseStats);
    return {
      class: p.class,
      role: p.role,
      strengths: p.strengths,
      weaknesses: p.weaknesses,
      counters: p.counters,
      counteredBy: p.counteredBy,
      baseStats: s,
      abilities: p.abilities,
      powerScore: Math.round(powerScore(s) * 100) / 100,
    };
  });
  return {
    version: COMMANDER_RULESET_VERSION,
    classes,
    powerBudget: POWER_BUDGET,
    signalRuleCount: SIGNAL_RULES.length,
    cosmeticTraitTypes: COSMETIC_TRAIT_TYPES,
    knownTiers: KNOWN_TIERS,
    fairnessNotes: [
      "Tier affects prestige and presentation only; it never changes stats, abilities, or power score.",
      "Token ID identifies the NFT; it never influences class, stats, or abilities.",
      "Trait sidegrades are zero-sum tradeoffs inside the class power budget.",
      "Background traits are cosmetic only.",
      "Unknown or missing traits fall back to neutral (score 0) and are reported, never invented.",
      "Ranked balance is a design target enforced by budget invariants, not a proven claim; empirical balance requires B2/B3 playtesting.",
    ],
  };
}
