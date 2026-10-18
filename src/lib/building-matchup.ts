// B2.7b building-deck matchup harness. Runs the real engine through the
// deterministic dev bot (botMatch) for every deck pairing on both sides and
// several seeds, then replays each recorded command stream through runMatch.
// Pure: no DB, no network. Shared by tests and scripts/building-matchup.ts.

import { runMatch, stateHash, ARENA_V2, CARDS_V1, SPELL_CARDS_V1, COMMANDER_COMBAT_PROFILE_V1, STRUCTURE_V1, type CombatCommand, type CombatState, type PlayerIndex } from "@/lib/combat";
import { scenarioConfig, deckWith, botMatch, riftSchedule } from "@/lib/arena-scenarios";
import type { ArenaZone, ChaosSchedule } from "@/lib/chaos";

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

/**
 * v11 decks (B2.7c1): turret is the unchanged v9 reference; siege swaps
 * Rift Sprites for Riftbreaker, control swaps Chaos Archer for Gale Netter,
 * and "breaker" is a new counterplay deck built around both new cards.
 */
export const MATCHUP_DECKS_V11: Record<string, string[]> = {
  turret: MATCHUP_DECKS_V9.turret!,
  siege: deckWith("rift_runner", "boulderback", "hexwing", "decoy_totem", "sparkcaster", "chaos_comet", "riftbreaker", "cmdr:free-reaver"),
  control: deckWith("rift_sentry", "gale_netter", "sparkcaster", "rift_snare", "chaos_comet", "chog_guardian", "hexwing", "cmdr:free-warden"),
  breaker: deckWith("riftbreaker", "gale_netter", "choglings", "rift_snare", "chaos_archer", "chog_guardian", "rift_sprites", "cmdr:free-scout"),
};

/**
 * v12 controlled comparison (B2.7c2). The cheap swarm deck is identical in
 * both sets; each other deck differs between BASE and MAULER by exactly one
 * card (the listed slot swapped for ember_mauler):
 * building defense (turret) chog_guardian, siege decoy_totem, control
 * chog_guardian, antiSwarm chog_guardian.
 */
const SWARM = deckWith("choglings", "rift_sprites", "rift_snare", "rift_runner", "chaos_archer", "chog_guardian", "sparkcaster", "cmdr:free-scout");
const swap = (deck: string[], from: string) => deck.map((c) => (c === from ? "ember_mauler" : c));
const ANTI_SWARM = deckWith("chog_guardian", "sparkcaster", "chaos_archer", "frostshell", "rift_snare", "decoy_totem", "hexwing", "cmdr:free-deadeye");
export const MATCHUP_DECKS_V12_BASE: Record<string, string[]> = {
  swarm: SWARM,
  turret: MATCHUP_DECKS_V9.turret!,
  siege: MATCHUP_DECKS_V11.siege!,
  control: MATCHUP_DECKS_V11.control!,
  antiSwarm: ANTI_SWARM,
};
export const MATCHUP_DECKS_V12_MAULER: Record<string, string[]> = {
  swarm: SWARM,
  turret: swap(MATCHUP_DECKS_V9.turret!, "chog_guardian"),
  siege: swap(MATCHUP_DECKS_V11.siege!, "decoy_totem"),
  control: swap(MATCHUP_DECKS_V11.control!, "chog_guardian"),
  antiSwarm: swap(ANTI_SWARM, "chog_guardian"),
};

export const MATCHUP_SEEDS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];

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
  /** Accepted troop/building deploys per card id (spells are in `spells`). */
  deploys: Record<string, number>;
  /** Troop + commander deaths by owner. */
  deaths: [number, number];
  /** Ember Mauler shockwaves: swings and extra ground units hit beyond the primary. */
  shockwave: { swings: number; extraHits: number };
  /** Tower/Core damage dealt by impact spells (Comet). */
  spellStructureDamage: number;
  energySpent: [number, number];
  /** Per-player counts (index = player). */
  bySide: { buildings: [number, number]; commanderDeploys: [number, number]; abilities: [number, number] };
  replayIdentical: boolean;
}

