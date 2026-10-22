// Card facts, derived from the authored ruleset tables.
//
// Every number here is read from the same definitions the combat engine uses,
// so the lobby, the deck screen and the battle log cannot disagree about what
// a card costs or does. Nothing is hand-written and no rule is re-stated.
//
// Server-only: it imports the engine tables, which pull in `next/server`.

import {
  COMMANDER_COMBAT_PROFILE_V1,
  SPAWNED_TROOPS_V1,
  spawnWavesFor,
  type BuildingCardDef,
  type SpellCardDef,
  type TroopCardDef,
} from "@/lib/combat";
import type { CommanderClass } from "@/lib/commanders";

export type CardDef = TroopCardDef | SpellCardDef | BuildingCardDef;

/** One labelled fact about a card, for the detail panel. */
export interface StatRow {
  label: string;
  value: string;
}

/** One line describing what the card does, assembled from its definition. */
export function describeCard(card: CardDef): string {
  if ("lifetimeTicks" in card) {
    const b = card;
    if (b.shell) {
      const s = b.shell;
      return `Siege building, ${b.hp} hp. Lobs a shell every ${b.attackIntervalTicks / 10}s at enemy towers/Core first, then buildings, then ground troops, range ${b.minRange ?? 0}-${b.range}. Shell lands ${s.flightTicks / 10}s later: ${s.unitDamage} to units/buildings, ${s.structureDamage} to towers/Core, radius ${s.radius}, never air. Lasts ${b.lifetimeTicks / 10}s.`;
    }
    const attack =
      b.damage > 0
        ? `, ${b.damage} damage every ${b.attackIntervalTicks / 10}s, range ${b.range}${b.hitsAir ? ", hits air" : ""}`
        : ", no attack";
    const spawn = b.spawnCardId
      ? ` Spawns ${b.spawnCount ?? 1} ${SPAWNED_TROOPS_V1[b.spawnCardId]?.name ?? b.spawnCardId} every ${(b.spawnIntervalTicks ?? 0) / 10}s, first after ${b.deployTicks / 10}s, up to ${spawnWavesFor(b)}, lasts ${b.lifetimeTicks / 10}s.`
      : "";
    return `Building with ${b.hp} hp${attack}. Lasts ${b.lifetimeTicks / 10}s, footprint ${b.footprint}.${spawn}`;
  }
  if ("count" in card) {
    const t = card;
    const parts = [
      t.count > 1 ? `${t.count} units` : "Unit",
      `${t.hp} hp`,
      t.damage > 0 ? `${t.damage} damage` : "no attack",
      `range ${t.range}`,
      `speed ${t.speed}`,
    ];
    if (t.moveType === "air") parts.push("air");
    else if (t.hitsAir) parts.push("hits air");
    if (t.splashRadius > 0) parts.push(`splash ${t.splashRadius}`);
    if (t.structPriority) parts.push("targets structures");
    if (t.slowPct > 0) parts.push(`slows ${t.slowPct}%`);
    if (t.targetPriority === "air") parts.push("prioritizes air");
    if (t.targetPriority === "building") parts.push("prioritizes buildings");
    return `${parts.join(", ")}.`;
  }
  const s = card;
  const parts = [`radius ${s.radius}`];
  if (s.damage > 0) parts.push(`${s.damage} damage`);
  if (s.buffPct !== 0) parts.push(`${s.buffPct}% buff for ${s.buffDurationTicks / 10}s`);
  if (s.impact) parts.push(`lands after ${s.impact.delayTicks / 10}s`);
  return `Spell: ${parts.join(", ")}.`;
}

/** One line describing a commander class, from the class combat profile. */
export function describeCommander(cls: string): string {
  const p = COMMANDER_COMBAT_PROFILE_V1[cls as CommanderClass];
  if (!p) return "";
  return `${cls[0]!.toUpperCase()}${cls.slice(1)} commander: ${p.hp} hp, ${p.damage} damage, range ${p.range}, speed ${p.speed}${p.armor > 0 ? `, armor ${p.armor}` : ""}${p.hitsAir ? ", hits air" : ""}.`;
}

