// Chaos Pulse rule engine (B1.4b, ruleset v1).
//
// A Chaos Pulse is an announced battlefield event whose properties derive
// from a real Arena Patron's authentic traits. Schedules are pure functions
// of (patron config, server seed): no Math.random, integer milliseconds,
// reproducible forever from immutable inputs. All effects are symmetrical:
// they apply to both players or all units equally, carry no ownership data,
// and Tier only names the pulse, never scales it (fairness by construction).
//
// B2 consumes the typed effect payloads; nothing here executes combat.

import { createHash } from "crypto";
import { AppError } from "@/lib/errors";
import type { PatronConfig, PatronTheme } from "@/lib/patrons";

export const CHAOS_RULESET_VERSION = "v1" as const;

export const CHAOS_FAMILIES = [
  "ember_rift",
  "frost_crossing",
  "energy_surge",
  "rift_shift",
  "chaos_rally",
] as const;
export type ChaosFamily = (typeof CHAOS_FAMILIES)[number];

export const ARENA_ZONES = ["north", "center", "south"] as const;
export type ArenaZone = (typeof ARENA_ZONES)[number];

// Versioned match timeline (integer milliseconds). B3 may introduce new
// timeline presets in a future ruleset version; v1 accepts no custom timings
// so clients cannot manipulate ranked battlefield conditions.
export const CHAOS_TIMELINE_V1 = {
  durationMs: 180_000,
  pulseAtMs: [45_000, 90_000, 135_000],
  warnMs: 5_000,
  overtimeMs: 30_000,
} as const;

// Versioned competitive effect bounds. Every derived magnitude stays inside
// these limits regardless of patron rarity (machine-tested).
export const CHAOS_BOUNDS_V1 = {
  hazardDps: { min: 8, max: 20 },
  hazardRadiusPct: { min: 10, max: 25 },
  modifierPct: { min: 90, max: 135 },
  energyDeltaPct: { min: 110, max: 150 },
  durationMs: { min: 8_000, max: 15_000 },
  telegraphMs: { min: 3_000, max: 8_000 },
} as const;

export type ChaosEffect =
  | {
      kind: "hazard";
      hazardType: "area_damage";
      scope: "all_units";
      targets: "all_units";
      zones: ArenaZone[];
      dps: number;
      radiusPct: number;
      telegraphMs: number;
      durationMs: number;
      stacking: "refresh";
      expires: "expire_end";
    }
  | {
      kind: "modifier";
      stat: "move_speed";
      scope: "all_units";
      multiplierPct: number;
      durationMs: number;
      zones: ArenaZone[];
      stacking: "refresh";
      expires: "expire_end";
    }
  | {
      kind: "modifier";
      stat: "energy_regen";
      scope: "both_players";
      deltaPct: number;
      durationMs: number;
      zones: ArenaZone[];
      stacking: "override";
      expires: "expire_end";
    }
  | {
      kind: "zone";
      crossing: ArenaZone;
      modifier: "slowed" | "hasted";
      scope: "all_units";
      durationMs: number;
      stacking: "override";
      expires: "restore";
    }
  | {
      kind: "buff";
      stat: "attack" | "defense";
      scope: "both_players_units";
      multiplierPct: number;
      durationMs: number;
      zones: ArenaZone[];
      stacking: "refresh";
      expires: "expire_end";
    };

export interface ChaosEvent {
  id: string;
  slot: number;
  family: ChaosFamily;
  displayName: string;
  warnMs: number;
  activationMs: number;
  expireMs: number;
  zones: ArenaZone[];
  effect: ChaosEffect;
  telegraphed: true;
}

export interface ChaosSchedule {
  rulesetVersion: typeof CHAOS_RULESET_VERSION;
  patronRulesetVersion: string;
  patronTokenId: string;
  patronConfigHash: string;
  seedHash: string;
  timeline: typeof CHAOS_TIMELINE_V1;
  events: ChaosEvent[];
  scheduleHash: string;
}

