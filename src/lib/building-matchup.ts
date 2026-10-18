// B2.7b building-deck matchup harness. Runs the real engine through the
// deterministic dev bot (botMatch) for every deck pairing on both sides and
// several seeds, then replays each recorded command stream through runMatch.
// Pure: no DB, no network. Shared by tests and scripts/building-matchup.ts.

import { runMatch, stateHash, CARDS_V1, SPELL_CARDS_V1, COMMANDER_COMBAT_PROFILE_V1, STRUCTURE_V1, type CombatState, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, botMatch, riftSchedule } from "@/lib/arena-scenarios";

/** v8 baseline decks: only cards that existed at B2.7a. */
export const MATCHUP_DECKS_V8: Record<string, string[]> = {
  turret: deckWith("rift_sentry", "decoy_totem", "chaos_archer", "chog_guardian", "chaos_bolt", "choglings", "frostshell", "cmdr:free-bulwark"),
  siege: deckWith("rift_runner", "boulderback", "hexwing", "decoy_totem", "sparkcaster", "rally_horn", "choglings", "cmdr:free-reaver"),
  control: deckWith("rift_sentry", "chaos_archer", "sparkcaster", "frostshell", "chaos_bolt", "chog_guardian", "hexwing", "cmdr:free-warden"),
};

/** v9 decks: the same archetypes with the B2.7b cards swapped in. */
export const MATCHUP_DECKS_V9: Record<string, string[]> = {
  turret: deckWith("rift_sentry", "decoy_totem", "chaos_archer", "chog_guardian", "chaos_bolt", "rift_sprites", "rift_snare", "cmdr:free-bulwark"),
  siege: deckWith("rift_runner", "boulderback", "hexwing", "decoy_totem", "sparkcaster", "chaos_comet", "rift_sprites", "cmdr:free-reaver"),
  control: deckWith("rift_sentry", "chaos_archer", "sparkcaster", "rift_snare", "chaos_comet", "chog_guardian", "hexwing", "cmdr:free-warden"),
};

export const MATCHUP_SEEDS = ["m1", "m2", "m3", "m4"];

export interface MatchupRow {
  p0: string;
  p1: string;
  seed: string;
  winner: PlayerIndex | "draw" | null;
  endReason: string | null;
  crowns: [number, number];
  ticks: number;
  rejected: number;
  buildings: { spawned: number; destroyed: number; expired: number; lifetimeTicks: number };
  /** Damage each player's towers received (index = tower owner). */
  towerDamage: [number, number];
  coreDamage: [number, number];
  commanderDeploys: number;
  abilityActivations: number;
  spells: Record<string, number>;
  /** Tower/Core damage dealt by impact spells (Comet). */
  spellStructureDamage: number;
  energySpent: [number, number];
  replayIdentical: boolean;
}

function measure(state: CombatState): Omit<MatchupRow, "p0" | "p1" | "seed" | "replayIdentical"> {
  const ev = state.events;
  const spawnAt = new Map<string, number>();
  const buildings = { spawned: 0, destroyed: 0, expired: 0, lifetimeTicks: 0 };
  const spells: Record<string, number> = {};
  const energySpent: [number, number] = [0, 0];
  let spellStructureDamage = 0;
  for (const e of ev) {
    if (e.type === "building_spawned") {
      buildings.spawned += 1;
      spawnAt.set(e.buildingId, e.tick);
    } else if (e.type === "building_removed") {
      buildings[e.reason] += 1;
      buildings.lifetimeTicks += e.tick - (spawnAt.get(e.buildingId) ?? e.tick);
      spawnAt.delete(e.buildingId);
    } else if (e.type === "spell_cast") {
      spells[e.cardId] = (spells[e.cardId] ?? 0) + 1;
      energySpent[e.player] += CARDS_V1[e.cardId]?.cost ?? 0;
    } else if (e.type === "deploy") {
      energySpent[e.player] += CARDS_V1[e.cardId]?.cost ?? 0;
    } else if (e.type === "commander_deployed") {
      energySpent[e.player] += COMMANDER_COMBAT_PROFILE_V1[e.class as keyof typeof COMMANDER_COMBAT_PROFILE_V1]?.cost ?? 0;
    } else if (e.type === "ability_fired") {
      energySpent[e.player] += e.energySpent;
    } else if (e.type === "spell_impact") {
      spellStructureDamage += e.structures * (SPELL_CARDS_V1[e.cardId]?.impact?.structureDamage ?? 0);
    }
  }
  for (const [, t] of spawnAt) buildings.lifetimeTicks += state.tick - t;
  const dmg = (owner: PlayerIndex, kind: "tower" | "core") =>
    state.structures.filter((s) => s.owner === owner && s.structure === kind).reduce((n, s) => n + STRUCTURE_V1[kind].hp - s.hp, 0);
  return {
    winner: state.winner,
    endReason: state.endReason,
    crowns: [...state.crowns] as [number, number],
    ticks: state.tick,
    rejected: ev.filter((e) => e.type === "command_rejected").length,
    buildings,
    towerDamage: [dmg(0, "tower"), dmg(1, "tower")],
    coreDamage: [dmg(0, "core"), dmg(1, "core")],
    commanderDeploys: ev.filter((e) => e.type === "commander_deployed").length,
    abilityActivations: ev.filter((e) => e.type === "ability_fired" && e.trigger === "active").length,
    spells,
    spellStructureDamage,
    energySpent,
  };
}