export function measure(state: CombatState): Omit<MatchupRow, "p0" | "p1" | "seed" | "replayIdentical"> {
  const ev = state.events;
  const spawnAt = new Map<string, number>();
  const buildings = { spawned: 0, destroyed: 0, expired: 0, lifetimeTicks: 0 };
  const spells: Record<string, number> = {};
  const deploys: Record<string, number> = {};
  const energySpent: [number, number] = [0, 0];
  const deaths: [number, number] = [0, 0];
  const shockwave = { swings: 0, extraHits: 0 };
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
      deploys[e.cardId] = (deploys[e.cardId] ?? 0) + 1;
    } else if (e.type === "commander_deployed") {
      energySpent[e.player] += COMMANDER_COMBAT_PROFILE_V1[e.class as keyof typeof COMMANDER_COMBAT_PROFILE_V1]?.cost ?? 0;
    } else if (e.type === "ability_fired") {
      energySpent[e.player] += e.energySpent;
    } else if (e.type === "death") {
      deaths[e.owner] += 1;
    } else if (e.type === "shockwave") {
      shockwave.swings += 1;
      shockwave.extraHits += e.extraHits;
    } else if (e.type === "spell_impact") {
      spellStructureDamage += e.structures * (SPELL_CARDS_V1[e.cardId]?.impact?.structureDamage ?? 0);
    }
  }
  for (const [, t] of spawnAt) buildings.lifetimeTicks += state.tick - t;
  const perSide = (pred: (e: (typeof ev)[number]) => PlayerIndex | null): [number, number] => {
    const out: [number, number] = [0, 0];
    for (const e of ev) {
      const p = pred(e);
      if (p !== null) out[p] += 1;
    }
    return out;
  };
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
    deploys,
    deaths,
    shockwave,
    spellStructureDamage,
    energySpent,
    bySide: {
      buildings: perSide((e) => (e.type === "building_spawned" ? e.player : null)),
      commanderDeploys: perSide((e) => (e.type === "commander_deployed" ? e.player : null)),
      abilities: perSide((e) => (e.type === "ability_fired" && e.trigger === "active" ? e.player : null)),
    },
  };
}

/**
 * Side-fairness view of matchup rows (runMatchup already plays every
 * ordered pairing, so each deck plays both sides). Totals are by player
 * position; damage "dealt" by P0 is damage to P1's towers.
 */
