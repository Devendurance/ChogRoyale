// B2.7c4 deck economy + bot strategy evidence (v13). Pure: no DB, no network.
// Every number comes from real engine matches driven by legal bot commands
// and replayed through runMatch. Shared by src/lib/bot-economy.test.ts and
// scripts/bot-economy.ts.

import { botMove, deckWith, type MovePolicy } from "@/lib/arena-scenarios";
import { MATCHUP_DECKS_V11, MATCHUP_DECKS_V12_BASE, MATCHUP_DECKS_V12_MAULER, runMatchup, type MatchupRow } from "@/lib/building-matchup";
import { fairnessSchedule } from "@/lib/chaos-fairness";
import { smartMove } from "@/lib/smart-bot";
import type { ChaosSchedule } from "@/lib/chaos";

export const POLICIES: Record<"simple" | "smart", MovePolicy> = { simple: botMove, smart: smartMove };

/** v13 baseline field: the v12 base decks plus the v11 building-pressure deck. */
export const DECKS_V13: Record<string, string[]> = { ...MATCHUP_DECKS_V12_BASE, breaker: MATCHUP_DECKS_V11.breaker! };

export type ChaosMode = "none" | "rift" | "ember" | "riftShift";
/** Real derived schedules. "ember"/"riftShift" use patrons whose slot 0 is that family. */
export function chaosFor(mode: ChaosMode): "none" | "rift" | ((seed: string) => ChaosSchedule) {
  if (mode === "ember") return (seed) => fairnessSchedule("emberAura", seed);
  if (mode === "riftShift") return (seed) => fairnessSchedule("rift", seed);
  return mode;
}

/** Per-deck view over both seats. Energy figures are per game. */
export function deckReport(rows: MatchupRow[]) {
  const out: Record<string, { games: number; wins: number; losses: number; draws: number; crownsFor: number; crownsAgainst: number; towerDmgDealt: number; towerDmgTaken: number; energySpent: number; energyWasted: number; cappedTicks: number; idleAtCap: number; playsPerMin: number; commanderDeploys: number; abilities: number }> = {};
  const add = (deck: string, r: MatchupRow, p: 0 | 1) => {
    const o = (out[deck] ??= { games: 0, wins: 0, losses: 0, draws: 0, crownsFor: 0, crownsAgainst: 0, towerDmgDealt: 0, towerDmgTaken: 0, energySpent: 0, energyWasted: 0, cappedTicks: 0, idleAtCap: 0, playsPerMin: 0, commanderDeploys: 0, abilities: 0 });
    const q = (1 - p) as 0 | 1;
    o.games += 1;
    if (r.winner === p) o.wins += 1;
    else if (r.winner === q) o.losses += 1;
    else o.draws += 1;
    o.crownsFor += r.crowns[p];
    o.crownsAgainst += r.crowns[q];
    o.towerDmgDealt += r.towerDamage[q];
    o.towerDmgTaken += r.towerDamage[p];
    o.energySpent += r.energySpent[p];
    o.energyWasted += r.econ?.wasted[p] ?? 0;
    o.cappedTicks += r.econ?.cappedTicks[p] ?? 0;
    o.idleAtCap += r.econ?.idleAtCap[p] ?? 0;
    o.playsPerMin += ((r.econ?.plays[p] ?? 0) * 600) / Math.max(1, r.ticks);
    o.commanderDeploys += r.bySide.commanderDeploys[p];
    o.abilities += r.bySide.abilities[p];
  };
  for (const r of rows) {
    if (r.p0 === r.p1) continue;
    add(r.p0, r, 0);
    add(r.p1, r, 1);
  }
  const avg = (v: number, g: number) => Math.round((v / Math.max(1, g)) * 10) / 10;
  return Object.fromEntries(
    Object.entries(out).map(([k, o]) => [
      k,
      { ...o, energySpent: avg(o.energySpent, o.games), energyWasted: avg(o.energyWasted, o.games), cappedTicks: avg(o.cappedTicks, o.games), idleAtCap: avg(o.idleAtCap, o.games), playsPerMin: avg(o.playsPerMin, o.games), commanderDeploys: avg(o.commanderDeploys, o.games), abilities: avg(o.abilities, o.games), towerDmgDealt: avg(o.towerDmgDealt, o.games), towerDmgTaken: avg(o.towerDmgTaken, o.games) },
    ])
  );
}