/** The real stat rows behind a card, for the detail panel. */
export function cardStatRows(card: CardDef): StatRow[] {
  if ("lifetimeTicks" in card) {
    const b = card;
    const rows: StatRow[] = [
      { label: "Health", value: `${b.hp}` },
      { label: "Attack", value: b.damage > 0 ? `${b.damage} damage` : "no attack" },
    ];
    if (b.damage > 0) {
      rows.push({ label: "Attack every", value: `${b.attackIntervalTicks / 10}s` });
      rows.push({ label: "Range", value: `${b.range}` });
      rows.push({ label: "Targets", value: b.hitsAir ? "ground and air" : "ground only" });
    }
    rows.push({ label: "Footprint", value: `${b.footprint}` });
    rows.push({ label: "Deploy delay", value: `${b.deployTicks / 10}s` });
    rows.push({ label: "Lifetime", value: `${b.lifetimeTicks / 10}s` });
    if (b.shell) {
      rows.push({ label: "Shell lands", value: `${b.shell.flightTicks / 10}s` });
      rows.push({ label: "Shell damage", value: `${b.shell.unitDamage} units, ${b.shell.structureDamage} towers` });
      rows.push({ label: "Blast radius", value: `${b.shell.radius}` });
      rows.push({ label: "Dead zone", value: `inside ${b.minRange ?? 0}` });
    }
    if (b.spawnCardId) {
      rows.push({ label: "Spawns", value: `${b.spawnCount ?? 1} ${SPAWNED_TROOPS_V1[b.spawnCardId]?.name ?? b.spawnCardId}` });
      rows.push({ label: "Spawn every", value: `${(b.spawnIntervalTicks ?? 0) / 10}s` });
      rows.push({ label: "Waves", value: `${spawnWavesFor(b)}` });
    }
    return rows;
  }
  if ("count" in card) {
    const t = card;
    const rows: StatRow[] = [
      { label: "Health", value: `${t.hp}` },
      { label: "Damage", value: t.damage > 0 ? `${t.damage}` : "no attack" },
      { label: "Attack every", value: `${t.attackIntervalTicks / 10}s` },
      { label: "Range", value: `${t.range}` },
      { label: "Speed", value: `${t.speed}` },
      { label: "Sight", value: `${t.sight}` },
      { label: "Deploys", value: t.count > 1 ? `${t.count} units` : "1 unit" },
      { label: "Movement", value: t.moveType === "air" ? "air" : "ground" },
    ];
    rows.push({
      label: "Targets",
      value: t.hitsAir && t.hitsGround ? "ground and air" : t.hitsAir ? "air and ground" : "ground only",
    });
    if (t.splashRadius > 0) rows.push({ label: "Splash", value: `${t.splashRadius}` });
    if (t.slowPct > 0) rows.push({ label: "Slow", value: `${t.slowPct}% for ${t.slowDurationTicks / 10}s` });
    if (t.shockwaveRadius) rows.push({ label: "Shockwave", value: `radius ${t.shockwaveRadius}` });
    if (t.structPriority) rows.push({ label: "Prefers", value: "structures" });
    if (t.targetPriority === "air") rows.push({ label: "Prefers", value: "air targets" });
    if (t.targetPriority === "building") rows.push({ label: "Prefers", value: "buildings" });
    if (t.vsGroundPct !== undefined) rows.push({ label: "Vs ground", value: `${t.vsGroundPct}%` });
    if (t.vsBuildingPct !== undefined) rows.push({ label: "Vs buildings", value: `${t.vsBuildingPct}%` });
    if (t.projectileTicks > 0) rows.push({ label: "Projectile", value: `${t.projectileTicks / 10}s` });
    return rows;
  }
  const s = card;
  const rows: StatRow[] = [
    { label: "Radius", value: `${s.radius}` },
    { label: "Damage", value: s.damage > 0 ? `${s.damage}` : "none" },
  ];
  if (s.buffPct !== 0) {
    rows.push({ label: "Buff", value: `${s.buffPct}% attack` });
    rows.push({ label: "Buff length", value: `${s.buffDurationTicks / 10}s` });
  }
  if (s.impact) {
    rows.push({ label: "Lands after", value: `${s.impact.delayTicks / 10}s` });
    rows.push({ label: "Unit damage", value: `${s.impact.unitDamage}` });
    if (s.impact.buildingDamage > 0) rows.push({ label: "Building damage", value: `${s.impact.buildingDamage}` });
    if (s.impact.structureDamage > 0) rows.push({ label: "Tower damage", value: `${s.impact.structureDamage}` });
    if (s.impact.slowPct > 0) rows.push({ label: "Slow", value: `${s.impact.slowPct}% for ${s.impact.slowDurationTicks / 10}s` });
    rows.push({
      label: "Hits",
      value: [
        s.impact.hitsGround ? "ground" : null,
        s.impact.hitsAir ? "air" : null,
        s.impact.hitsCommanders ? "commanders" : null,
      ]
        .filter(Boolean)
        .join(", ") || "nothing",
    });
  }
  return rows;
}

/**
 * The real stat rows behind a commander class. The combat profile is keyed by
 * class, so a free starter and an NFT commander of the same class report
 * exactly the same numbers.
 */
export function commanderStatRows(cls: string): StatRow[] {
  const p = COMMANDER_COMBAT_PROFILE_V1[cls as CommanderClass];
  if (!p) return [];
  const rows: StatRow[] = [
    { label: "Deploy cost", value: `${p.cost}` },
    { label: "Health", value: `${p.hp}` },
    { label: "Damage", value: `${p.damage}` },
    { label: "Attack every", value: `${p.intervalTicks / 10}s` },
    { label: "Range", value: `${p.range}` },
    { label: "Speed", value: `${p.speed}` },
    { label: "Sight", value: `${p.sight}` },
  ];
  if (p.armor > 0) rows.push({ label: "Armor", value: `${p.armor}` });
  rows.push({ label: "Targets", value: p.hitsAir ? "ground and air" : "ground only" });
  return rows;
}