export function runMatchup(decks: Record<string, string[]>, seeds = MATCHUP_SEEDS): MatchupRow[] {
  const names = Object.keys(decks);
  const rows: MatchupRow[] = [];
  for (const a of names) {
    for (const b of names) {
      for (const seed of seeds) {
        const cfg = () => scenarioConfig(decks[a]!, decks[b]!, riftSchedule(seed), seed);
        const bot = botMatch(cfg(), 3100, 20);
        const replay = runMatch(cfg(), bot.commands);
        rows.push({ p0: a, p1: b, seed, ...measure(replay.state), replayIdentical: replay.result.stateHash === stateHash(bot.state) });
      }
    }
  }
  return rows;
}

export function summarizeMatchup(rows: MatchupRow[]) {
  const n = rows.length;
  const sum = (f: (r: MatchupRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const avg = (f: (r: MatchupRow) => number) => Math.round((sum(f) / Math.max(1, n)) * 10) / 10;
  const endReasons: Record<string, number> = {};
  const spells: Record<string, number> = {};
  const deckWins: Record<string, number> = {};
  const deckGames: Record<string, number> = {};
  for (const r of rows) {
    endReasons[r.endReason ?? "unfinished"] = (endReasons[r.endReason ?? "unfinished"] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.spells)) spells[k] = (spells[k] ?? 0) + v;
    if (r.p0 !== r.p1) {
      for (const [side, deck] of [[0, r.p0], [1, r.p1]] as const) {
        deckGames[deck] = (deckGames[deck] ?? 0) + 1;
        if (r.winner === side) deckWins[deck] = (deckWins[deck] ?? 0) + 1;
      }
    }
  }
  const spent = sum((r) => r.energySpent[0] + r.energySpent[1]);
  const towerDmg = sum((r) => r.towerDamage[0] + r.towerDamage[1]);
  const b = { spawned: sum((r) => r.buildings.spawned), destroyed: sum((r) => r.buildings.destroyed), expired: sum((r) => r.buildings.expired) };
  return {
    matches: n,
    completed: rows.filter((r) => r.winner !== null).length,
    draws: rows.filter((r) => r.winner === "draw").length,
    endReasons,
    avgTicks: avg((r) => r.ticks),
    crownsTotal: sum((r) => r.crowns[0] + r.crowns[1]),
    rejected: sum((r) => r.rejected),
    buildings: { ...b, avgLifetimeTicks: Math.round(sum((r) => r.buildings.lifetimeTicks) / Math.max(1, b.spawned)) },
    avgTowerDamagePerMatch: avg((r) => r.towerDamage[0] + r.towerDamage[1]),
    avgCoreDamagePerMatch: avg((r) => r.coreDamage[0] + r.coreDamage[1]),
    avgCommanderDeploys: avg((r) => r.commanderDeploys),
    avgAbilityActivations: avg((r) => r.abilityActivations),
    spells,
    spellStructureDamageTotal: sum((r) => r.spellStructureDamage),
    avgEnergySpentPerMatch: avg((r) => r.energySpent[0] + r.energySpent[1]),
    towerDamagePer10Energy: Math.round((towerDmg * 10 * 10) / Math.max(1, spent)) / 10,
    deckWins,
    deckGames,
    replayIdentical: rows.every((r) => r.replayIdentical),
  };
}