export function positionReport(rows: MatchupRow[]) {
  const sum = (f: (r: MatchupRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const side = (f: (r: MatchupRow, p: 0 | 1) => number) => [sum((r) => f(r, 0)), sum((r) => f(r, 1))];
  const mirror = rows.filter((r) => r.p0 === r.p1);
  return {
    games: rows.length,
    wins: { p0: rows.filter((r) => r.winner === 0).length, p1: rows.filter((r) => r.winner === 1).length, draw: rows.filter((r) => r.winner === "draw").length },
    mirrorWins: { games: mirror.length, p0: mirror.filter((r) => r.winner === 0).length, p1: mirror.filter((r) => r.winner === 1).length },
    crowns: side((r, p) => r.crowns[p]),
    towerDamageDealt: side((r, p) => r.towerDamage[1 - p]!),
    energySpent: side((r, p) => r.energySpent[p]),
    buildings: side((r, p) => r.bySide.buildings[p]),
    commanderDeploys: side((r, p) => r.bySide.commanderDeploys[p]),
    abilities: side((r, p) => r.bySide.abilities[p]),
    avgTicks: Math.round(sum((r) => r.ticks) / Math.max(1, rows.length)),
    rejected: sum((r) => r.rejected),
  };
}

/**
 * `chaos: "rift"` (default) plays the raw seed schedule, whose zone effects
 * name fixed board zones and so are not side-neutral; "none" plays without
 * Chaos for positional checks.
 */
export function runMatchup(decks: Record<string, string[]>, seeds = MATCHUP_SEEDS, chaos: "rift" | "none" = "rift"): MatchupRow[] {
  const names = Object.keys(decks);
  const rows: MatchupRow[] = [];
  for (const a of names) {
    for (const b of names) {
      for (const seed of seeds) {
        const cfg = () => scenarioConfig(decks[a]!, decks[b]!, chaos === "rift" ? riftSchedule(seed) : null, seed);
        const bot = botMatch(cfg(), 3100, 20);
        const replay = runMatch(cfg(), bot.commands);
        rows.push({ p0: a, p1: b, seed, ...measure(replay.state), replayIdentical: replay.result.stateHash === stateHash(bot.state) });
      }
    }
  }
  return rows;
}

/** Mirror a command across the arena's y -> 160 - y symmetry and swap its player. */
export function mirrorCommand(c: CombatCommand): CombatCommand {
  return "abilityId" in c ? { ...c, player: (1 - c.player) as PlayerIndex } : { ...c, player: (1 - c.player) as PlayerIndex, y: ARENA_V2.maxY - c.y };
}

const MIRROR_ZONE: Record<string, ArenaZone> = { north: "south", south: "north", center: "center" };
/** Chaos schedule seen from the other side: north and south zones swapped. */
export function mirrorSchedule(s: ChaosSchedule): ChaosSchedule {
  const z = (zs: ArenaZone[]) => zs.map((x) => MIRROR_ZONE[x]!);
  return {
    ...s,
    events: s.events.map((ev) => ({
      ...ev,
      zones: z(ev.zones),
      effect: ev.effect.kind === "zone" ? { ...ev.effect, crossing: MIRROR_ZONE[ev.effect.crossing]! } : { ...ev.effect, zones: z(ev.effect.zones) },
    })),
  };
}

/**
 * Engine symmetry probe. Records a bot command stream, mirrors it (players
 * swapped, y reflected, decks swapped, Chaos zones swapped) and checks the
 * transformed outcome: winner/crowns/tower damage/energy swapped, same
 * length. A raw schedule names fixed zones, so it is only side-neutral
 * when mirrored with the board.
 */
export function engineMirrorCheck(decks: Record<string, string[]>, seeds = MATCHUP_SEEDS, withChaos = false) {
  const rows: Array<{ p0: string; p1: string; seed: string; symmetric: boolean; a: string; b: string }> = [];
  const swap = (w: PlayerIndex | "draw" | null) => (w === 0 ? 1 : w === 1 ? 0 : w);
  for (const a of Object.keys(decks)) {
    for (const b of Object.keys(decks)) {
      for (const seed of seeds) {
        const chaos = withChaos ? riftSchedule(seed) : null;
        const bot = botMatch(scenarioConfig(decks[a]!, decks[b]!, chaos, seed), 3100, 20);
        const x = measure(runMatch(scenarioConfig(decks[a]!, decks[b]!, chaos, seed), bot.commands).state);
        const y = measure(runMatch(scenarioConfig(decks[b]!, decks[a]!, chaos && mirrorSchedule(chaos), seed), bot.commands.map(mirrorCommand)).state);
        const symmetric =
          swap(x.winner) === y.winner && x.ticks === y.ticks && x.crowns.join() === [...y.crowns].reverse().join() &&
          x.towerDamage.join() === [...y.towerDamage].reverse().join() && x.energySpent.join() === [...y.energySpent].reverse().join();
        const fmt = (m: typeof x) => `${m.winner} ${m.endReason} ${m.crowns.join("-")} @${m.ticks} td ${m.towerDamage.join("/")} e ${m.energySpent.join("/")}`;
        rows.push({ p0: a, p1: b, seed, symmetric, a: fmt(x), b: fmt(y) });
      }
    }
  }
  return rows;
}

/**
 * Same-deck positional check. For deck X vs X and each seed, plays the
 * normal bot game and a lane-swapped game (botMatch swapSides: P1 receives
 * P0's lane sequence and first-mover turns). Chaos "rift" plays the raw
 * schedule in both; "rift-mirrored" gives the swapped game the mirrored
 * schedule; "none" plays without Chaos. A side-neutral engine + bot must
 * swap winner, crowns and tower damage exactly.
 */
export function laneSwapCheck(decks: Record<string, string[]>, seeds = MATCHUP_SEEDS, chaos: "rift" | "rift-mirrored" | "none" = "none") {
  const swapW = (w: PlayerIndex | "draw" | null) => (w === 0 ? 1 : w === 1 ? 0 : w);
  const rows: Array<{ deck: string; seed: string; winner: PlayerIndex | "draw" | null; swappedWinner: PlayerIndex | "draw" | null; exact: boolean }> = [];
  for (const [name, deck] of Object.entries(decks)) {
    for (const seed of seeds) {
      const sched = chaos === "none" ? null : riftSchedule(seed);
      const a = measure(botMatch(scenarioConfig(deck, deck, sched, seed), 3100, 20).state);
      const b = measure(botMatch(scenarioConfig(deck, deck, chaos === "rift-mirrored" ? sched && mirrorSchedule(sched) : sched, seed), 3100, 20, { swapSides: true }).state);
      const exact = swapW(a.winner) === b.winner && a.ticks === b.ticks && a.crowns.join() === [...b.crowns].reverse().join() && a.towerDamage.join() === [...b.towerDamage].reverse().join();
      rows.push({ deck: name, seed, winner: a.winner, swappedWinner: b.winner, exact });
    }
  }
  const count = (k: "winner" | "swappedWinner", v: PlayerIndex) => rows.filter((r) => r[k] === v).length;
  return { games: rows.length, exact: rows.filter((r) => r.exact).length, normal: { p0: count("winner", 0), p1: count("winner", 1) }, swapped: { p0: count("swappedWinner", 0), p1: count("swappedWinner", 1) }, mismatches: rows.filter((r) => !r.exact) };
}

export function summarizeMatchup(rows: MatchupRow[]) {
  const n = rows.length;
  const sum = (f: (r: MatchupRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const avg = (f: (r: MatchupRow) => number) => Math.round((sum(f) / Math.max(1, n)) * 10) / 10;
  const endReasons: Record<string, number> = {};
  const spells: Record<string, number> = {};
  const deckWins: Record<string, number> = {};
  const deckGames: Record<string, number> = {};
  const deploys: Record<string, number> = {};
  /** `${deck} vs ${opponent}` -> wins/games over both sides (mirror decks excluded). */
  const headToHead: Record<string, { wins: number; games: number }> = {};
  for (const r of rows) {
    endReasons[r.endReason ?? "unfinished"] = (endReasons[r.endReason ?? "unfinished"] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.spells)) spells[k] = (spells[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.deploys)) deploys[k] = (deploys[k] ?? 0) + v;
    if (r.p0 !== r.p1) {
      for (const [side, deck, opp] of [[0, r.p0, r.p1], [1, r.p1, r.p0]] as const) {
        deckGames[deck] = (deckGames[deck] ?? 0) + 1;
        if (r.winner === side) deckWins[deck] = (deckWins[deck] ?? 0) + 1;
        const h = (headToHead[`${deck} vs ${opp}`] ??= { wins: 0, games: 0 });
        h.games += 1;
        if (r.winner === side) h.wins += 1;
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
    deploys,
    unitDeathsTotal: sum((r) => r.deaths[0] + r.deaths[1]),
    shockwave: { swings: sum((r) => r.shockwave.swings), extraHits: sum((r) => r.shockwave.extraHits) },
    spellStructureDamageTotal: sum((r) => r.spellStructureDamage),
    avgEnergySpentPerMatch: avg((r) => r.energySpent[0] + r.energySpent[1]),
    towerDamagePer10Energy: Math.round((towerDmg * 10 * 10) / Math.max(1, spent)) / 10,
    deckWins,
    deckGames,
    headToHead,
    replayIdentical: rows.every((r) => r.replayIdentical),
  };
}