const THEME_FAMILY: Record<PatronTheme, ChaosFamily> = {
  ember: "ember_rift",
  frost: "frost_crossing",
  surge: "energy_surge",
  rift: "rift_shift",
  rally: "chaos_rally",
  prismatic: "chaos_rally",
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function hashInt(tag: string, parts: string[], modulo: number): number {
  const digest = createHash("sha256").update(`${tag}:${parts.join("|")}`).digest("hex");
  return Number(BigInt(`0x${digest}`) % BigInt(modulo));
}

/** Quantized deterministic pick inside [min, max] (inclusive, integer). */
export function pickInBounds(tag: string, parts: string[], min: number, max: number, step = 1): number {
  if (max < min) throw new AppError("INTERNAL_ERROR", "Invalid chaos bound range");
  const steps = Math.floor((max - min) / step);
  return min + hashInt(tag, parts, steps + 1) * step;
}

/** Slot family: slot 0 is always the patron theme family (selection
 * precedence); later slots rotate deterministically from the server seed so
 * a match explores more than one battlefield condition. */
export function familyForSlot(theme: PatronTheme, slot: number, seedShift: number): ChaosFamily {
  if (slot === 0) return THEME_FAMILY[theme];
  const themeIdx = CHAOS_FAMILIES.indexOf(THEME_FAMILY[theme]);
  return CHAOS_FAMILIES[(themeIdx + slot + seedShift) % CHAOS_FAMILIES.length] as ChaosFamily;
}

/** Zone order: patrons with a real Aura rotate the telegraph order from the
 * aura name hash; aura-less patrons use the documented default order. */
export function zonesForEvent(aura: string | null, family: ChaosFamily, slot: number, seedPart: string): ArenaZone[] {
  const order: ArenaZone[] =
    aura === null
      ? ["north", "center", "south"]
      : (["north", "center", "south"].sort(
          (a, b) => hashInt("zone-rot", [aura, a, seedPart], 997) - hashInt("zone-rot", [aura, b, seedPart], 997)
        ) as ArenaZone[]);
  const count = family === "ember_rift" ? 1 + hashInt("zone-count", [family, String(slot), seedPart], 2) : order.length;
  return order.slice(0, count);
}

function effectFor(
  family: ChaosFamily,
  zones: ArenaZone[],
  tag: string,
  parts: string[],
  warnMs: number
): ChaosEffect {
  const b = CHAOS_BOUNDS_V1;
  const durationMs = pickInBounds(`${tag}:dur`, parts, b.durationMs.min, b.durationMs.max, 1000);
  switch (family) {
    case "ember_rift":
      return {
        kind: "hazard",
        hazardType: "area_damage",
        scope: "all_units",
        targets: "all_units",
        zones,
        dps: pickInBounds(`${tag}:dps`, parts, b.hazardDps.min, b.hazardDps.max),
        radiusPct: pickInBounds(`${tag}:rad`, parts, b.hazardRadiusPct.min, b.hazardRadiusPct.max, 5),
        telegraphMs: warnMs,
        durationMs,
        stacking: "refresh",
        expires: "expire_end",
      };
    case "frost_crossing":
      return {
        kind: "modifier",
        stat: "move_speed",
        scope: "all_units",
        multiplierPct: pickInBounds(`${tag}:mul`, parts, b.modifierPct.min, b.modifierPct.max, 5),
        durationMs,
        zones,
        stacking: "refresh",
        expires: "expire_end",
      };
    case "energy_surge":
      return {
        kind: "modifier",
        stat: "energy_regen",
        scope: "both_players",
        deltaPct: pickInBounds(`${tag}:nrg`, parts, b.energyDeltaPct.min, b.energyDeltaPct.max, 5),
        durationMs,
        zones,
        stacking: "override",
        expires: "expire_end",
      };
    case "rift_shift":
      return {
        kind: "zone",
        crossing: zones[0] as ArenaZone,
        modifier: hashInt(`${tag}:mod`, parts, 2) === 0 ? "slowed" : "hasted",
        scope: "all_units",
        durationMs,
        stacking: "override",
        expires: "restore",
      };
    case "chaos_rally":
      return {
        kind: "buff",
        stat: hashInt(`${tag}:stat`, parts, 2) === 0 ? "attack" : "defense",
        scope: "both_players_units",
        multiplierPct: pickInBounds(`${tag}:mul`, parts, b.modifierPct.min, b.modifierPct.max, 5),
        durationMs,
        zones,
        stacking: "refresh",
        expires: "expire_end",
      };
  }
}

// Tier is prestige-only: it names the pulse, never scales it.
function displayName(tier: string | null, family: ChaosFamily): string {
  const label = tier ?? "Unranked";
  const names: Record<ChaosFamily, string> = {
    ember_rift: "Ember Rift",
    frost_crossing: "Frost Crossing",
    energy_surge: "Energy Surge",
    rift_shift: "Rift Shift",
    chaos_rally: "Chaos Rally",
  };
  return `${label} ${names[family]}`;
}

export function deriveChaosSchedule(input: {
  patron: PatronConfig;
  serverSeed: string;
  matchKey?: string;
}): ChaosSchedule {
  const { patron, serverSeed } = input;
  if (!patron || !/^[0-9]{1,78}$/.test(patron.tokenId)) {
    throw new AppError("BAD_REQUEST", "Chaos schedule requires a valid patron token ID");
  }
  if (!patron.configHash || patron.configHash.length !== 64) {
    throw new AppError("BAD_REQUEST", "Chaos schedule requires a patron config hash");
  }
  if (!serverSeed || serverSeed.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Chaos schedule requires a server-generated seed");
  }
  const seedHash = createHash("sha256").update(`chaos-seed:${serverSeed}`).digest("hex");
  const seedShift = hashInt("seed-shift", [seedHash], CHAOS_FAMILIES.length);
  const keyPrefix = input.matchKey ?? `preview:${patron.tokenId}`;
  const events: ChaosEvent[] = CHAOS_TIMELINE_V1.pulseAtMs.map((activationMs, slot) => {
    const family = familyForSlot(patron.theme, slot, seedShift);
    const parts = [seedHash, patron.configHash, String(slot), family];
    const tag = `chaos:${family}`;
    const zones = zonesForEvent(patron.aura, family, slot, seedHash);
    const warnMs = pickInBounds(`${tag}:warn`, parts, CHAOS_BOUNDS_V1.telegraphMs.min, Math.min(CHAOS_BOUNDS_V1.telegraphMs.max, CHAOS_TIMELINE_V1.warnMs), 1000);
    const effect = effectFor(family, zones, tag, parts, warnMs);
    const durationMs = "durationMs" in effect ? effect.durationMs : CHAOS_BOUNDS_V1.durationMs.min;
    const event: ChaosEvent = {
      id: `${keyPrefix}:${family}:${activationMs}`,
      slot,
      family,
      displayName: displayName(patron.tier, family),
      warnMs: activationMs - warnMs,
      activationMs,
      expireMs: activationMs + durationMs,
      zones,
      effect,
      telegraphed: true,
    };
    if (event.expireMs > CHAOS_TIMELINE_V1.durationMs + CHAOS_TIMELINE_V1.overtimeMs) {
      throw new AppError("INTERNAL_ERROR", `Chaos event overruns match bounds: ${event.id}`);
    }
    return event;
  });
  const body = {
    patronTokenId: patron.tokenId,
    patronConfigHash: patron.configHash,
    patronRulesetVersion: patron.rulesetVersion,
    seedHash,
    timeline: CHAOS_TIMELINE_V1,
    events,
  };
  const scheduleHash = createHash("sha256")
    .update(`chaos:${CHAOS_RULESET_VERSION}:${stableStringify(body)}`)
    .digest("hex");
  return { rulesetVersion: CHAOS_RULESET_VERSION, ...body, scheduleHash };
}

export function chaosRulesetSummary() {
  return {
    version: CHAOS_RULESET_VERSION,
    families: [...CHAOS_FAMILIES],
    themeMapping: Object.fromEntries(Object.entries(THEME_FAMILY)),
    timeline: { ...CHAOS_TIMELINE_V1 },
    bounds: JSON.parse(JSON.stringify(CHAOS_BOUNDS_V1)) as typeof CHAOS_BOUNDS_V1,
    fairness: [
      "symmetrical-effects",
      "telegraphed-hazards",
      "tier-prestige-only",
      "no-ownership-input",
      "server-seed-scheduling",
      "warn-before-activation",
    ],
  };
}