export function fieldTotals(rows: MatchupRow[]) {
  const n = rows.length;
  const sum = (f: (r: MatchupRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const cards: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of [...Object.entries(r.deploys), ...Object.entries(r.spells)]) cards[k] = (cards[k] ?? 0) + v;
  return {
    games: n,
    p0: rows.filter((r) => r.winner === 0).length,
    p1: rows.filter((r) => r.winner === 1).length,
    draws: rows.filter((r) => r.winner === "draw").length,
    unfinished: rows.filter((r) => r.winner === null).length,
    avgTicks: Math.round(sum((r) => r.ticks) / Math.max(1, n)),
    rejected: sum((r) => r.rejected),
    replayIdentical: rows.every((r) => r.replayIdentical),
    cardUsage: Object.fromEntries(Object.entries(cards).sort((a, b) => b[1] - a[1])),
  };
}

export function baseline(policy: "simple" | "smart", chaos: ChaosMode, seeds: string[], decks = DECKS_V13) {
  const p = POLICIES[policy];
  const rows = runMatchup(decks, seeds, chaosFor(chaos), [p, p]);
  return { policy, chaos, totals: fieldTotals(rows), decks: deckReport(rows) };
}

/**
 * Same deck on both sides, one seat smart and one simple, then the seats
 * swapped. Isolates policy quality from deck strength and seat.
 */
export function policyDuel(decks: Record<string, string[]>, seeds: string[], chaos: ChaosMode = "none") {
  const out: Record<string, { games: number; smart: number; simple: number; draws: number; wastedSmart: number; wastedSimple: number; idleCapSmart: number; idleCapSimple: number }> = {};
  for (const [name, deck] of Object.entries(decks)) {
    const o = (out[name] = { games: 0, smart: 0, simple: 0, draws: 0, wastedSmart: 0, wastedSimple: 0, idleCapSmart: 0, idleCapSimple: 0 });
    for (const smartSeat of [0, 1] as const) {
      const pol: [MovePolicy, MovePolicy] = smartSeat === 0 ? [smartMove, botMove] : [botMove, smartMove];
      for (const r of runMatchup({ [name]: deck }, seeds, chaosFor(chaos), pol)) {
        const simpleSeat = (1 - smartSeat) as 0 | 1;
        o.games += 1;
        if (r.winner === smartSeat) o.smart += 1;
        else if (r.winner === simpleSeat) o.simple += 1;
        else o.draws += 1;
        o.wastedSmart += r.econ!.wasted[smartSeat];
        o.wastedSimple += r.econ!.wasted[simpleSeat];
        o.idleCapSmart += r.econ!.idleAtCap[smartSeat];
        o.idleCapSimple += r.econ!.idleAtCap[simpleSeat];
      }
    }
  }
  return out;
}

const SWARM = DECKS_V13.swarm!;
const withCard = (deck: string[], from: string, to: string) => deck.map((c) => (c === from ? to : c));
/**
 * Swarm ablations, each vs the other v13 decks (both seats). Each variant
 * changes one factor of the swarm deck so its win rate isolates that factor.
 */
export const SWARM_VARIANTS: Record<string, string[]> = {
  swarm: SWARM,
  turret: DECKS_V13.turret!,
  // 1e air pair removed (rift_sprites -> frostshell).
  swarmNoSprites: withCard(SWARM, "rift_sprites", "frostshell"),
  // 2e snare removed (rift_snare -> boulderback).
  swarmNoSnare: withCard(SWARM, "rift_snare", "boulderback"),
  // Average cost up from 2.7 to 4.0: the three cheapest cards -> heavy ones.
  swarmHeavy: withCard(withCard(withCard(SWARM, "choglings", "boulderback"), "rift_sprites", "frostshell"), "rift_snare", "hexwing"),
  // Commander cost: scout (4e) -> warden (5e).
  swarmWarden: withCard(SWARM, "cmdr:free-scout", "cmdr:free-warden"),
  // Conditional cards: three always-playable troops -> cards the simple bot holds until a trigger.
  swarmConditional: withCard(withCard(withCard(SWARM, "choglings", "rift_sentry"), "rift_runner", "gale_netter"), "chog_guardian", "chaos_comet"),
  // Turret keeps its cards but gets the cheap scout commander.
  turretScout: withCard(DECKS_V13.turret!, "cmdr:free-bulwark", "cmdr:free-scout"),
};

export function swarmAblation(policy: "simple" | "smart", seeds: string[]) {
  const field = Object.fromEntries(Object.entries(DECKS_V13).filter(([k]) => k !== "swarm" && k !== "turret"));
  const out: Record<string, { games: number; wins: number; wasted: number; idleAtCap: number; playsPerMin: number }> = {};
  for (const [name, deck] of Object.entries(SWARM_VARIANTS)) {
    const rows = runMatchup({ [name]: deck, ...field }, seeds, "none", [POLICIES[policy], POLICIES[policy]]).filter((r) => (r.p0 === name) !== (r.p1 === name));
    const rep = deckReport(rows)[name]!;
    out[name] = { games: rep.games, wins: rep.wins, wasted: rep.energyWasted, idleAtCap: rep.idleAtCap, playsPerMin: rep.playsPerMin };
  }
  return out;
}

const AIR = deckWith("hexwing", "rift_sprites", "chaos_archer", "sparkcaster", "rally_horn", "chog_guardian", "chaos_bolt", "cmdr:free-deadeye");
/** A-J controlled strategy pairings (both seats, both policies). */
export const STRATEGY_PAIRS: Record<string, { a: string[]; b: string[]; chaos: ChaosMode; note: string }> = {
  A_cycleVsBeatdown: { a: SWARM, b: DECKS_V13.siege!, chaos: "none", note: "swarm vs siege" },
  B_cycleVsControl: { a: SWARM, b: DECKS_V13.control!, chaos: "none", note: "swarm vs control" },
  C_turretVsBreaker: { a: DECKS_V13.turret!, b: DECKS_V13.breaker!, chaos: "none", note: "turret vs building pressure" },
  D_swarmVsSplash: { a: SWARM, b: MATCHUP_DECKS_V12_MAULER.antiSwarm!, chaos: "none", note: "swarm vs anti-swarm with Ember Mauler" },
  E_airVsAntiAir: { a: AIR, b: DECKS_V13.control!, chaos: "none", note: "flying deck vs Gale Netter control" },
  F_commanderPush: { a: DECKS_V13.siege!, b: DECKS_V13.antiSwarm!, chaos: "none", note: "reaver siege vs deadeye anti-swarm, commander deploys tracked" },
  G_laneSplit: { a: DECKS_V13.siege!, b: DECKS_V13.turret!, chaos: "none", note: "siege vs turret, both-tower pressure tracked" },
  H_abilities: { a: DECKS_V13.control!, b: DECKS_V13.antiSwarm!, chaos: "none", note: "warden vs deadeye, ability counts tracked" },
  I_emberRift: { a: SWARM, b: DECKS_V13.antiSwarm!, chaos: "ember", note: "swarm vs anti-swarm with Ember Rift schedules" },
  J_riftShift: { a: DECKS_V13.siege!, b: DECKS_V13.control!, chaos: "riftShift", note: "siege vs control with Rift Shift schedules" },
};

export function strategyPairs(seeds: string[], pairs = STRATEGY_PAIRS) {
  const out: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(pairs)) {
    const res: Record<string, unknown> = { note: s.note };
    for (const policy of ["simple", "smart"] as const) {
      const rows = runMatchup({ a: s.a, b: s.b }, seeds, chaosFor(s.chaos), [POLICIES[policy], POLICIES[policy]]).filter((r) => r.p0 !== r.p1);
      const rep = deckReport(rows);
      // Opposite-lane pressure: games where a side damaged both enemy lane towers.
      const bothLanes = { a: rows.filter((r) => r.towersDamaged[r.p0 === "a" ? 1 : 0] === 2).length, b: rows.filter((r) => r.towersDamaged[r.p0 === "b" ? 1 : 0] === 2).length };
      res[policy] = {
        aWins: rep.a?.wins ?? 0,
        bWins: rep.b?.wins ?? 0,
        draws: rep.a?.draws ?? 0,
        avgTicks: fieldTotals(rows).avgTicks,
        wasted: { a: rep.a?.energyWasted, b: rep.b?.energyWasted },
        commanderDeploys: { a: rep.a?.commanderDeploys, b: rep.b?.commanderDeploys },
        abilities: { a: rep.a?.abilities, b: rep.b?.abilities },
        towerDmgDealt: { a: rep.a?.towerDmgDealt, b: rep.b?.towerDmgDealt },
        gamesBothEnemyTowersHit: bothLanes,
        rejected: fieldTotals(rows).rejected,
        replayIdentical: fieldTotals(rows).replayIdentical,
      };
    }
    out[key] = res;
  }
  return out;
}
